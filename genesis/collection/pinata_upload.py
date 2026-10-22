#!/usr/bin/env python3
"""Validate and publish the GH0ST Genesis NFT package to public IPFS via Pinata.

Python 3.10+, standard library only. No credential is accepted as a CLI argument.
Set PINATA_JWT in the environment. Never put that credential in a package or JSON.

Official API documentation checked 2026-10-21:
https://docs.pinata.cloud/files/uploading-files#folders
https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-file-to-ipfs

Folder uploads currently use the legacy PUBLIC IPFS endpoint. The V3 endpoint
defaults to private and does not currently support folder uploads. Each complete
folder is one multipart request. Checkpointing resumes completed stages; a failed
in-progress folder transfer restarts that folder, not its byte offset.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import random
import re
import shutil
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS"
IMAGE_MARKER = "__IMAGE_CID__"
METADATA_MARKER = "__METADATA_CID__"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
DEFAULT_COUNT = 495
CHUNK = 1024 * 1024


class UploadError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Do not forward an Authorization header to a redirected upload target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UploadError(f"Cannot read valid JSON: {path.name}") from exc


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".json-write-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def valid_cid(value: str) -> bool:
    # Structural check only. Remote retrieval verifies the referenced bytes.
    return isinstance(value, str) and bool(
        re.fullmatch(r"b[a-z2-7]{20,120}", value)
        or re.fullmatch(r"Qm[1-9A-HJ-NP-Za-km-z]{44}", value)
    )


def validate_sources(root: Path, count: int):
    image_dir = root / "images"
    template_dir = root / "metadata-templates"
    if not image_dir.is_dir() or not template_dir.is_dir():
        raise UploadError("Package requires images/ and metadata-templates/ directories.")
    ids = [f"{i:03d}" for i in range(1, count + 1)]
    images = [image_dir / f"{number}.png" for number in ids]
    templates = [template_dir / f"{number}.json" for number in ids]
    for directory, expected in ((image_dir, images), (template_dir, templates)):
        actual = list(directory.iterdir())
        if {p.name for p in actual} != {p.name for p in expected}:
            raise UploadError(f"{directory.name}/ must contain exactly the {count} numbered files.")
        if any(p.is_symlink() or not p.is_file() for p in actual):
            raise UploadError(f"{directory.name}/ contains a symlink or non-file entry.")
    fingerprints = {}
    image_hashes = set()
    for number, image_path, template in zip(ids, images, templates):
        with image_path.open("rb") as f:
            if f.read(8) != PNG_SIGNATURE:
                raise UploadError(f"Not a PNG file: {image_path.name}")
        file_hash = digest(image_path)
        image_hashes.add(file_hash)
        fingerprints[image_path.relative_to(root).as_posix()] = file_hash
        fingerprints[template.relative_to(root).as_posix()] = digest(template)
        item = read_json(template)
        if not isinstance(item, dict):
            raise UploadError(f"Metadata is not an object: {template.name}")
        if not item.get("name") or not item.get("description"):
            raise UploadError(f"Metadata needs name and description: {template.name}")
        if item.get("image") != f"ipfs://{IMAGE_MARKER}/{number}.png":
            raise UploadError(f"Unexpected image template for {template.name}")
        if not isinstance(item.get("attributes"), list):
            raise UploadError(f"Metadata needs an attributes array: {template.name}")
        if METADATA_MARKER in json.dumps(item):
            raise UploadError("Token metadata must not refer to its own eventual directory CID.")
    if len(image_hashes) != count:
        raise UploadError(f"Only {len(image_hashes)} distinct PNGs exist; expected {count}.")
    collection = root / "collection-template.json"
    if collection.exists():
        if collection.is_symlink() or not collection.is_file():
            raise UploadError("collection-template.json must be a regular file.")
        value = read_json(collection)
        if not isinstance(value, dict) or not value.get("name"):
            raise UploadError("Collection template needs a name.")
        fingerprints[collection.name] = digest(collection)
    source_fingerprint = hashlib.sha256(
        json.dumps(fingerprints, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return ids, images, templates, collection, fingerprints, source_fingerprint


def replacement(value, image_cid: str, metadata_cid: str | None = None):
    if isinstance(value, str):
        output = value.replace(IMAGE_MARKER, image_cid)
        if metadata_cid:
            output = output.replace(METADATA_MARKER, metadata_cid)
        return output
    if isinstance(value, list):
        return [replacement(item, image_cid, metadata_cid) for item in value]
    if isinstance(value, dict):
        return {key: replacement(item, image_cid, metadata_cid) for key, item in value.items()}
    return value


def ensure_final(value, label: str):
    serialized = json.dumps(value, ensure_ascii=False)
    if re.search(r"__[A-Z][A-Z0-9_]*__|\{\{[^}]+\}\}|REPLACE_ME|YOUR_CID", serialized):
        raise UploadError(f"Unresolved placeholder remains in {label}; refusing publication.")
    for match in re.finditer(r"ipfs://([^/\s\"']+)", serialized):
        if not valid_cid(match.group(1)):
            raise UploadError(f"Invalid IPFS CID in {label}; refusing publication.")


def multipart_file(paths: list[Path], label: str, directory: bool):
    boundary = "----gh0st-" + uuid.uuid4().hex
    temporary = tempfile.NamedTemporaryFile(prefix="gh0st-pinata-", suffix=".multipart", delete=False)
    try:
        with temporary as f:
            def field(name, value):
                f.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
            field("pinataMetadata", json.dumps({"name": label}))
            field("pinataOptions", json.dumps({"cidVersion": 1}))
            for path in paths:
                if not re.fullmatch(r"[A-Za-z0-9._-]+", path.name):
                    raise UploadError("Only safe plain filenames are supported in upload directories.")
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                filename = f"{paths[0].parent.name}/{path.name}" if directory else path.name
                f.write((f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
                         f"filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n").encode())
                with path.open("rb") as source:
                    shutil.copyfileobj(source, f, CHUNK)
                f.write(b"\r\n")
            f.write(f"--{boundary}--\r\n".encode())
        return Path(temporary.name), boundary
    except BaseException:
        Path(temporary.name).unlink(missing_ok=True)
        raise


def retry_wait(attempt: int, retry_after: str | None = None):
    delay = min(20.0, 2 ** attempt + random.random())
    if retry_after and retry_after.isdigit():
        delay = min(20.0, max(delay, float(retry_after)))
    time.sleep(delay)


def upload(paths, label, jwt, args, directory=True):
    total = sum(path.stat().st_size for path in paths)
    if total > args.max_upload_bytes:
        raise UploadError("Folder exceeds --max-upload-bytes safety ceiling; check your Pinata plan.")
    body_path, boundary = multipart_file(paths, label, directory)
    try:
        opener = urllib.request.build_opener(NoRedirect())
        for attempt in range(args.retries + 1):
            try:
                with body_path.open("rb") as body:
                    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
                        "Authorization": f"Bearer {jwt}",
                        "Content-Type": f"multipart/form-data; boundary={boundary}",
                        "Content-Length": str(body_path.stat().st_size),
                        "User-Agent": "GH0ST-Genesis-Public-IPFS-Uploader/1.0",
                    })
                    with opener.open(req, timeout=args.timeout) as response:
                        data = json.loads(response.read(1024 * 1024))
                cid = data.get("IpfsHash")
                if not valid_cid(cid):
                    raise UploadError("Pinata did not return a structurally valid IpfsHash.")
                return {key: data[key] for key in ("IpfsHash", "PinSize", "Timestamp", "isDuplicate") if key in data}
            except urllib.error.HTTPError as exc:
                code = exc.code
                retry_after = exc.headers.get("Retry-After")
                detail = ""
                try:
                    error_value = json.loads(exc.read(8192)).get("error", "")
                    if isinstance(error_value, (str, dict)):
                        detail = json.dumps(error_value, ensure_ascii=True)[:1500]
                        detail = detail.replace(jwt, "[redacted]")
                        detail = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[redacted]", detail)
                except (ValueError, AttributeError, OSError):
                    pass
                exc.close()
                # Never log a raw response or Request repr: they might include credentials.
                if code in (429, 500, 502, 503, 504) and attempt < args.retries:
                    print(f"{label}: HTTP {code}, retry {attempt + 1}/{args.retries}.", flush=True)
                    retry_wait(attempt, retry_after)
                    continue
                raise UploadError(f"{label}: Pinata HTTP {code}. {detail or 'Verify JWT permissions, quota and plan.'}") from None
            except (urllib.error.URLError, OSError, socket.timeout) as exc:
                if attempt < args.retries:
                    print(f"{label}: transfer interrupted, retry {attempt + 1}/{args.retries}.", flush=True)
                    retry_wait(attempt)
                    continue
                raise UploadError(f"{label}: upload network failure after bounded retries.") from None
            except (ValueError, KeyError):
                raise UploadError(f"{label}: invalid API response; no CID checkpoint saved.") from None
        raise UploadError("Upload retry limit exceeded.")
    finally:
        body_path.unlink(missing_ok=True)


def verify_files(cid: str, files: list[Path], args):
    gateway = args.gateway.rstrip("/")
    parsed = urllib.parse.urlsplit(gateway)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise UploadError("--gateway must be an HTTPS IPFS path root without credentials or query.")
    def verify(path):
        uri = f"{gateway}/{cid}/{urllib.parse.quote(path.name)}"
        for attempt in range(args.retries + 1):
            try:
                req = urllib.request.Request(uri, headers={"User-Agent": "GH0ST-Genesis-Verify/1.0"})
                with urllib.request.urlopen(req, timeout=args.timeout) as response:
                    h = hashlib.sha256()
                    size = 0
                    while True:
                        block = response.read(CHUNK)
                        if not block:
                            break
                        size += len(block)
                        if size > path.stat().st_size:
                            raise UploadError(f"Remote file exceeds expected size: {path.name}")
                        h.update(block)
                if size != path.stat().st_size or h.hexdigest() != digest(path):
                    raise UploadError(f"Remote bytes do not match local file: {path.name}")
                return path.name
            except (urllib.error.URLError, OSError, socket.timeout):
                if attempt < args.retries:
                    retry_wait(attempt)
                    continue
                raise UploadError(f"Gateway verification failed: {path.name}") from None
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        completed = 0
        for _ in executor.map(verify, files):
            completed += 1
            if completed % 50 == 0 or completed == len(files):
                print(f"Verified {completed}/{len(files)} files for CID {cid}.", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="Expected count; default 495.")
    parser.add_argument("--dry-run", action="store_true", help="Validate only. No network calls and no JWT required.")
    parser.add_argument("--verify", action="store_true", help="Retrieve all published images/JSON and compare SHA-256.")
    parser.add_argument("--verify-only", action="store_true", help="No uploads; verify previously checkpointed directories.")
    parser.add_argument("--upload-collection", action="store_true", help="Also pin collection-final.json as a separate JSON file.")
    parser.add_argument("--gateway", default="https://gateway.pinata.cloud/ipfs")
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--retries", type=int, default=4, choices=range(0, 9))
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--max-upload-bytes", type=int, default=1024 ** 3,
                        help="Local safety ceiling per folder, NOT a claim about your Pinata plan.")
    args = parser.parse_args(argv)
    if args.count < 1 or args.count > 10000 or args.timeout < 1 or args.max_upload_bytes < 1:
        raise UploadError("Invalid count, timeout or upload ceiling.")
    root = args.package_root.resolve()
    ids, images, templates, collection, fingerprints, fingerprint = validate_sources(root, args.count)
    total = sum(path.stat().st_size for path in images)
    if total > args.max_upload_bytes:
        raise UploadError("Images exceed --max-upload-bytes safety ceiling.")
    print(f"Validated {len(images)} unique PNGs and {len(templates)} metadata templates; image bytes={total}.")
    print(f"Source fingerprint: {fingerprint}")
    state_path = root / ".pinata-upload-state.json"
    state = read_json(state_path) if state_path.exists() else {
        "schema_version": 1, "endpoint": ENDPOINT, "network": "public", "count": args.count,
        "source_fingerprint": fingerprint, "sources_sha256": fingerprints,
    }
    if state.get("source_fingerprint") != fingerprint or state.get("count") != args.count or state.get("endpoint") != ENDPOINT:
        raise UploadError("Checkpoint source fingerprint/configuration differs. Use a new package copy; do not overwrite a published collection.")
    for stage in ("images", "metadata", "collection"):
        if stage in state and not valid_cid(state[stage].get("IpfsHash")):
            raise UploadError(f"Invalid {stage} CID in checkpoint.")
    if "metadata" in state and "images" not in state:
        raise UploadError("Metadata checkpoint has no corresponding image checkpoint.")
    if args.dry_run:
        print("Dry run complete. No content uploaded; unresolved templates remain local only.")
        return 0
    if args.verify_only and not all(stage in state for stage in ("images", "metadata")):
        raise UploadError("--verify-only needs completed image and metadata checkpoints.")
    jwt = os.environ.get("PINATA_JWT", "").strip()
    if not args.verify_only and (not jwt or any(c.isspace() for c in jwt)):
        raise UploadError("Set PINATA_JWT in the environment to upload; do not pass it on the command line.")
    if "images" not in state:
        state["images"] = upload(images, "GH0ST Genesis Images", jwt, args)
        write_json(state_path, state)
        print("Image directory pinned: " + state["images"]["IpfsHash"], flush=True)
    image_cid = state["images"]["IpfsHash"]
    # Confirm the directory's path layout BEFORE publishing JSON that points to it.
    # This also catches an unexpected extra wrapper directory from the service.
    if not state.get("image_paths_verified"):
        verify_files(image_cid, [images[0], images[-1]] if len(images) > 1 else images, args)
        state["image_paths_verified"] = True
        write_json(state_path, state)
    final_dir = root / "metadata-final"
    final_dir.mkdir(exist_ok=True)
    if any(path.name not in {f"{number}.json" for number in ids} for path in final_dir.iterdir()):
        raise UploadError("Unexpected file in metadata-final/; refusing to upload extra content.")
    final_files = []
    for number, template in zip(ids, templates):
        item = replacement(read_json(template), image_cid)
        ensure_final(item, template.name)
        if item["image"] != f"ipfs://{image_cid}/{number}.png":
            raise UploadError("Final metadata image URI does not match its numbered PNG.")
        path = final_dir / template.name
        write_json(path, item)
        final_files.append(path)
    final_fingerprint = hashlib.sha256("".join(digest(path) for path in final_files).encode()).hexdigest()
    if "metadata" in state and state.get("metadata_sha256") != final_fingerprint:
        raise UploadError("Finalized metadata differs from the metadata already uploaded.")
    if "metadata" not in state:
        state["metadata"] = upload(final_files, "GH0ST Genesis Metadata", jwt, args)
        state["metadata_sha256"] = final_fingerprint
        write_json(state_path, state)
        print("Metadata directory pinned: " + state["metadata"]["IpfsHash"], flush=True)
    metadata_cid = state["metadata"]["IpfsHash"]
    if not state.get("metadata_paths_verified"):
        verify_files(metadata_cid, [final_files[0], final_files[-1]] if len(final_files) > 1 else final_files, args)
        state["metadata_paths_verified"] = True
        write_json(state_path, state)
    if collection.exists():
        item = replacement(read_json(collection), image_cid, metadata_cid)
        ensure_final(item, collection.name)
        collection_final = root / "collection-final.json"
        write_json(collection_final, item)
        if args.upload_collection and not args.verify_only and "collection" not in state:
            state["collection"] = upload([collection_final], "GH0ST Genesis Collection", jwt, args, directory=False)
            write_json(state_path, state)
    result = {
        "network": "public", "count": args.count,
        "image_directory_cid": image_cid, "metadata_directory_cid": metadata_cid,
        "metadata_base_uri": f"ipfs://{metadata_cid}/",
        "token_uri_format": f"ipfs://{metadata_cid}/{{token_id:03d}}.json",
        "example_token_uri": f"ipfs://{metadata_cid}/001.json",
        "source_fingerprint": fingerprint,
        "gateway_verified": state.get("gateway_verified", False),
    }
    if "collection" in state:
        result["collection_uri"] = "ipfs://" + state["collection"]["IpfsHash"]
    if args.verify or args.verify_only:
        verify_files(image_cid, images, args)
        verify_files(metadata_cid, final_files, args)
        state["gateway_verified"] = True
        write_json(state_path, state)
        result["gateway_verified"] = True
    write_json(root / "pinata-result.json", result)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except UploadError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Interrupted. Completed stages are checkpointed; rerun to continue.", file=sys.stderr)
        sys.exit(130)
