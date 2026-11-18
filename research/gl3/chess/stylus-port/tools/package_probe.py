#!/usr/bin/env python3
"""Package precompiled Wasm into a single stock Stylus contract locally."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


WASM_HEADER = b"\x00asm\x01\x00\x00\x00"
STYLUS_PREFIX = bytes.fromhex("eff00000")
MAX_WASM_BYTES = 256 * 1024
MAX_RUNTIME_BYTES = 24_576
INIT_HEADER_BYTES = 15
BROTLI = """
const { brotliCompressSync, brotliDecompressSync, constants } = require('node:zlib');
const fs = require('node:fs');
const raw = fs.readFileSync(0);
const compressed = brotliCompressSync(raw, { params: {
  [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
  [constants.BROTLI_PARAM_QUALITY]: 11,
  [constants.BROTLI_PARAM_LGWIN]: 22,
} });
const decoded = brotliDecompressSync(compressed, { maxOutputLength: 256 * 1024 });
if (!decoded.equals(raw)) throw new Error('Brotli round trip differed from the pinned Wasm');
process.stdout.write(compressed);
"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def package(wasm, expected_sha256):
    if not 8 < len(wasm) <= MAX_WASM_BYTES:
        raise ValueError(f"Wasm must fit the {MAX_WASM_BYTES}-byte precompression limit")
    if wasm[:len(WASM_HEADER)] != WASM_HEADER:
        raise ValueError("Expected a version 1 WebAssembly module")
    if sha256(wasm) != expected_sha256:
        raise ValueError("Wasm SHA-256 does not match the expected build")

    result = subprocess.run(["node", "-e", BROTLI], input=wasm, capture_output=True, check=True, timeout=20)
    runtime = STYLUS_PREFIX + result.stdout
    if len(runtime) > MAX_RUNTIME_BYTES:
        raise ValueError(f"Prefixed runtime is {len(runtime)} bytes and a single contract allows {MAX_RUNTIME_BYTES}")

    size = len(runtime).to_bytes(2, "big")
    offset = INIT_HEADER_BYTES.to_bytes(2, "big")
    # PUSH2 size; PUSH2 offset; PUSH1 0; CODECOPY; PUSH2 size; PUSH1 0; RETURN.
    constructor = b"\x61" + size + b"\x61" + offset + b"\x60\x00\x39\x61" + size + b"\x60\x00\xf3"
    if len(constructor) != INIT_HEADER_BYTES:
        raise ValueError("Constructor offset is inconsistent")
    initcode = constructor + runtime

    return {
        "schema": "gh0st.stylus-probe-package.v1",
        "inputWasmBytes": len(wasm),
        "inputWasmSHA256": expected_sha256,
        "BrotliQuality": 11,
        "window": 22,
        "dictionary": 0,
        "compressedWasmBytes": len(result.stdout),
        "decompressedBytesExactlyMatchInput": True,
        "prefix": STYLUS_PREFIX.hex(),
        "runtimeBytes": len(runtime),
        "runtimeSHA256": sha256(runtime),
        "initCodeBytes": len(initcode),
        "initCodeSHA256": sha256(initcode),
        "initCode": "0x" + initcode.hex(),
        "activationVerified": False,
        "executionVerified": False,
        "transactionsSubmitted": 0,
    }


def write_manifest(path, metadata):
    # A failed write leaves no partial manifest, and an existing package is kept.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent) as temporary:
        json.dump(metadata, temporary, indent=2)
        temporary.write("\n")
        temporary.flush()
        os.link(temporary.name, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wasm", type=Path)
    parser.add_argument("output", type=Path, help="New JSON package file")
    parser.add_argument("--expected-sha256", type=str.lower, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{64}", args.expected_sha256):
        parser.error("--expected-sha256 must be a 64-character hex digest")
    try:
        with args.wasm.open("rb") as artifact:
            wasm = artifact.read(MAX_WASM_BYTES + 1)
        metadata = package(wasm, args.expected_sha256)
        write_manifest(args.output, metadata)
        print(f"Packaged {metadata['inputWasmBytes']} Wasm bytes into {metadata['runtimeBytes']} prefixed runtime bytes")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Probe packaging stopped: {error}\n")


if __name__ == "__main__":
    main()
