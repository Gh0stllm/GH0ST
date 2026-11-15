#!/usr/bin/env python3
"""Inspect the actual hybrid module and verify full NNUE bytes in initial memory."""
from pathlib import Path
import hashlib,json,wasmtime
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent
b=(ENGINE/'.cache/hybrid-engine/engine.asyncify.wasm').read_bytes();e=wasmtime.Engine();m=wasmtime.Module(e,b);s=wasmtime.Store(e);fs=[]
for i in m.imports:
 n=len(i.type.results);fs.append(wasmtime.Func(s,i.type,lambda *args,n=n:None if n==0 else(0 if n==1 else[0]*n)))
x=wasmtime.Instance(s,m,fs);mem=x.exports(s)['memory'];data=mem.read(s,0,mem.data_len(s));net=(ENGINE/'.cache/Stockfish/src/nn-1a298aa575a0.nnue').read_bytes()
exports=[x.name for x in m.exports if x.name.startswith('canister_')]
r={'scope':'Production-target hybrid engine artifact inspection; live deployment/integration approval separate','wasm_sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'mib':len(b)/2**20,'only_ic0_imports':all(i.module=='ic0' for i in m.imports),'full_nnue_initial_memory_verified':data.find(net)>=0,'nnue_sha256':hashlib.sha256(net).hexdigest(),'engine_commit':'edb0d9db6731067ec50ce619ff372b463bc4dd5d','canister_exports':exports,'fixed_nodes':24000000,'fixed_hash_mb':128,'quantum':100000,'capacity_games':1}
assert r['only_ic0_imports'] and r['full_nnue_initial_memory_verified'] and len(b)<104857600
assert not any(x.startswith('canister_update test_') for x in exports)
assert 'canister_update search'not in exports and 'canister_update prototype_begin'not in exports
(HERE/'evidence/artifact.json').write_text(json.dumps(r,indent=2)+'\n');print(r)
