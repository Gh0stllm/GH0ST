#!/usr/bin/env python3
"""Compile an independent minimal Asyncify fixture using existing pinned local tools."""
from pathlib import Path
import subprocess
import icpp_binaryen as binaryen

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT.parents[1] / "engine"
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)
clang = ENGINE / ".cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin/clang++"
subprocess.run([str(clang), "-O2", "-fno-exceptions", "-fno-rtti", "-fno-builtin", "-fno-optimize-sibling-calls",
    "-nostdlib", "-Wl,--no-entry", "-Wl,--export-all", "-Wl,--allow-undefined", "-Wl,-z,stack-size=262144",
    str(ROOT / "fixture.cpp"), str(ROOT / "stack-switch.s"), "-o", str(BUILD / "fixture.raw.wasm")], check=True)
binaryen.ffi.cdef("void BinaryenModuleRunPasses(void*, const char**, int); void BinaryenSetPassArgument(const char*, const char*);")
binaryen.lib.BinaryenSetPassArgument(b"asyncify-removelist", b"gh0st_call_on_engine_stack,begin,advance,host_churn")
with binaryen.Module.load(BUILD / "fixture.raw.wasm") as module:
    pass_name = binaryen.ffi.new("char[]", b"asyncify")
    passes = binaryen.ffi.new("char*[]", [pass_name])
    binaryen.lib.BinaryenModuleRunPasses(module.ref, passes, 1)
    assert module.validate()
    module.write(BUILD / "fixture.asyncify.wasm")
print(BUILD / "fixture.asyncify.wasm")
