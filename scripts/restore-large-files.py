#!/usr/bin/env python3
"""Restore byte-exact model checkpoints from bounded Git-friendly parts.

Run from any directory. --verify-only validates every part and the reconstructed
file digest without writing checkpoints. --output-root permits a separate
destination; existing files with different contents are never overwritten.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def relative_path(value: str) -> Path:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("Manifest path must be relative and remain within its root")
    return Path(*path.parts)


def restore(manifest_path: Path, output_root: Path, verify_only: bool) -> dict:
    manifest = json.loads(manifest_path.read_text())
    if manifest["format"] != "gh0st-large-file-parts-v1":
        raise ValueError("Unsupported large-file manifest")
    target = (output_root / relative_path(manifest["original_path"])).resolve()
    target.relative_to(output_root)
    temporary = None
    output = None
    existing = target.exists()
    if existing and not verify_only:
        if not target.is_file() or digest_file(target) != manifest["sha256"]:
            raise ValueError("Refusing to overwrite a different existing file: " + str(target))
    if not verify_only and not existing:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix="." + target.name + ".restore-", dir=target.parent)
        temporary = Path(name)
        output = os.fdopen(fd, "wb")
    digest = hashlib.sha256()
    total = 0
    try:
        for index, part in enumerate(manifest["parts"]):
            if part["index"] != index:
                raise ValueError("Parts are missing or reordered")
            filename = relative_path(part["file"])
            if len(filename.parts) != 1:
                raise ValueError("Part filename must be a basename")
            source = (manifest_path.parent / filename).resolve()
            source.relative_to(manifest_path.parent.resolve())
            part_digest = hashlib.sha256()
            part_bytes = 0
            with source.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    part_digest.update(block)
                    digest.update(block)
                    part_bytes += len(block)
                    total += len(block)
                    if output is not None:
                        output.write(block)
            if part_bytes != part["bytes"] or part_digest.hexdigest() != part["sha256"]:
                raise ValueError("Part integrity mismatch: " + str(source))
        if total != manifest["bytes"] or digest.hexdigest() != manifest["sha256"]:
            raise ValueError("Reassembled checkpoint integrity mismatch")
        if output is not None:
            output.flush()
            os.fsync(output.fileno())
            output.close()
            output = None
            # Linking commits a completed verified file atomically without
            # replacing a destination created by another process meanwhile.
            os.link(temporary, target)
            temporary.unlink()
            temporary = None
        return {"path": manifest["original_path"], "bytes": total,
                "sha256": digest.hexdigest(), "parts": len(manifest["parts"]),
                "status": "verified" if verify_only else "existing identical" if existing else "restored"}
    finally:
        if output is not None:
            output.close()
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Repository containing artifacts/large-files")
    parser.add_argument("--output-root", type=Path, help="Destination root; defaults to repository")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    output_root = (args.output_root or root).resolve()
    manifests = sorted((root / "artifacts/large-files").glob("*/manifest.json"))
    if not manifests:
        raise SystemExit("No large-file part manifests found")
    try:
        results = [restore(path, output_root, args.verify_only) for path in manifests]
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit("Checkpoint restoration failed: " + str(error)) from error
    print(json.dumps({"files": results, "verified_only": args.verify_only}, indent=2))


if __name__ == "__main__":
    main()
