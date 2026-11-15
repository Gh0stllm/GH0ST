#!/usr/bin/env python3
"""Build test-only native retained checkpoint prototype in its isolated cache."""
from pathlib import Path
import hashlib,json,shutil,subprocess
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent;CACHE=ENGINE/'.cache/prefix-cache-native';SRC=CACHE/'src'
assert subprocess.check_output(['git','-C',str(ENGINE/'.cache/Stockfish'),'rev-parse','HEAD'],text=True).strip()=='edb0d9db6731067ec50ce619ff372b463bc4dd5d'
model=ENGINE/'.cache/Stockfish/src/nn-1a298aa575a0.nnue'
assert model.stat().st_size==98511183 and hashlib.sha256(model.read_bytes()).hexdigest()=='1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2'
assert 'static_assert(sizeof(Cluster) == 32' in (ENGINE/'.cache/Stockfish/src/tt.cpp').read_text()
SRC.mkdir(parents=True,exist_ok=True)
def copy_changed(a,b):
 a,b=Path(a),Path(b)
 if not b.exists() or a.read_bytes()!=b.read_bytes():shutil.copy2(a,b)
 return str(b)
shutil.copytree(ENGINE/'.cache/Stockfish/src',SRC,dirs_exist_ok=True,copy_function=copy_changed,ignore=shutil.ignore_patterns('engine.h','search.h','tt.h','timeman.h','Makefile','*.o','*.nnue','stockfish','*.d','.depend','*.profdata','*.profraw'))
shutil.copytree(ENGINE/'.cache/Stockfish/scripts',CACHE/'scripts',dirs_exist_ok=True,copy_function=copy_changed)
for n in ['engine.h','search.h','tt.h','timeman.h']:
 p=SRC/n;s=(ENGINE/'.cache/Stockfish/src'/n).read_text();anchor='namespace Stockfish {';assert anchor in s;s=s.replace(anchor,anchor+'\nstruct CheckpointAccess;',1)
 cls={'engine.h':'class Engine {','search.h':'class Worker {','tt.h':'class TranspositionTable {','timeman.h':'class TimeManagement {'}[n]
 assert s.count(cls)==1;s=s.replace(cls,cls+'\n    friend struct ::Stockfish::CheckpointAccess;',1)
 if not p.exists() or p.read_text()!=s:p.write_text(s)
for n in ['checkpoint.h','prefix_probe.cpp']:copy_changed(HERE/n,SRC/n)
sha=ENGINE/'.cache/venv/lib/python3.13/site-packages/icpp_candid/vendors/hash-library'
for n in ['sha256.h','sha256.cpp','icpp_hash_library_utils.h','icpp_hash_library_utils.cpp']:copy_changed(sha/n,SRC/n)
p=SRC/'Makefile';s=(ENGINE/'.cache/Stockfish/src/Makefile').read_text().replace('evaluate.cpp main.cpp','evaluate.cpp prefix_probe.cpp sha256.cpp icpp_hash_library_utils.cpp')
if not p.exists() or p.read_text()!=s:p.write_text(s)
for n in (ENGINE/'.cache/Stockfish/src').glob('*.nnue'):
 dest=SRC/n.name
 if not dest.exists():dest.symlink_to(n)
subprocess.run(['make','-j4','build','ARCH=apple-silicon','COMP=clang','EXTRACXXFLAGS=-fexceptions'],cwd=SRC,check=True)
out={'scope':'test-only native prefix checkpoint executable; not ICP or production','source_commit':'edb0d9db6731067ec50ce619ff372b463bc4dd5d','nnue_sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'binary_sha256':hashlib.sha256((SRC/'stockfish').read_bytes()).hexdigest(),'source_sha256':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ['checkpoint.h','prefix_probe.cpp','build_native.py']}}
(HERE/'evidence').mkdir(exist_ok=True);(HERE/'evidence/native-build.json').write_text(json.dumps(out,indent=2)+'\n');print(SRC/'stockfish')
