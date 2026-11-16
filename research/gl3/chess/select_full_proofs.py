"""Require complete upstream replay, then select actual search/NNUE OSP witnesses."""
from pathlib import Path
import hashlib,json,re

HERE=Path(__file__).resolve().parent
OUT=HERE/'.cache/block'

def leb(data,p):
 n=shift=0
 while True:
  x=data[p];p+=1;n|=(x&127)<<shift
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
 b=bytes.fromhex(proof);o=1
 def stack(o):return o+64+33*int.from_bytes(b[o+32:o+64],'big')
 o=stack(o)+64;o=stack(o);o+=32;flag=b[o];o+=1+(73 if flag else 0);o+=64+32
 return {'module':int.from_bytes(b[o:o+4],'big'),'function':int.from_bytes(b[o+4:o+8],'big'),'pc':int.from_bytes(b[o+8:o+12],'big')}

if __name__=='__main__':
 logfile=HERE/'prover-full.log';log=re.sub(r'\x1b\[[0-9;]*m','',logfile.read_text())
 assert 'End machine status: Finished' in log and 'Computed state matches the expected one' in log,'complete successful replay is mandatory'
 proofs=json.loads((OUT/'full-proofs.json').read_text())
 trace=re.findall(r'Generating proof\s+\d+\s+\(inst\s+(\d+)\) for ([^\n]+)',log)
 assert len(proofs)==len(trace)+1 and proofs[-1]['before']==proofs[-1]['after']
 names=function_names(HERE/'.cache/bin/gl3chess.wasm');candidates=[]
 for proof,(step,opcode) in zip(proofs,trace):
  at=location(proof['proof']);name=names.get(at['function'],'') if at['module']==9 else ''
  if at['module']==9:candidates.append({**proof,'step':step,'opcode':opcode,**at,'moduleName':'gl3chess.wasm','functionName':name})
 def choose(predicate,label):
  row=next((x for x in candidates if predicate(x)),None);assert row is not None,'missing '+label
  return {**row,'reason':label}
 is_search=lambda x:'Worker::search' in x['functionName'] or 'Worker::qsearch' in x['functionName']
 is_kernel=lambda x:is_search(x) or 'Stockfish::Eval::NNUE::' in x['functionName']
 selected=[choose(is_search,'actual_stockfish_search'),choose(lambda x:is_kernel(x) and ('MemoryLoad' in x['opcode'] or 'MemoryStore' in x['opcode']),'actual_engine_memory'),choose(lambda x:is_kernel(x) and ('IBinOp' in x['opcode'] or 'IRelOp' in x['opcode']),'actual_engine_arithmetic')]
 common=json.loads((OUT/'at100b-proofs.json').read_text())[0]
 index=next(i for i,(s,_) in enumerate(trace) if s=='100000000000');assert proofs[index]==common
 selected.append({**common,'step':'100000000000','reason':'independently_reproduced_common_point'})
 selected.append({**proofs[-1],'step':str(int(trace[-1][0])+1),'reason':'finished_state_witness_nonzero_step'})
 (OUT/'complete-selected-proofs.json').write_text(json.dumps(selected,indent=2)+'\n')
 stat=logfile.stat();input_data=json.loads((OUT/'input.json').read_text());expected=input_data['ExpectedEndState']
 actual=re.search(r'End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)',log)
 assert actual and actual.groups()==(expected['BlockHash'],expected['SendRoot'],str(expected['Batch']),str(expected['PosInBatch']))
 last=int(trace[-1][0]);assert last+1000000000<1<<43,'OSP step envelope exceeded'
 result={'passed':True,'scope':'Complete engine-bearing block replay through the unchanged upstream WAVM interpreter, exact expected end state; selected Solidity witness verification is a separate result','moduleRoot':(HERE/'.cache/machine/module-root.txt').read_text().strip(),'computedEnd':expected,'completeWAVMStepRange':[last,last+1000000000],'exactFinalStepCountNotPrintedByUpstreamCLI':True,'approximateWallFromLogSeconds':stat.st_mtime-getattr(stat,'st_birthtime',stat.st_ctime),'wallEstimateIncludesConcurrentLocalWorkloads':True,'fullProofFileSHA256':hashlib.sha256((OUT/'full-proofs.json').read_bytes()).hexdigest(),'fullProofs':len(proofs),'selectedProofs':len(selected),'common100bMachineAndWitnessMatch':True,'inputSHA256':hashlib.sha256((OUT/'input.json').read_bytes()).hexdigest(),'fullBoLDChallengeExecuted':False,'modelQualityReduced':False,'publicDeployment':False,'realSpend':0}
 (OUT/'full-replay.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
