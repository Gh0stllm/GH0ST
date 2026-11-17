"""Select authentic bounded witnesses only after this new root finishes."""
from pathlib import Path
import hashlib,json,re
r=Path('/root/bounded-restore');chosen=r/'fast-comparison/C-combined';out=chosen/'interpreter'
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def leb(b,p):
 n=shift=0
 while True:
  x=b[p];p+=1;n|=(x&127)<<shift
  if x<128:return n,p
  shift+=7

def function_names(path):
 b=path.read_bytes();names={};p=8
 while p<len(b):
  ty=b[p];size,p=leb(b,p+1);end=p+size
  if ty==0:
   n,q=leb(b,p);name=b[q:q+n].decode();q+=n
   if name=='name':
    while q<end:
     sub=b[q];n,q=leb(b,q+1);stop=q+n
     if sub==1:
      count,q=leb(b,q)
      for _ in range(count):
       index,q=leb(b,q);n,q=leb(b,q);names[index]=b[q:q+n].decode();q+=n
     q=stop
  p=end
 return names

def location(proof):
 # Exact upstream serialize_proof layout: value multistack, internal stack,
 # frame multistack/window, global-state hash, then three big-endian u32 PCs.
 b=bytes.fromhex(proof);o=1
 def stack(o):
  n=int.from_bytes(b[o+32:o+64],'big');assert n<=3
  return o+64+33*n
 o=stack(o)+64;o=stack(o);o+=32;flag=b[o];assert flag in (0,1)
 o+=1+(73 if flag else 0);o+=64+32
 return {'module':int.from_bytes(b[o:o+4],'big'),'function':int.from_bytes(b[o+4:o+8],'big'),'pc':int.from_bytes(b[o+8:o+12],'big'),'machineStatus':b[0]}

assert json.loads((out/'replay-result.json').read_text())['passed']
log=re.sub(r'\x1b\[[0-9;]*m','',(out/'prover.log').read_text())
assert 'End machine status: Finished' in log
trace=re.findall(r'Generating proof\s+(\d+)\s+\(inst\s+(\d+)\) for ([^\n]+)',log)
proofs=json.loads((out/'full-proofs.json').read_text());assert len(proofs)==len(trace)+1
names={10:function_names(chosen/'replay.wasm'),9:function_names(r/'machine-inputs/gl3aot.wasm')}
rows=[]
for i,(proof,(index,step,op)) in enumerate(zip(proofs,trace)):
 assert int(index)==i
 at=location(proof['proof']);module=at['module']
 rows.append({**proof,**at,'step':step,'opcode':op.removesuffix(' - done'),'moduleName':{0:'entry',1:'forward',2:'soft-float',3:'wasi_stub',4:'host_io',5:'user_host',6:'arbcompress',7:'arbcrypto',8:'program_exec',9:'gl3aot.wasm',10:'replay.wasm'}.get(module,'unknown'),'functionName':names.get(module,{}).get(at['function'],'')})
selected=[]
def add(row,reason):
 if not any(x['step']==row['step'] for x in selected):selected.append({**row,'reason':reason})
def choose(predicate,reason,required=True):
 row=next((x for x in rows if predicate(x) and not any(y['step']==x['step'] for y in selected)),None)
 if row is None:
  assert not required,'missing '+reason
  return
 add(row,reason)
choose(lambda x:x['module']==10 and 'sha256' in x['functionName'].lower(),'Go SHA256 authenticated-state hashing; caller history is not inferred from a one-frame witness')
choose(lambda x:x['module']==10 and any(s in x['functionName'] for s in ['sliceReadDelta','sliceApplyDeltas','CodeUncached','sliceRestoreSeed']),'Go historical restoration accessor instruction',False)
choose(lambda x:x['module']==9,'unchanged scalar C companion execution; individual Stockfish function unnamed')
choose(lambda x:x['module']==9 and ('MemoryLoad' in x['opcode'] or 'MemoryStore' in x['opcode']),'unchanged scalar C companion memory instruction; no individual search/NNUE attribution')
choose(lambda x:x['module']==9 and ('IBinOp' in x['opcode'] or 'IRelOp' in x['opcode']),'unchanged scalar C companion integer instruction; no individual search/NNUE attribution')
last_c=max(int(x['step']) for x in rows if x['module']==9)
choose(lambda x:x['module']==10 and int(x['step'])>last_c,'Go finalization after the last sampled companion instruction',False)
add(rows[-1],'last sampled running instruction; exact raw halt counter is recorded separately')
interval=100000000;last=int(trace[-1][1]);exact_match=re.search(r'GL3_EXACT_FINAL_STEPS\s+(\d+)',log);assert exact_match is not None;exact_final_step=int(exact_match[1]);logical_finished_step=exact_final_step;assert last < exact_final_step <= last+interval
assert logical_finished_step<(1<<43)
assert proofs[-1]['before']==proofs[-1]['after'] and bytes.fromhex(proofs[-1]['proof'])[0]==1
selected.append({**proofs[-1],'step':str(logical_finished_step),'reason':'authentic absorbing Finished self-transition at the exact raw terminal step printed by the logging-only host tool; real BoLD kickoff offset reviewed separately','machineStatus':1,'logicalPaddingStep':False,'exactRawFinalStep':True})
assert 1<=len(selected)<=8
(out/'selected-proofs.json').write_text(json.dumps(selected,indent=2)+'\n')
meta={'passed':True,'moduleRoot':json.loads((chosen/'machine-manifest.json').read_text())['moduleRoot'],'fullProofFileSHA256':sha(out/'full-proofs.json'),'fullProofFileBytes':(out/'full-proofs.json').stat().st_size,'fullProofCount':len(proofs),'selectedProofCount':len(selected),'selectedProofSHA256':sha(out/'selected-proofs.json'),'sampleInterval':interval,'completedWAVMStepRange':[exact_final_step,exact_final_step],'exactFinalStepCountPrintedByModifiedHostCLI':True,'upstreamCLIOriginallyDidNotPrintExactCounter':True,'rawExactFinalStep':exact_final_step,'rawCounterPlusOne':exact_final_step+1,'finishedWitnessRawStep':logical_finished_step,'individualStockfishFunctionsIdentified':False,'reason':'The unchanged C companion has no function-name section; selected module-9 frames are not claimed as specific search or NNUE functions.','selectionScriptSHA256':sha(Path(__file__)),'allExecutionOnRunpod':True,'fullBoLDDisputeExecuted':False,'entire24mWAVMMoveExecuted':False,'enginePolicyChanged':False,'selected':[{'step':x['step'],'reason':x['reason'],'module':x.get('module'),'function':x.get('function'),'functionName':x.get('functionName'),'opcode':x.get('opcode')} for x in selected]}
(out/'selected-proof-manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
