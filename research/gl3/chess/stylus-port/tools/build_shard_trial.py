#!/usr/bin/env python3
"""Build exact Stockfish units as ELF shards and independently sized Wasm units."""

import argparse
import json
import mmap
from pathlib import Path
import re
import shutil

import brotli

from build_aot_candidate import (
    ORIGINAL_ADAPTER, ROOT, STYLUS_COMPRESSED_BYTES, STYLUS_WASM_BYTES,
    build_objects, prepare_wasi_runtime, run, section_sizes, sha,
)
from lower_wabt_header import lower
from prepare_guest import audit_generator, export_seeds, inspect_guest


def split_size_limited_units(directory):
    # Original units 1, 2, 3 and 6 exceeded the 256 KiB raw limit.
    # Their numbered functions use declarations in the same audited header.
    for next_id, unit_id in enumerate((1, 2, 3, 6), 8):
        original = directory / f"gl3vm_{unit_id}.c"
        contents = original.read_text()
        definitions = list(re.finditer(r"^\w+ w2c_gl3vm_f\d+\(", contents, re.MULTILINE))
        if len(definitions) < 2:
            raise ValueError(f"Expected independently defined functions in unit {unit_id}")
        boundary = min(definitions[1:], key=lambda item: abs(item.start() - len(contents) / 2)).start()
        if not contents[:boundary].rstrip().endswith("}"):
            raise ValueError(f"Unit {unit_id} is missing a complete function boundary")
        original.write_text(contents[:boundary])
        new_unit = directory / f"gl3vm_{next_id}.c"
        new_unit.write_text('#include "gl3vm-impl.h"\n\n' + contents[boundary:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("guest", "generated", "wabt_source", "wasi_clang", "output"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    for name in ("guest", "generated", "wabt_source", "wasi_clang", "output"):
        setattr(args, name, getattr(args, name).resolve())
    if args.output.exists():
        parser.error("Choose a new output directory")

    audit_generator(args.generated)
    generated = args.output / "generated"
    shutil.copytree(args.generated, generated)
    header = generated / "gl3vm-impl.h"
    header.write_text(lower(header.read_bytes()))
    split_size_limited_units(generated)
    with args.guest.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as guest:
        manifest = inspect_guest(guest)
        export_seeds(args.output / "seeds", guest, manifest)

    runtime = args.wabt_source / "wasm2c"
    includes = (generated, runtime, args.wabt_source / "third_party/simde", ROOT / "tools")
    units = sorted(generated.glob("gl3vm_*.c"), key=lambda unit: int(unit.stem.split("_")[-1]))
    common = [
        "-std=c99", "-ffp-contract=off", "-fno-strict-aliasing", "-DSIMDE_NO_NATIVE",
        "-DWASM_RT_USE_MMAP=0", "-DWASM_RT_MEMCHECK_BOUNDS_CHECK=1",
        "-DWASM_RT_STACK_DEPTH_COUNT=1", "-DWASM_RT_MAX_CALL_STACK_DEPTH=10000",
        *[f"-I{path}" for path in includes],
    ]
    native = [*common, "-O2", "-fPIC", "-fno-tree-vectorize"]
    trace = ["-finstrument-functions", "-fno-optimize-sibling-calls",
             "-finstrument-functions-exclude-file-list=gl3vm-impl.h,wasm-rt.h,simde"]
    parts = build_objects("cc", [*native, *trace], units, args.output / "shared-objects", args.jobs)
    libs = []
    for part in parts:
        # Route the probes around libc's no-op instrumentation symbols.
        run(["objcopy", "--redefine-sym", "__cyg_profile_func_enter=gl3shards_enter",
             "--redefine-sym", "__cyg_profile_func_exit=gl3shards_exit", part])
        library = args.output / f"lib{part.stem}.so"
        run(["cc", "-shared", f"-Wl,-soname,{library.name}", part, "-o", library])
        libs.append(library)
    host = build_objects("cc", native, [
        runtime / "wasm-rt-impl.c", runtime / "wasm-rt-mem-impl.c", runtime / "wasm-rt-exceptions-impl.c",
        ORIGINAL_ADAPTER, ROOT / "probe/aot_flat_memory.c", ROOT / "probe/shard_counter.c",
    ], args.output / "host-objects", args.jobs)
    seed = args.output / "seed.S"
    lines = []
    for i in range(2):
        symbol = f"data_segment_data_w2c_gl3vm_d{i}"
        path = args.output / "seeds" / f"segment-{i}.bin"
        lines.extend([".section .rodata", ".balign 16", f".globl {symbol}", f"{symbol}:", f'.incbin "{path}"'])
    lines.append('.section .note.GNU-stack,"",@progbits')
    seed.write_text("\n".join(lines) + "\n")
    program = args.output / "libgl3shards.so"
    run(["cc", "-shared", *host, seed, "-Wl,--no-as-needed", *libs,
         "-Wl,-rpath,$ORIGIN", "-ldl", "-lm", "-o", program])
    print(f"ELF shards ready in {args.output}", flush=True)

    wasi_runtime = args.output / "wasi-runtime"
    prepare_wasi_runtime(runtime, wasi_runtime)
    wasm_flags = [f"-I{wasi_runtime}", *common, "-Oz", "-mno-simd128", "-mno-bulk-memory",
                  "-fno-vectorize", "-fno-slp-vectorize", "-Wno-pass-failed", "-D_WASI_EMULATED_MMAN"]
    wasm_objects = build_objects(args.wasi_clang, wasm_flags, units, args.output / "wasm-objects", args.jobs)
    measurements = []
    for part in wasm_objects:
        binary = args.output / f"{part.stem}.wasm"
        # Export all unit functions. Missing dependencies stay imports or unresolved data.
        # This link measures code size before adding the contract ABI and memory backend.
        run([args.wasi_clang, "-nostartfiles", "-Oz", "-Wl,--no-entry", "-Wl,--export-all",
             "-Wl,--allow-undefined", "-Wl,--strip-all", "-Wl,--max-memory=8388608", part, "-o", binary])
        wasm = binary.read_bytes()
        compressed = brotli.compress(wasm, quality=11, lgwin=22)
        if brotli.decompress(compressed) != wasm:
            raise ValueError("Wasm sizing compression changed bytes")
        measurements.append({"unit": part.stem, "wasmBytes": len(wasm), "brotliBytes": len(compressed),
                             "withinStockSizeLimits": len(wasm) <= STYLUS_WASM_BYTES
                             and len(compressed) <= STYLUS_COMPRESSED_BYTES,
                             "wasmSHA256": sha(wasm), **section_sizes(wasm)})

    report = {"scope": "Independent unit size screening before host linkage or Stylus activation",
              "guestSHA256": manifest["artifactSha256"], "modelSHA256": manifest["nnue"]["sha256"],
              "units": measurements, "activated": False}
    (args.output / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
