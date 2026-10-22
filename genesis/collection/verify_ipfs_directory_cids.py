#!/usr/bin/env python3
"""Verify every exact file byte/path against the published UnixFS directory CIDs.

This stdlib-only verifier implements the upload layout actually observed here:
CIDv1 SHA-256 raw leaves, one leaf per file, sorted flat UnixFS directories,
canonical DAG-PB encoding (Links before Data). It makes no network requests and
does not claim to establish current gateway availability or pin persistence.
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


DIRECTORIES = (
    (
        "images",
        ".png",
        "bafybeifbg7tarcknlsgz54bhxg7cbcufhstbty3kkqldr72pd55ynkx43y",
    ),
    (
        "metadata-final",
        ".json",
        "bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i",
    ),
)


def varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("Unsigned varints cannot encode negative values")
    result = bytearray()
    while value > 127:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def bytes_field(field_number: int, value: bytes) -> bytes:
    return varint((field_number << 3) | 2) + varint(len(value)) + value


def uint_field(field_number: int, value: int) -> bytes:
    return varint(field_number << 3) + varint(value)


def cid_bytes(codec: int, data: bytes) -> bytes:
    # CIDv1 || codec || multihash(sha2-256, digest length 32, digest).
    return b"\x01" + varint(codec) + b"\x12\x20" + hashlib.sha256(data).digest()


def cid_text(binary_cid: bytes) -> str:
    return "b" + base64.b32encode(binary_cid).decode("ascii").lower().rstrip("=")


def verify_directory(base: Path, name: str, suffix: str, expected_cid: str) -> tuple[dict, bytes]:
    directory = base / name
    expected_names = {f"{number:03d}{suffix}" for number in range(1, 496)}
    actual_names = {entry.name for entry in directory.iterdir()}
    if actual_names != expected_names:
        raise ValueError(
            f"{name}: exact paths differ; missing={sorted(expected_names - actual_names)}, "
            f"extra={sorted(actual_names - expected_names)}"
        )

    links = []
    records = []
    for filename in sorted(expected_names, key=lambda value: value.encode("utf-8")):
        path = directory / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"{path}: expected regular, non-symlink file")
        contents = path.read_bytes()
        if len(contents) > 262144:
            raise ValueError(f"{path}: larger than the verified single-leaf layout")
        if suffix == ".png" and not contents.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"{path}: invalid PNG signature")
        if suffix == ".json":
            json.loads(contents)
        binary_cid = cid_bytes(0x55, contents)
        # PBLink.Hash = 1, Name = 2, Tsize = 3. A raw leaf's cumulative
        # DAG size is exactly its payload byte length.
        link = (
            bytes_field(1, binary_cid)
            + bytes_field(2, filename.encode("utf-8"))
            + uint_field(3, len(contents))
        )
        links.append(bytes_field(2, link))
        records.append(
            {
                "path": f"{name}/{filename}",
                "ipfs_path": f"ipfs://{expected_cid}/{filename}",
                "bytes": len(contents),
                "sha256": hashlib.sha256(contents).hexdigest(),
                "raw_leaf_cid": cid_text(binary_cid),
            }
        )

    # UnixFS Data.Type = Directory(1), encoded as 08 01. Canonical DAG-PB
    # serialization emits every repeated Links field before the Data field.
    root_block = b"".join(links) + bytes_field(1, b"\x08\x01")
    reconstructed_cid = cid_text(cid_bytes(0x70, root_block))
    if reconstructed_cid != expected_cid:
        raise ValueError(f"{name}: reconstructed {reconstructed_cid} != expected {expected_cid}")
    return (
        {
            "directory": name,
            "file_count": len(records),
            "total_file_bytes": sum(record["bytes"] for record in records),
            "expected_root_cid": expected_cid,
            "reconstructed_root_cid": reconstructed_cid,
            "root_cid_matches": True,
            "root_block_bytes": len(root_block),
            "root_block_sha256": hashlib.sha256(root_block).hexdigest(),
            "all_exact_paths_and_file_bytes_committed_by_root": True,
            "files": records,
        },
        root_block,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, default=Path("GH0ST-Genesis-495"))
    parser.add_argument("--report", type=Path, default=Path("genesis-work/ipfs-directory-cid-verification.json"))
    args = parser.parse_args()
    results = []
    root_blocks = []
    for name, suffix, expected_cid in DIRECTORIES:
        result, root_block = verify_directory(args.collection, name, suffix, expected_cid)
        results.append(result)
        root_blocks.append((name, root_block))
    report = {
        "schema": "gh0st-ipfs-directory-cid-verification-v1",
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "PASS",
        "method": "Reconstruct published UnixFS root CIDs from every local file's exact bytes and filename",
        "layout": {
            "cid_version": 1,
            "hash": "sha2-256",
            "file_codec": "raw (0x55)",
            "single_raw_leaf_max_bytes": 262144,
            "directory_codec": "dag-pb (0x70)",
            "unixfs_directory_data_hex": "0801",
            "link_order": "ascending UTF-8 filename bytes",
            "dag_pb_field_order": "Links before Data",
        },
        "verified_file_count": sum(result["file_count"] for result in results),
        "verified_file_bytes": sum(result["total_file_bytes"] for result in results),
        "all_exact_paths_and_file_bytes_committed_by_published_roots": True,
        "network_requests_by_this_verifier": 0,
        "scope": "Cryptographic content-address verification of all 990 files; current remote availability and pin persistence are separate checks",
        "directories": results,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    for name, root_block in root_blocks:
        args.report.with_name(f"{name}-root.dag-pb").write_bytes(root_block)
    print(json.dumps({
        "status": report["status"],
        "verified_file_count": report["verified_file_count"],
        "verified_file_bytes": report["verified_file_bytes"],
        "report": str(args.report),
        "root_cids": [result["reconstructed_root_cid"] for result in results],
    }, indent=2))


if __name__ == "__main__":
    main()
