#!/usr/bin/env python3
"""Build the pinned wasm2c translation, screening stock Stylus code size."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import mmap
from pathlib import Path
import shutil
import subprocess
import time

import brotli

from lower_wabt_header import lower
from prepare_guest import Reader, audit_generator, export_seeds, inspect_guest

ROOT = Path(__file__).resolve().parent.parent
ORIGINAL_ADAPTER = ROOT.parent / "sliced/aot/adapter.c"
STYLUS_WASM_BYTES = 256 * 1024
STYLUS_COMPRESSED_BYTES = 4 * (24_576 - 3)
BINDINGS = (
    "gl3aot_create", "gl3aot_destroy", "gl3aot_memory_size",
    "gl3aot_call", "gl3aot_global_get", "gl3aot_global_set",
)


def run(args):
    subprocess.run([str(arg) for arg in args], check=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build_objects(cc, flags, sources, output, jobs):
    output.mkdir()

    def compile_source(source):
        dest = output / (source.stem + ".o")
        run([cc, *flags, "-c", source, "-o", dest])
        return dest

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        return list(pool.map(compile_source, sources))


def section_sizes(wasm):
    if wasm[:8] != b"\0asm\1\0\0\0":
        raise ValueError("Compiler did not emit a Wasm module")
    reader = Reader(wasm, 8, len(wasm))
    sizes = {}
    while reader.pos < reader.end:
        number = reader.byte()
        start, end = reader.span(reader.integer())
        sizes[number] = sizes.get(number, 0) + end - start
    return {"codeSectionBytes": sizes.get(10, 0), "dataSectionBytes": sizes.get(11, 0)}


def prepare_wasi_runtime(source, destination):
    destination.mkdir()
    for file in source.glob("wasm-rt*"):
        if file.is_file():
            shutil.copy2(file, destination / file.name)
    header = destination / "wasm-rt.h"
    contents = header.read_text()
    start = contents.index("#ifdef WASM_RT_C11_AVAILABLE\n#define WASM_RT_THREAD_LOCAL")
    end = contents.index("\n/**", start)
    header.write_text(contents[:start] + "#define WASM_RT_THREAD_LOCAL\n" + contents[end:])
    # The sizing candidate runs in one thread. WABT traps terminate its Wasm invocation.
    # No guest entry point enters a WABT exception or setjmp scope.
    (destination / "setjmp.h").write_text(
        "#pragma once\ntypedef unsigned int jmp_buf[1];\n"
        "#define setjmp(buf) (__builtin_trap(), 0)\n"
        "#define sigsetjmp(buf, save) (__builtin_trap(), 0)\n"
        "#define longjmp(buf, val) __builtin_trap()\n"
        "#define siglongjmp(buf, val) __builtin_trap()\n"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("guest", type=Path)
    parser.add_argument("generated", type=Path)
    parser.add_argument("wabt_source", type=Path)
    parser.add_argument("wasi_clang", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Choose a new output directory")
    began = time.monotonic()
    for option in ("guest", "generated", "wabt_source", "wasi_clang", "output"):
        setattr(args, option, getattr(args, option).resolve())

    audit_generator(args.generated)
    generated = args.output / "generated"
    shutil.copytree(args.generated, generated)
    header = generated / "gl3vm-impl.h"
    header.write_text(lower(header.read_bytes()))
    seed_dir = args.output / "seeds"
    with args.guest.open("rb") as file, mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as guest:
        manifest = inspect_guest(guest)
        export_seeds(seed_dir, guest, manifest)

    runtime = args.wabt_source / "wasm2c"
    inputs = sorted(generated.glob("gl3vm_*.c")) + [
        runtime / "wasm-rt-impl.c", runtime / "wasm-rt-mem-impl.c",
        runtime / "wasm-rt-exceptions-impl.c", ORIGINAL_ADAPTER,
    ]
    common = [
        "-std=c99", "-fno-strict-aliasing", "-ffp-contract=off",
        "-DWASM_RT_USE_MMAP=0", "-DWASM_RT_MEMCHECK_BOUNDS_CHECK=1",
        "-DWASM_RT_STACK_DEPTH_COUNT=1", "-DWASM_RT_MAX_CALL_STACK_DEPTH=10000",
        "-DSIMDE_NO_NATIVE", "-I" + str(generated), "-I" + str(runtime),
        "-I" + str(args.wabt_source / "third_party/simde"),
        "-I" + str(ROOT / "tools"),
    ]
    native = build_objects("cc", [*common, "-O2", "-fPIC", "-fno-tree-vectorize"],
                           inputs + [ROOT / "probe/aot_flat_memory.c"],
                           args.output / "native-objects", args.jobs)
    seed_source = args.output / "native-segments.S"
    seed_source.write_text("\n".join(
        f'.section .rodata\n.balign 16\n.globl {name}\n{name}:\n.incbin "{seed_dir / f"segment-{i}.bin"}"'
        for i, name in enumerate(("data_segment_data_w2c_gl3vm_d0", "data_segment_data_w2c_gl3vm_d1"))
    ) + '\n.section .note.GNU-stack,"",@progbits\n')
    seed_obj = args.output / "native-segments.o"
    run(["cc", "-c", seed_source, "-o", seed_obj])
    library = args.output / "libgl3aot.so"
    run(["cc", "-shared", *native, seed_obj, "-lm", "-o", library])

    wasi_runtime = args.output / "wasi-runtime"
    prepare_wasi_runtime(runtime, wasi_runtime)
    wasi_inputs = [wasi_runtime / source.name if source.parent == runtime else source for source in inputs]
    variants = {}
    for profile, opt, link_time in (("O2", "O2", []), ("Oz", "Oz", []), ("Oz-lto", "Oz", ["-flto"])):
        flags = ["-I" + str(wasi_runtime), *common, f"-{opt}", "-mno-simd128", "-fno-vectorize",
                 "-fno-slp-vectorize", "-ffunction-sections", "-fdata-sections", *link_time]
        objects = build_objects(args.wasi_clang, flags, wasi_inputs, args.output / profile, args.jobs)
        wasm_file = args.output / f"compiled-{profile}.wasm"
        run([args.wasi_clang, "-nostartfiles", "-Wl,--no-entry", "-Wl,--strip-all",
             "-Wl,--unresolved-symbols=import-functions", "-Wl,-z,stack-size=1572864",
             "-Wl,--max-memory=8388608", f"-{opt}", *link_time, *[f"-Wl,--export={name}" for name in BINDINGS],
             *objects, "-o", wasm_file])
        wasm = wasm_file.read_bytes()
        compressed = brotli.compress(wasm, quality=11, lgwin=22)
        if brotli.decompress(compressed) != wasm:
            raise ValueError("Brotli round trip changed the compiled program")
        variants[profile] = {
            "wasmBytes": len(wasm), "wasmSHA256": sha(wasm), "brotliBytes": len(compressed),
            "withinStockSizeLimits": len(wasm) <= STYLUS_WASM_BYTES
            and len(compressed) <= STYLUS_COMPRESSED_BYTES, **section_sizes(wasm),
        }

    report = {
        "scope": "AOT code sizing with external guest-memory bindings. Native parity uses the exact seed in a local host.",
        "guestSHA256": manifest["artifactSha256"], "modelSHA256": manifest["nnue"]["sha256"],
        "nativeLibrarySHA256": sha(library.read_bytes()),
        "wasiCompiler": subprocess.check_output([str(args.wasi_clang), "--version"], text=True).splitlines()[0],
        "maxStockWasmBytes": STYLUS_WASM_BYTES, "maxStockBrotliPayloadBytes": STYLUS_COMPRESSED_BYTES,
        "variants": variants, "elapsedSeconds": time.monotonic() - began,
        "stylusActivated": False, "publicDeployment": False,
    }
    (args.output / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
