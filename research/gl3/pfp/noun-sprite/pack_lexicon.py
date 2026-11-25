"""Pack English noun hashes and authored appearance traits into 25-byte rows."""

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re


NAME = re.compile(r"[a-z]+(?: [a-z]+){0,2}", re.ASCII)
FNV_OFFSET = 14695981039346656037
FNV_PRIME = 1099511628211
FNV_MASK = (1 << 64) - 1
ROW_BYTES = 25


def fnv64(name):
    value = FNV_OFFSET
    for char in name.encode("ascii"):
        value = ((value ^ char) * FNV_PRIME) & FNV_MASK
    return value


def byte(value, name, max_value=255):
    if type(value) is not int or not 0 <= value <= max_value:
        raise ValueError(f"{name} must be an integer between 0 and {max_value}, got {value}")
    return value


def record(row):
    name = row["name"]
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise ValueError(f"Expected a normalized ASCII noun, got {name!r}")
    traits = [
        byte(row["family"], "family", 3),
        byte(row["ears"], "ears", 2),
        byte(row["markings"], "markings", 2),
        byte(row["coat"], "coat", 2),
        byte(row["flags"], "flags", 7),
    ]
    for key in ("main", "light", "accent"):
        colors = row[key]
        if not isinstance(colors, list) or len(colors) != 3:
            raise ValueError(f"{name}.{key} must have three color channels")
        traits.extend(byte(channel, key) for channel in colors)
    traits.extend(byte(row[key], key) for key in ("emphasis", "breadth", "elongation"))
    packed = fnv64(name).to_bytes(8, "big") + bytes(traits)
    if len(packed) != ROW_BYTES:
        raise ValueError(f"Invalid row width for {name}")
    return packed


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=here / "lexicon.json")
    parser.add_argument("--out", type=Path, default=here / "lexicon.bin")
    args = parser.parse_args()
    entries = json.loads(args.input.read_text())
    records = sorted(record(row) for row in entries)
    if len({row[:8] for row in records}) != len(records):
        raise ValueError("Duplicate noun or FNV64 hash")
    contents = b"".join(records)
    args.out.write_bytes(contents)
    by_family = dict(sorted(Counter(row["family"] for row in entries).items()))
    print(f"{len(entries)} nouns, {len(contents)} bytes, families {by_family}, SHA-256 {sha256(contents).hexdigest()}")


if __name__ == "__main__":
    main()
