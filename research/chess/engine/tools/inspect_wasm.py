#!/usr/bin/env python3
"""Inspect the actual module and verify every NNUE byte in its initial memory."""
import hashlib
import json
from pathlib import Path
import wasmtime
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/"build/gh0st_stockfish19.wasm";blob=path.read_bytes()
def leb(off):
    n=shift=0
    while True:
        x=blob[off];off+=1;n|=(x&127)<<shift
        if x<128:return n,off
        shift+=7
pos=8;sections=[]
while pos<len(blob):
    ident=blob[pos];size,start=leb(pos+1);row={"id":ident,"bytes":size}
    if ident==0:
        n,q=leb(start);row["name"]=blob[q:q+n].decode(errors="replace")
    sections.append(row);pos=start+size
engine=wasmtime.Engine();wasmtime.Module.validate(engine,blob)
module=wasmtime.Module(engine,blob);store=wasmtime.Store(engine)
imports=[{"module":x.module,"name":x.name} for x in module.imports]
stubs=[]
for item in module.imports:
    assert isinstance(item.type,wasmtime.FuncType)
    n=len(item.type.results)
    stubs.append(wasmtime.Func(store,item.type,lambda *args,n=n: None if n==0 else (0 if n==1 else [0]*n)))
instance=wasmtime.Instance(store,module,stubs)
memory=instance.exports(store)["memory"]
data=memory.read(store,0,memory.data_len(store))
net=(ROOT/".cache/Stockfish/src/nn-1a298aa575a0.nnue").read_bytes()
net_offset=data.find(net)
report={"scope":"compiled ICP Wasm inspection; static memory verification uses IC stubs and is not a search execution", "wasm_sha256":hashlib.sha256(blob).hexdigest(),"bytes":len(blob),"mib":len(blob)/2**20,"sections":sections,"imports":imports,"export_count":len(module.exports),"canister_exports":[x.name for x in module.exports if x.name.startswith("canister_")],"full_nnue_in_initial_linear_memory_offset":net_offset,"nnue_sha256":hashlib.sha256(net).hexdigest(),"full_nnue_initial_linear_memory_verified":net_offset>=0,"within_100_mib":len(blob)<=100*2**20,"code_within_12_mib":sum(x["bytes"] for x in sections if x["id"]==10)<=12*2**20,"only_ic0_imports":all(x["module"]=="ic0" for x in imports)}
assert report["within_100_mib"] and report["code_within_12_mib"] and report["only_ic0_imports"] and report["full_nnue_initial_linear_memory_verified"]
(ROOT/"evidence/wasm-artifact.json").write_text(json.dumps(report,indent=2)+"\n")
print({k:v for k,v in report.items() if k not in ["sections","imports","canister_exports"]})
