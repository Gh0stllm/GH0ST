"""Build independent Q12 references for sequential local-cache tests; no network."""
from pathlib import Path
import ast, hashlib, json, math, os, subprocess
import numpy as np
BASE = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
Q=4096
protocol=json.loads((BASE/"contracts/protocol.json").read_text())
manifest=json.loads((BASE/"model/manifest.json").read_text())
weights=(BASE/"model/weights.bin").read_bytes()
tables=(BASE/"model/tables.bin").read_bytes()
assert hashlib.sha256(weights).hexdigest()==manifest["artifacts"]["weights.bin"]["sha256"]
tensors={x["name"]:np.frombuffer(weights,dtype=">i2",count=x["elements"],offset=x["byte_offset"]).astype(np.int64).reshape(x["shape"]) for x in protocol["weights"]["tensor_layout"]}
cos=np.frombuffer(tables,dtype=">i2",count=256,offset=0).astype(np.int64).reshape(16,16)
sin=np.frombuffer(tables,dtype=">i2",count=256,offset=512).astype(np.int64).reshape(16,16)
sigmoid=np.frombuffer(tables,dtype=">u4",count=257,offset=1024).astype(np.int64)
exp=np.frombuffer(tables,dtype=">u4",count=257,offset=2052).astype(np.int64)
source_path=BASE/"integer_reference.py"
module=ast.parse(source_path.read_text())
main=next(x for x in module.body if isinstance(x,ast.FunctionDef) and x.name=="main")
functions=[x for x in main.body if isinstance(x,ast.FunctionDef)]
scope=dict(np=np,math=math,os=os,subprocess=subprocess,ROOT=BASE,Q=Q,tensors=tensors,cos=cos,sin=sin,sigmoid=sigmoid,exp=exp)
exec(compile(ast.fix_missing_locations(ast.Module(body=functions,type_ignores=[])),str(source_path),"exec"),scope)
forward=scope["forward"]
cache={}
def ref(ids):
 key=tuple(ids)
 if key not in cache:
  x=forward(ids,include_trace=True)
  cache[key]={k:x[k] for k in ["next_token","last_hidden","logit_hash"]}
 return cache[key]
def run(name,prompt,new_tokens):
 context=[];steps=[]
 for i,token in enumerate(prompt):
  context.append(token)
  item=ref(context)
  steps.append(dict(input_token=token,prefix_ids=context.copy(),prefill=i<len(prompt)-1,completion=i==len(prompt)-1,**item))
 for i in range(new_tokens-1):
  if steps[-1]["next_token"]==1:break
  token=steps[-1]["next_token"];context.append(token);item=ref(context)
  steps.append(dict(input_token=token,prefix_ids=context.copy(),prefill=False,completion=True,**item))
 return {"name":name,"prompt_ids":prompt,"maximum_new_tokens":new_tokens,"steps":steps}
old=json.loads((BASE/"gas-rerun/reference.json").read_text())
qa=next(x for x in old["fixtures"] if x["name"]=="qa-short")
cases=[run("minimal",[85],4),run("qa-short",qa["prompt_ids"],4),run("context-16",[85]*16,1)]
out={"schema_version":1,"model":manifest["repository"],"parameters":manifest["parameters"],"weight_scale":4096,
     "source_weights_sha256":manifest["artifacts"]["weights.bin"]["sha256"],"source_reference_sha256":hashlib.sha256(source_path.read_bytes()).hexdigest(),
     "cases":cases,"independent_prefixes":len(cache),"execution":"Offline Python original integer reference, no network or chain"}
(OUT/"streaming-reference.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps({"cases":[{"name":x["name"],"steps":len(x["steps"]),"completion_tokens":[s["next_token"] for s in x["steps"] if s["completion"]]}for x in cases],"independent_prefixes":len(cache)}))

