#!/usr/bin/env python3
"""Isolated instrumented native SF19 copy. Never edits the match/baseline build."""
from pathlib import Path
import json
import re
import shutil
import subprocess

ROOT=Path(__file__).resolve().parent
SRC=ROOT.parent/'engine/.cache/Stockfish/src'
DEST=ROOT/'.cache/instrumented-src'
assert not DEST.exists(), 'Use a fresh isolated destination; do not patch twice'
shutil.copytree(SRC.parent/'scripts',DEST.parent/'scripts',dirs_exist_ok=True)
shutil.copytree(SRC,DEST,ignore=shutil.ignore_patterns('*.nnue'))
(DEST/'nn-1a298aa575a0.nnue').symlink_to(SRC/'nn-1a298aa575a0.nnue')
names=['network_evaluations','accumulator_evaluations','incremental_single',
       'incremental_both','hybrid_refresh','cache_refresh']
declarations='#include <cstdint>\n'+''.join('extern std::uint64_t gh0st_'+x+';\n' for x in names)

def patch_file(path,edits):
 original=path.read_text(); s=original
 for name,code in edits:
  pattern=r'('+re.escape(name)+r'\([^;{}]+\)(?:\s*const)?(?:\s*noexcept)?\s*\{)'
  s,n=re.subn(pattern,lambda m:m[1]+'\n'+code,s,count=1)
  assert n==1,name
 path.write_text(declarations+s)

patch_file(DEST/'nnue/network.cpp',[('Network::evaluate','    ++::gh0st_network_evaluations;')])
needle='    const auto positional = network[bucket].propagate(transformedFeatures, nnzInfo);'
capture='''
    if ((::gh0st_network_evaluations-1)%100000 == 0) {
        if (const char* path=std::getenv("GH0ST_NNUE_DUMP_PATH")) {
            std::ofstream dump(path,std::ios::binary|std::ios::app);
            const std::int32_t b=bucket,p=positional;
            dump.write(reinterpret_cast<const char*>(&b),4);
            dump.write(reinterpret_cast<const char*>(&p),4);
            dump.write(reinterpret_cast<const char*>(transformedFeatures),1024);
        }
    }
'''
network=(DEST/'nnue/network.cpp').read_text()
assert network.count(needle)==1
(DEST/'nnue/network.cpp').write_text('#include <cstdlib>\n'+network.replace(needle,needle+capture))
patch_file(DEST/'nnue/nnue_accumulator.cpp',[
 ('AccumulatorStack::evaluate','    ++::gh0st_accumulator_evaluations;'),
 ('update_accumulator_incremental','    ++::gh0st_incremental_single;'),
 ('update_accumulator_incremental_both','    ++::gh0st_incremental_both;'),
 ('update_accumulator_hybrid','    ++::gh0st_hybrid_refresh;'),
 ('update_accumulator_refresh_cache','    ++::gh0st_cache_refresh;')])
main=(DEST/'main.cpp').read_text()
definitions='#include <cstdint>\n'+''.join('std::uint64_t gh0st_'+x+'=0;\n' for x in names)
line='    std::cout << "info string GH0ST_COUNTERS {"'
for i,name in enumerate(names):
 line+=' << "'+('' if i==0 else ',')+'\\"'+name+'\\":" << gh0st_'+name
line+=' << "}" << std::endl;\n'
assert main.count('    uci->loop();')==1
(DEST/'main.cpp').write_text(definitions+main.replace('    uci->loop();','    uci->loop();\n    uci.reset();\n'+line))
with (ROOT/'.cache/instrument-build.log').open('w') as out:
 subprocess.run(['make','-j2','build','ARCH=apple-silicon','COMP=clang'],cwd=DEST,stdout=out,stderr=subprocess.STDOUT,check=True)
print(DEST/'stockfish')
