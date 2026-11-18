#!/usr/bin/env python3
"""Offline size and gas screen for exact before/after guest memory images.

Use captures from the same pinned guest and execution interval. This verifies
lossless page round-trips, not Stockfish execution or publication. Sizes cover
the encoded memory body only. Metadata, globals, authentication, ABI overhead,
cold reads, decode execution, data posting, and memory-copy gas are additional.
"""
import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import struct
import zlib


PAGE_BYTES = 4_096
WORD_BYTES = 32
WORDS_PER_PAGE = PAGE_BYTES // WORD_BYTES
MAX_PAGES = 768 * 1024 * 1024 // PAGE_BYTES
TREE_DEPTH = (MAX_PAGES - 1).bit_length()
MAX_TX_GAS = 32_000_000
MAX_CODE_PAYLOAD = 24_575
ZERO_PAGE = bytes(PAGE_BYTES)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_page(source, label):
    page = source.read(PAGE_BYTES)
    require(len(page) == PAGE_BYTES, f"Truncated {label} capture")
    return page


@dataclass
class EncodingSize:
    size: int = 0
    zero_bytes: int = 0

    def add(self, data):
        self.size += len(data)
        self.zero_bytes += data.count(b"\x00")

    def budget(self, log_chunk_bytes, topics, compute_gas):
        nonzero = self.size - self.zero_bytes
        log_chunks = divide_up(self.size, log_chunk_bytes)
        code_chunks = divide_up(self.size, MAX_CODE_PAYLOAD)
        log_gas = self.size * 8 + log_chunks * (375 + topics * 375)
        code_gas = (self.size + code_chunks) * 200 + code_chunks * 32_000
        calldata_gas = self.zero_bytes * 4 + nonzero * 16
        calldata_floor = self.zero_bytes * 10 + nonzero * 40
        return {
            "bodyBytes": self.size,
            "logChunks": log_chunks,
            "logGasBeforeHostCosts": log_gas,
            "logComputePlusBodyGas": 21_000 + compute_gas + log_gas,
            "codeBlobs": code_chunks,
            "codeDepositAndCreateGas": code_gas,
            "codeComputePlusBodyGas": 21_000 + compute_gas + code_gas,
            "calldataIntrinsicBodyGas": calldata_gas,
            "calldataHighFloorBodyGas": calldata_floor,
            "calldataComputePlusBodyGasAtHighFloor": 21_000 + max(compute_gas + calldata_gas, calldata_floor),
        }


def divide_up(size, unit):
    return (size + unit - 1) // unit


def proof_siblings(leaves):
    active = set(leaves)
    count = 0
    for _ in range(TREE_DEPTH):
        count += sum((leaf ^ 1) not in active for leaf in active)
        active = {leaf >> 1 for leaf in active}
    return count


def compare(before_path, after_path, log_chunk_bytes, log_topics, compute_gas, read_pages, try_zlib):
    before_bytes = before_path.stat().st_size
    after_bytes = after_path.stat().st_size
    require(0 < before_bytes <= after_bytes <= MAX_PAGES * PAGE_BYTES
            and before_bytes % PAGE_BYTES == after_bytes % PAGE_BYTES == 0,
            "Expected nonshrinking, aligned guest captures within the pinned memory limit")
    before_digest = hashlib.sha256()
    after_digest = hashlib.sha256()
    changed_pages = set()
    changed_words = 0
    encodings = {name: EncodingSize() for name in ("wordOffsets", "pageWordBitmap", "wholePages")}
    if try_zlib:
        encodings["offlineZlibPages"] = EncodingSize()

    with before_path.open("rb") as before, after_path.open("rb") as after:
        for index in range(after_bytes // PAGE_BYTES):
            if index * PAGE_BYTES < before_bytes:
                old = read_page(before, "before")
                before_digest.update(old)
            else:
                old = ZERO_PAGE
            new = read_page(after, "after")
            after_digest.update(new)
            if old == new:
                continue

            changed_pages.add(index)
            page_index = struct.pack("<I", index)
            encodings["wholePages"].add(page_index + new)
            offsets, values, bitmap = bytearray(), bytearray(), 0
            for word in range(WORDS_PER_PAGE):
                offset = word * WORD_BYTES
                value = new[offset:offset + WORD_BYTES]
                if old[offset:offset + WORD_BYTES] != value:
                    bitmap |= 1 << word
                    offsets.extend(struct.pack("<I", index * PAGE_BYTES + offset))
                    offsets.extend(value)
                    values.extend(value)
            changed_words += len(values) // WORD_BYTES

            reconstructed = bytearray(old)
            for source in range(0, len(offsets), WORD_BYTES + 4):
                destination = struct.unpack_from("<I", offsets, source)[0] % PAGE_BYTES
                reconstructed[destination:destination + WORD_BYTES] = offsets[source + 4:source + 36]
            require(reconstructed == new, f"Word-offset round-trip failed on page {index}")

            reconstructed = bytearray(old)
            source = 0
            for word in range(WORDS_PER_PAGE):
                if bitmap & (1 << word):
                    destination = word * WORD_BYTES
                    reconstructed[destination:destination + WORD_BYTES] = values[source:source + WORD_BYTES]
                    source += WORD_BYTES
            require(source == len(values) and reconstructed == new, f"Word-bitmap round-trip failed on page {index}")
            encodings["wordOffsets"].add(offsets)
            encodings["pageWordBitmap"].add(page_index + bitmap.to_bytes(WORDS_PER_PAGE // 8, "little") + values)

            if try_zlib:
                compressed = zlib.compress(new, level=1)
                require(zlib.decompress(compressed) == new, f"Compression round-trip failed on page {index}")
                encodings["offlineZlibPages"].add(page_index + struct.pack("<I", len(compressed)) + compressed)
        require(not before.read(1) and not after.read(1), "Capture changed during the scan")

    report = {
        "scope": "offline-memory-representation-and-gas-arithmetic",
        "beforeSHA256": before_digest.hexdigest(),
        "afterSHA256": after_digest.hexdigest(),
        "beforeMemoryBytes": before_bytes,
        "afterMemoryBytes": after_bytes,
        "changedPages": len(changed_pages),
        "changedWords": changed_words,
        "modeledComputeGas": compute_gas,
        "gasLimit": MAX_TX_GAS,
        "staticGasIncludingCompute": 21_000 + compute_gas,
        "changedWordSstoreGasIfAllSlotsNew": changed_words * 22_100,
        "changedWordSstoreGasIfAllExistingNonzeroSlotsUpdated": changed_words * 5_000,
        "treeDepth": TREE_DEPTH,
        "dirtyLeafMultiproofSiblingBytes": 32 * proof_siblings(changed_pages),
        "representations": {
            name: size.budget(log_chunk_bytes, log_topics, compute_gas)
            for name, size in encodings.items()
        },
        "limits": [
            "A small body alone does not establish the 32M execution, data-availability, or recovery target.",
            "A binary-tree proof counts only sibling hashes. Dirty leaves are not the entire read set.",
            "L2 logs are receipt data; later contracts require authenticated pages in state or external witnesses.",
            "The zlib option measures off-chain compression only, without a consensus decoder or decoder gas.",
        ],
    }
    if read_pages is not None:
        require(all(page < after_bytes // PAGE_BYTES for page in read_pages), "Read trace contains an out-of-range page")
        report.update({
            "readPagesSupplied": len(read_pages),
            "uncompressedReadPageBytes": PAGE_BYTES * len(read_pages),
            "allTouchedMultiproofSiblingBytes": 32 * proof_siblings(changed_pages | read_pages),
        })
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path, help="Raw guest memory immediately before the group")
    parser.add_argument("after", type=Path, help="Raw guest memory immediately after the same group")
    parser.add_argument("--compute-gas", type=int, required=True, help="Explicit measured or hypothetical gas allowance for engine compute")
    parser.add_argument("--read-pages", type=Path, help="Optional JSON array of 4 KiB page indices read by the engine")
    parser.add_argument("--log-chunk-bytes", type=int, default=4096)
    parser.add_argument("--log-topics", type=int, default=3)
    parser.add_argument("--try-zlib", action="store_true", help="Also screen bounded off-chain per-page compression")
    args = parser.parse_args()
    try:
        require(0 <= args.compute_gas <= MAX_TX_GAS and args.log_chunk_bytes > 0 and 0 <= args.log_topics <= 4,
                "Invalid compute gas or log parameters")
        reads = None
        if args.read_pages:
            raw_reads = json.loads(args.read_pages.read_text(encoding="utf-8"))
            require(isinstance(raw_reads, list) and all(type(page) is int and page >= 0 for page in raw_reads),
                    "Expected an array of nonnegative page indices")
            reads = set(raw_reads)
        report = compare(args.before, args.after, args.log_chunk_bytes, args.log_topics, args.compute_gas, reads, args.try_zlib)
        print(json.dumps(report, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Checkpoint screen rejected: {error}\n")


if __name__ == "__main__":
    main()
