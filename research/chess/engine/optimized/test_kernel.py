#!/usr/bin/env python3
"""Actual Wasm SIMD versus scalar u32 arithmetic, all endpoint pair bounds."""
from pathlib import Path
import hashlib,json,subprocess,wasmtime
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent;cache=ENGINE/'.cache/optimized-kernel';cache.mkdir(exist_ok=True)
clang=ENGINE/'.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin/clang++';out=cache/'kernel.wasm'
subprocess.run([str(clang),'-O3','-fno-vectorize','-fno-slp-vectorize','-msimd128','-nostdlib','-Wl,--no-entry','-Wl,--export=test_kernel',str(HERE/'kernel_exactness.cpp'),'-o',str(out)],check=True)
e=wasmtime.Engine();m=wasmtime.Module(e,out.read_bytes());s=wasmtime.Store(e);i=wasmtime.Instance(s,m,[])
seeds=[1,0x12345678,0x80000000,0xffffffff];cases=250000
results=[{'seed':seed,'cases':cases,'mismatches':i.exports(s)['test_kernel'](s,seed,cases)}for seed in seeds]
assert all(x['mismatches']==0 for x in results)
r={'scope':'actual deterministic Wasm integer SIMD arithmetic unit proof; no canister install or search strength claim','activation_range':[0,127],'weight_range':[-128,127],'pair_sum_range':[-32512,32258],'sse_pair_saturation_unreachable':True,'i32_accumulation':'identical modulo 2^32, including randomized bias wraparound','endpoint_pair_cases_per_seed':128*128*4*4,'random_4output_blocks':cases*len(seeds),'random_output_comparisons':cases*len(seeds)*4,'results':results,'wasm_sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
(HERE/'evidence/kernel-exactness.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
