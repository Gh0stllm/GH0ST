#!/usr/bin/env python3
"""Build isolated quality-preserving adaptive24m experiment. No public deployment."""
from pathlib import Path
import argparse,json,re,shutil,subprocess,sys
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent
parser=argparse.ArgumentParser()
parser.add_argument('--volume-test',action='store_true')
parser.add_argument('--profile',action='store_true')
parser.add_argument('--expanded-affine',action='store_true')
parser.add_argument('--registers',type=int,choices=[12,16,24,32],default=12)
parser.add_argument('--dot',action='store_true',help='exact signed7 activation Wasm integer dot kernel')
parser.add_argument('--name',default='')
opt=parser.parse_args()
name=opt.name or ('optimized-volume' if opt.volume_test else 'optimized-profile' if opt.profile else 'optimized-engine')
assert re.fullmatch(r'[a-z0-9-]+',name)
CACHE=ENGINE/'.cache'/name;CACHE.mkdir(parents=True,exist_ok=True)
source=CACHE/'stockfish'
shutil.copytree(ENGINE/'.cache/Stockfish-icp/src',source,dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.nnue','*.o','*.a','stockfish'))
for name in ['runtime.cpp','adapter.cpp','engine.did','stack-switch.s','transform.py']:shutil.copyfile(HERE/name,CACHE/name)
search=(source/'search.cpp').read_text()
search='#include <cstdint>\nextern "C" void gh0st_stockfish_yield(std::uint64_t);\n'+search
anchor='    if (--callsCnt > 0)\n        return;';assert search.count(anchor)==1
(source/'search.cpp').write_text(search.replace(anchor,anchor+'\n\n    gh0st_stockfish_yield(worker.threads.nodes_searched());'))
if opt.profile:
 p=source/'nnue/network.cpp';s=p.read_text();s='#include <cstdint>\nextern "C" std::uint64_t gh0st_profile_now();\nextern "C" void gh0st_profile_nnue(std::uint64_t, std::uint64_t);\n'+s
 s=s.replace('    const auto psqt       = featureTransformer.transform(', '    const auto before_ft = gh0st_profile_now();\n    const auto psqt       = featureTransformer.transform(')
 s=s.replace('    const auto positional = network[bucket].propagate(', '    const auto before_affine = gh0st_profile_now();\n    const auto positional = network[bucket].propagate(')
 s=s.replace('    return {static_cast<Value>(psqt / OutputScale), static_cast<Value>(positional / OutputScale)};', '    gh0st_profile_nnue(before_affine-before_ft, gh0st_profile_now()-before_affine);\n    return {static_cast<Value>(psqt / OutputScale), static_cast<Value>(positional / OutputScale)};')
 p.write_text(s)
if opt.expanded_affine:
 from expanded_affine import patch
 patch(source)
if opt.registers!=12:
 p=source/'nnue/simd.h';s=p.read_text();s=s.replace('#define NumRegistersSIMD (Is64Bit ? 12 : 6)',f'#define NumRegistersSIMD {opt.registers}');p.write_text(s)
if opt.dot:
 p=source/'nnue/simd.h';s=p.read_text()
 old='''    #if defined(__wasm_relaxed_simd__)
    acc = wasm_i32x4_relaxed_dot_i8x16_i7x16_add(b, a, acc);
    #else'''
 new='''    #if defined(__wasm__)
    // NNUE activations are 0..127. Signed extmul is exact, and each pair
    // fits i16 (-32512..32258), so SSE maddubs saturation is unreachable.
    const auto lo = wasm_i16x8_extmul_low_i8x16(a, b);
    const auto hi = wasm_i16x8_extmul_high_i8x16(a, b);
    const auto even = wasm_i16x8_shuffle(lo, hi, 0,2,4,6,8,10,12,14);
    const auto odd  = wasm_i16x8_shuffle(lo, hi, 1,3,5,7,9,11,13,15);
    const auto pairs = wasm_i16x8_add(even, odd);
    acc = wasm_i32x4_add(acc, wasm_i32x4_dot_i16x8(pairs, wasm_i16x8_splat(1)));
    #elif defined(__wasm_relaxed_simd__)
    acc = wasm_i32x4_relaxed_dot_i8x16_i7x16_add(b, a, acc);
    #else'''
 assert s.count(old)==1;p.write_text(s.replace(old,new))
s=(ENGINE/'icpp.toml').read_text().replace('canister = "gh0st_stockfish19"','canister = "gh0st_stockfish_hybrid24"')
s=s.replace('"src/gh0st_engine.cpp"',json.dumps(str(CACHE/'adapter.cpp'))).replace('"src/canister.cpp"',json.dumps(str(CACHE/'runtime.cpp'))).replace('did_path = "src/engine.did"','did_path = '+json.dumps(str(CACHE/'engine.did')))
s=s.replace('.cache/Stockfish-icp/src',str(source))
for match in reversed(list(re.finditer(r'"((?:src/|include|\.cache/|\.\./\.cache/)[^"]*)"',s))):
 q=match.group(1)
 if q.startswith('../.cache/'):q=q[3:]
 s=s[:match.start()]+json.dumps(str(ENGINE/q))+s[match.end():]
s=s.replace('"-Wl,-z,stack-size=8388608",','"-Wl,-z,stack-size=8388608", '+json.dumps(str(CACHE/'stack-switch.o'))+', "-Wl,--export=gh0st_call_on_engine_stack", "-Wl,--export=gh0st_current_stack_pointer",')
flags=[]
if opt.volume_test:flags.append('-DHYBRID_TEST_VOLUME')
if opt.profile:flags.append('-DOPTIMIZED_PROFILE')
if opt.expanded_affine:flags.append('-DGH0ST_EXPANDED_AFFINE')
if flags:s=s.replace('cpp_compile_flags = [','cpp_compile_flags = ['+', '.join(json.dumps(f) for f in flags)+', ')
(CACHE/'icpp.toml').write_text(s)
if not (CACHE/'build-library').exists():(CACHE/'build-library').symlink_to(ENGINE/'build-library',target_is_directory=True)
clang=ENGINE/'.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin/clang'
subprocess.run([str(clang),'-c',str(CACHE/'stack-switch.s'),'-o',str(CACHE/'stack-switch.o')],check=True)
subprocess.run([sys.executable,str(ENGINE/'tools/icpp_local.py'),'build-wasm','--config',str(CACHE/'icpp.toml'),'--to-compile','mine-no-lib','--generate-bindings','no'],cwd=ENGINE,check=True)
subprocess.run([sys.executable,str(CACHE/'transform.py')],cwd=ENGINE,check=True)
(CACHE/'build-options.json').write_text(json.dumps(vars(opt),indent=2)+'\n')
print(CACHE/'engine.asyncify.wasm')
