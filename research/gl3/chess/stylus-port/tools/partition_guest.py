#!/usr/bin/env python3
"""Partition the pinned Stockfish Wasm into bounded immutable bytecode cells.

Cells hold interpreter inputs, never executable Stylus code. Output is local;
this tool does not deploy contracts or start a node.
"""

import argparse
import hashlib
import json
import mmap
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
from prepare_guest import Reader, digest, inspect_guest, require


CELL_CODE_LIMIT = 24_576
STOP_SENTINEL = b"\x00"
PAYLOAD_LIMIT = CELL_CODE_LIMIT - len(STOP_SENTINEL)
FRAGMENT_CAP = 4 * CELL_CODE_LIMIT
INDEX_WIDTH = 6


def ceil_cells(byte_count):
    return (byte_count + PAYLOAD_LIMIT - 1) // PAYLOAD_LIMIT


def sections(raw):
    module = Reader(raw, 8, len(raw))
    result = []
    while module.pos < module.end:
        start = module.pos
        tag = module.byte()
        body, end = module.span(module.integer())
        result.append({"tag": tag, "start": start, "body": body, "end": end})
    return result


def function_index(raw, metadata, function_section, code_section, packed_code_offset):
    types = Reader(raw, function_section["body"], function_section["end"])
    type_indices = [types.integer() for _ in range(types.integer())]
    types.complete()
    code = Reader(raw, code_section["body"], code_section["end"])
    require(code.integer() == len(type_indices), "Function declarations and bodies do not match")
    index = bytearray()
    rows = []
    imported = len(metadata["imports"])
    for ordinal, type_index in enumerate(type_indices):
        size = code.integer()
        original_offset, _ = code.span(size)
        offset = packed_code_offset + original_offset - code_section["start"]
        require(0 < size < 2**16 and offset < 2**24 and type_index < 2**8, "Function does not fit the compact index")
        index.extend(offset.to_bytes(3, "big") + size.to_bytes(2, "big") + bytes([type_index]))
        rows.append({"functionIndex": ordinal + imported, "offset": offset, "originalOffset": original_offset, "bytes": size})
    code.complete()
    return bytes(index), rows


def partition(raw):
    metadata = inspect_guest(raw)
    original_sections = sections(raw)
    core_sections = [section for section in original_sections if section["tag"] != 0]
    data = next(section for section in core_sections if section["tag"] == 11)
    function_section = next(section for section in core_sections if section["tag"] == 3)
    code_section = next(section for section in core_sections if section["tag"] == 10)
    code = bytearray(raw[:8])
    recipe = [{"tag": "header", "source": "code", "offset": 0, "bytes": 8}]
    semantic_hash = hashlib.sha256(raw[:8])
    for section in core_sections:
        start, end = section["start"], section["end"]
        source = "data" if section == data else "code"
        recipe.append({"tag": section["tag"], "source": source, "offset": len(code) if source == "code" else 0, "bytes": end - start})
        with memoryview(raw)[start:end] as view:
            semantic_hash.update(view)
            if source == "code":
                code.extend(view)
    packed_code_offset = next(item["offset"] for item in recipe if item["tag"] == 10)
    compact_index, rows = function_index(raw, metadata, function_section, code_section, packed_code_offset)
    for row in rows:
        start, source, length = row["offset"], row["originalOffset"], row["bytes"]
        require(code[start:start + length] == raw[source:source + length], "Function bytes moved incorrectly")

    data_size = data["end"] - data["start"]
    largest = max(rows, key=lambda row: row["bytes"])
    crossing = sum(row["offset"] // PAYLOAD_LIMIT != (row["offset"] + row["bytes"] - 1) // PAYLOAD_LIMIT for row in rows)
    groups = {"code": len(code), "functionIndex": len(compact_index), "data": data_size}
    return {
        "pinnedGuestSHA256": metadata["artifactSha256"],
        "pinnedNnueSHA256": metadata["nnue"]["sha256"],
        "coreWithSeedsSHA256": semantic_hash.hexdigest(),
        "coreWithSeedsBytes": len(code) + data_size,
        "removedCustomBytes": len(raw) - len(code) - data_size,
        "coreReassembly": recipe,
        "cellRuntime": {"maximumBytes": CELL_CODE_LIMIT, "maximumPayloadBytes": PAYLOAD_LIMIT,
                        "prefixHex": STOP_SENTINEL.hex(), "payloadOffset": 1},
        "bytesByGroup": groups,
        "cellsByGroup": {name: ceil_cells(size) for name, size in groups.items()},
        "codeSHA256": hashlib.sha256(code).hexdigest(),
        "dataSHA256": digest(raw, data["start"], data["end"]),
        "indexSHA256": hashlib.sha256(compact_index).hexdigest(),
        "functionIndex": {"records": len(rows), "firstFunction": len(metadata["imports"]), "recordBytes": INDEX_WIDTH,
                          "layout": ["code offset uint24 big-endian", "body byte length uint16 big-endian", "type index uint8"],
                          "totalBodyBytes": sum(row["bytes"] for row in rows),
                          "largestBody": {key: largest[key] for key in ("functionIndex", "bytes")},
                          "bodiesCrossingCellBoundaries": crossing},
        "seedRanges": [dict(segment, sourceOffset=segment["fileOffset"] - data["start"]) for segment in metadata["dataSegments"]],
        "wasmDataRemovedForCodeSizeMeasurement": True,
        "directlyActivatableStylusCode": False,
    }, bytes(code), compact_index, data


def measure_brotli(code):
    # Only the sub-MiB code stream is compressed. The native NNUE is untouched.
    program = """const { brotliCompressSync, constants } = require('node:zlib');
const code = require('node:fs').readFileSync(0);
const sizes = Object.fromEntries([1, 5, 9, 11].map(q => [q, brotliCompressSync(code, {
  params: { [constants.BROTLI_PARAM_QUALITY]: q }
}).length]));
process.stdout.write(JSON.stringify(sizes));"""
    result = subprocess.run(["node", "-e", program], input=code, capture_output=True, check=True, timeout=10)
    sizes = json.loads(result.stdout)
    return {"compressedBytesByQuality": sizes, "fourFragmentCeilingBytes": FRAGMENT_CAP,
            "fitsFourFragmentsAtAnyMeasuredQuality": any(size <= FRAGMENT_CAP for size in sizes.values())}


def write_cells(directory, name, source):
    entries = []
    for page in range(ceil_cells(len(source))):
        offset = page * PAYLOAD_LIMIT
        payload = source[offset:offset + PAYLOAD_LIMIT]
        runtime = STOP_SENTINEL + bytes(payload)
        filename = f"{name}-{page:04d}.bin"
        with (directory / filename).open("xb") as file:
            require(file.write(runtime) == len(runtime), "Short cell output write")
        entries.append({"file": filename, "offset": offset, "payloadBytes": len(payload),
                        "runtimeSHA256": hashlib.sha256(runtime).hexdigest()})
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("guest", type=Path)
    parser.add_argument("--brotli", action="store_true", help="Measure the model-free code stream with Node's Brotli")
    parser.add_argument("--output-dir", type=Path, help="Emit code and index cells to a new directory")
    parser.add_argument("--emit-data", action="store_true", help="Also emit original data cells (about 99 MB)")
    args = parser.parse_args()
    if args.emit_data and args.output_dir is None:
        parser.error("--emit-data requires --output-dir")
    try:
        with args.guest.open("rb") as artifact, mmap.mmap(artifact.fileno(), 0, access=mmap.ACCESS_READ) as raw:
            manifest, code, index, data = partition(raw)
            if args.brotli:
                manifest["brotliMeasurement"] = measure_brotli(code)
            if args.output_dir:
                args.output_dir.mkdir(parents=True, exist_ok=False)
                cells = {"code": write_cells(args.output_dir, "code", code),
                         "functionIndex": write_cells(args.output_dir, "index", index)}
                if args.emit_data:
                    with memoryview(raw)[data["start"]:data["end"]] as view:
                        cells["data"] = write_cells(args.output_dir, "data", view)
                manifest["emittedCells"] = cells
                (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(manifest, indent=2))
    except (OSError, ValueError, StopIteration, subprocess.SubprocessError) as error:
        parser.exit(1, f"Guest partition stopped: {error}\n")


if __name__ == "__main__":
    main()
