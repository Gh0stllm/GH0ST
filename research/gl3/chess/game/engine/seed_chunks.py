#!/usr/bin/env python3
"""Verify a raw initialized Stockfish image and print A14 seed import arguments."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

MODULE = bytes.fromhex("1d650410655d93624801a0fa45d64d72ec5d209115672b5848f010037da5e5bc")
SEED_ROOT = bytes.fromhex("5d89d556e3c7cede4a0e4c80928f84ffa02274053cf0cfa82413dc82c6a2c407")
MEMORY_BYTES = 466_157_568
GLOBALS = (("gl3_global_0", 120685200), ("gl3_global_98", 0), ("gl3_global_99", 0))
PAGE_SIZE = 4_096
CHUNK_PAGES = 16
TREE_LEAVES = 1 << 18
CHUNKS = MEMORY_BYTES // (CHUNK_PAGES * PAGE_SIZE)
ZERO_PAGE = bytes(PAGE_SIZE)


def parent(left, right):
    return hashlib.sha256(b"\x01" + left + right).digest()


def leaf(index, page):
    return hashlib.sha256(b"GL3_CHESS_VM_PAGE_V1" + index.to_bytes(8, "little") + page).digest()


def image_root(memory_root):
    digest = hashlib.sha256(b"GL3_CHESS_IMAGE_V1" + MODULE + memory_root)
    digest.update(MEMORY_BYTES.to_bytes(8, "little"))
    for name, value in GLOBALS:
        digest.update(name.encode("ascii") + b"\x00" + value.to_bytes(8, "little"))
    return digest.digest()


def merge_level(nodes):
    return [parent(nodes[index], nodes[index + 1]) for index in range(0, len(nodes), 2)]


def chunk_root(nodes):
    while len(nodes) > 1:
        nodes = merge_level(nodes)
    return nodes[0]


def read_chunk(image, index):
    raw = image.read(CHUNK_PAGES * PAGE_SIZE)
    if len(raw) != CHUNK_PAGES * PAGE_SIZE:
        raise ValueError("The input ends before the pinned seed image")
    pages = [raw[offset:offset + PAGE_SIZE] for offset in range(0, len(raw), PAGE_SIZE)]
    root = chunk_root([leaf(index * CHUNK_PAGES + i, page) for i, page in enumerate(pages)])
    return pages, root


def verified_levels(image):
    roots = [read_chunk(image, index)[1] for index in range(CHUNKS)]
    if image.read(1):
        raise ValueError("The input exceeds the pinned seed image length")
    # The engine uses an all-zero 32-byte leaf for memory beyond its initial length.
    padding_root = chunk_root([bytes(32)] * CHUNK_PAGES)
    roots.extend([padding_root] * (TREE_LEAVES // CHUNK_PAGES - CHUNKS))
    levels = [roots]
    while len(levels[-1]) > 1:
        levels.append(merge_level(levels[-1]))
    if image_root(levels[-1][0]) != SEED_ROOT:
        raise ValueError("The raw memory does not match the pinned Stockfish seed")
    return levels


def chunk_arguments(image, levels, index):
    pages, root = read_chunk(image, index)
    if root != levels[0][index]:
        raise ValueError("The input changed after verification")
    nonzero = [(i, page) for i, page in enumerate(pages) if page != ZERO_PAGE]
    siblings = [level[(index >> height) ^ 1] for height, level in enumerate(levels[:-1])]
    return {
        "chunk": index,
        "nonZeroPages": sum(1 << i for i, _ in nonzero),
        "pages": "0x" + b"".join(page for _, page in nonzero).hex(),
        "siblings": ["0x" + node.hex() for node in siblings],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="raw initialized VM memory, without headers")
    parser.add_argument("--start", type=int, default=0, help="first chunk to emit")
    parser.add_argument("--count", type=int, default=1, help="number of chunks, zero verifies only")
    args = parser.parse_args()
    if args.start < 0 or args.count < 0 or args.start + args.count > CHUNKS:
        parser.error(f"the requested range must fit in {CHUNKS} chunks")
    try:
        with args.image.open("rb") as image:
            levels = verified_levels(image)
            print(f"Verified seed root {SEED_ROOT.hex()}", file=sys.stderr)
            image.seek(args.start * CHUNK_PAGES * PAGE_SIZE)
            for index in range(args.start, args.start + args.count):
                print(json.dumps(chunk_arguments(image, levels, index), separators=(",", ":")))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
