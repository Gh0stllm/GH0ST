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
CONFIG_SLOT = bytes([0x6C]) * 32
CHECKPOINT_SLOT = bytes([0x6D]) * 32
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


def package(wasm, expected_sha256, config=None, checkpoint=None):
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

    if (config is None) != (checkpoint is None):
        raise ValueError("An initialized search package needs both commitments")
    storage = b""
    if config is not None:
        if any(len(word) != 32 or not any(word) for word in (config, checkpoint)):
            raise ValueError("Initial commitments must be nonzero 32-byte values")
        storage = b"".join(b"\x7f" + value + b"\x7f" + slot + b"\x55"
                           for slot, value in ((CONFIG_SLOT, config), (CHECKPOINT_SLOT, checkpoint)))
    size = len(runtime).to_bytes(2, "big")
    offset = (INIT_HEADER_BYTES + len(storage)).to_bytes(2, "big")
    # PUSH2 size; PUSH2 offset; PUSH1 0; CODECOPY; PUSH2 size; PUSH1 0; RETURN.
    constructor = b"\x61" + size + b"\x61" + offset + b"\x60\x00\x39\x61" + size + b"\x60\x00\xf3"
    if len(constructor) != INIT_HEADER_BYTES:
        raise ValueError("Constructor offset is inconsistent")
    initcode = storage + constructor + runtime

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
        "initializedSearch": config is not None,
        "configCommitment": config.hex() if config is not None else None,
        "initialCheckpoint": checkpoint.hex() if checkpoint is not None else None,
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
    parser.add_argument("--config-commitment", help="32-byte Keccak of the reviewed search configuration")
    parser.add_argument("--initial-checkpoint", help="32-byte committed head of the reviewed initialized guest")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{64}", args.expected_sha256):
        parser.error("--expected-sha256 must be a 64-character hex digest")
    try:
        with args.wasm.open("rb") as artifact:
            wasm = artifact.read(MAX_WASM_BYTES + 1)
        arguments = [args.config_commitment, args.initial_checkpoint]
        if any(value is not None and not re.fullmatch(r"[0-9a-fA-F]{64}", value) for value in arguments):
            raise ValueError("Commitments must each be exactly 64 hex characters")
        config, checkpoint = (None if value is None else bytes.fromhex(value) for value in arguments)
        metadata = package(wasm, args.expected_sha256, config, checkpoint)
        write_manifest(args.output, metadata)
        print(f"Packaged {metadata['inputWasmBytes']} Wasm bytes into {metadata['runtimeBytes']} prefixed runtime bytes")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Probe packaging stopped: {error}\n")


if __name__ == "__main__":
    main()
