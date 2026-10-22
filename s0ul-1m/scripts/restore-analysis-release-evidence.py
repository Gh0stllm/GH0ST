#!/usr/bin/env python3
"""Restore exact frozen JSON evidence from the published deterministic gzip files.

The GitHub connector could not upload the original large JSON files. The archives
contain their original bytes; no evidence or deployed source hash was changed.

Validate archives and any existing reports without writing:
  python s0ul-1m/scripts/restore-analysis-release-evidence.py --check
Restore missing reports (refuses to overwrite differing files):
  python s0ul-1m/scripts/restore-analysis-release-evidence.py
"""

import argparse
import gzip
import hashlib
import io
from pathlib import Path


EVIDENCE = (
    (
        "analysis-phase-gas-calibration.json",
        895929,
        "e00dea7507fe4d30d683f241603a0dee5607c210b231858ad86b8a0cb014d7aa",
        "d98148a637346ac140fd09b33c36af96cf86c7f0785b6b2fb0f94e9e782bc94f",
    ),
    (
        "analysis-release-real-model-validation.json",
        713281,
        "8373a11948085c68ea6c241270d4ca5411182c00def720b90eac78e97b36004a",
        "ddb35490b6ec57512ccfa649b4c2d00241138e66aaa32b435a91c0e8f7cc9de9",
    ),
    (
        "analysis-release-inference-stage.json",
        710178,
        "cbe08a3268ae8bf29ada69bdd625178c9046fbc28c094201426cc20ac4b895e9",
        "d4f4d1e1d886bd91aa663b9463cc68b1b1e749ee3151ec1cbc3cba7819a7d5cb",
    ),
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate only")
    args = parser.parse_args()
    reports = Path(__file__).resolve().parents[1] / "reports"
    checked = []
    for name, size, expected_json, expected_gzip in EVIDENCE:
        target = reports / name
        archive = target.with_suffix(target.suffix + ".gz")
        compressed = archive.read_bytes()
        if sha256(compressed) != expected_gzip:
            raise SystemExit(f"Archive SHA256 mismatch: {archive}")
        with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
            original = stream.read(size + 1)
        if len(original) != size or sha256(original) != expected_json:
            raise SystemExit(f"Restored JSON identity mismatch: {archive}")
        if target.exists() and target.read_bytes() != original:
            raise SystemExit(f"Refusing to overwrite differing file: {target}")
        checked.append((target, original, expected_json))
    for target, original, expected_json in checked:
        if not args.check and not target.exists():
            with target.open("xb") as stream:
                stream.write(original)
        print(f"verified {target.name} {expected_json}")


if __name__ == "__main__":
    main()
