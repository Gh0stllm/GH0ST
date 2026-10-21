"""Local EVM measurements with exact NumPy reference; never broadcasts publicly."""
import argparse, hashlib, json, subprocess, sys, time
from pathlib import Path
import numpy as np, requests
from eth_abi import encode,decode
from eth_utils import keccak
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'sixbit-optimization'))
from optimize import PIN,encode_matrix,old_codes,unpack,bf16_q24,exact_scale
from test_kernel import legacy,initcode

class LocalEVM:
 def __init__(self,anvil,profile=False,port=18561):
  self.url=f'http://127.0.0.1:{port}'
  self.child=subprocess.Popen([str(anvil),'--host','127.0.0.1','--port',str(port),'--hardfork','cancun','--code-size-limit','98304','--gas-limit','16777216','--silent']+(['--steps-tracing'] if profile else []),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  self.session=requests.Session();self.session.trust_env=False
  for _ in range(200):
   try:self.account=self.rpc('eth_accounts')[0];break
   except requests.ConnectionError:time.sleep(.05)
  else:raise RuntimeError('Local Anvil startup failed')
  assert int(self.rpc('eth_chainId'),16)==31337
 def rpc(self,method,params=()):
  r=self.session.post(self.url,json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=60).json()
  if 'error' in r:raise RuntimeError(r['error'])
  return r['result']
 def tx(self,payload):
  h=self.rpc('eth_sendTransaction',[{'from':self.account,'gas':hex(16000000),**payload}])
  for _ in range(200):
   r=self.rpc('eth_getTransactionReceipt',[h])
   if r is not None:break
   time.sleep(.01)
  assert r and int(r['status'],16)==1,r
  return r
 def deploy(self,data):
  r=self.tx({'data':'0x'+data.hex()});return r['contractAddress'],int(r['gasUsed'],16)
 def call(self,target,shard,x,rows,cols):
  payload={'to':target,'data':'0x'+(keccak(text='dot(address,bytes,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256'],[shard,x.astype('>i2').tobytes(),rows,cols])).hex()}
  result=self.rpc('eth_call',[payload,'latest']);actual=list(decode(['int256[]'],bytes.fromhex(result[2:]))[0])
  self.last_receipt=self.tx(payload)
  return actual,int(self.last_receipt['gasUsed'],16)
 def close(self):self.child.terminate();self.child.wait(timeout=5)

def aligned(compact):
 g=int.from_bytes(compact[4:8],'big');lw,hw=compact[12:14];n=(g*(lw+hw)+7)//8
 meta=unpack(compact[16:16+n],lw+hw,g)
 lo=int.from_bytes(compact[8:10],'big')+(meta>>hw);hi=int.from_bytes(compact[10:12],'big')+(meta&((1<<hw)-1))
 endpoints=np.stack([lo,hi],axis=1).astype('>u2').tobytes()
 return b'G6B1'+g.to_bytes(4,'big')+bytes(8)+endpoints+compact[16+n:]

def direct(compact):
 g=int.from_bytes(compact[4:8],'big');lw,hw=compact[12:14];n=(g*(lw+hw)+7)//8
 meta=unpack(compact[16:16+n],lw+hw,g);lb=int.from_bytes(compact[8:10],'big')
 lo=lb+(meta>>hw);hi=int.from_bytes(compact[10:12],'big')+(meta&((1<<hw)-1))
 scale=exact_scale(bf16_q24(hi)-bf16_q24(lo))
 v=((lo.astype(np.uint64)-lb)<<21)|scale.astype(np.uint64)
 stride=max(4,(int(v.max()).bit_length()+7)//8);assert stride in [4,5]
 return b'F6D1'+g.to_bytes(4,'big')+lb.to_bytes(2,'big')+bytes(2)+bytes([stride,0,0,0])+b''.join(int(x).to_bytes(stride,'big') for x in v)+compact[16+n:]

def predecoded(o,s,compact):
 g=len(o);lw,hw=compact[12:14];n=(g*(lw+hw)+7)//8
 return b'F6P1'+g.to_bytes(4,'big')+bytes(8)+b''.join(int(a).to_bytes(4,'big',signed=True)+int(b).to_bytes(3,'big') for a,b in zip(o,s))+compact[16+n:]

def shifted(o,s,compact):
 g=len(o);lw,hw=compact[12:14];n=(g*(lw+hw)+7)//8
 a=o.astype(np.int64);v=int(np.bitwise_or.reduce(np.abs(a)));shift=(v&-v).bit_length()-1 if v else 0
 small=a>>shift;ob=max(abs(int(small.min())),int(small.max())).bit_length()+1;sb=int(s.max()).bit_length()
 stride=max(4,(ob+sb+7)//8);assert stride in [4,5] and sb<=21
 mask=(1<<(stride*8-sb))-1;packed=((small.astype(np.uint64)&mask)<<sb)|s.astype(np.uint64)
 return b'F6S1'+g.to_bytes(4,'big')+bytes([stride,shift,sb])+bytes(5)+b''.join(int(x).to_bytes(stride,'big') for x in packed)+compact[16+n:]

def fixed(o,s,compact):
 g=len(o);lw,hw=compact[12:14];n=(g*(lw+hw)+7)//8
 a=o.astype(np.int64);v=int(np.bitwise_or.reduce(np.abs(a)));shift=(v&-v).bit_length()-1 if v else 0
 small=a>>shift;assert np.all((small>=-(1<<18))&(small<(1<<18))) and np.all(s<(1<<21))
 packed=((small.astype(np.uint64)&((1<<19)-1))<<21)|s.astype(np.uint64)
 return b'F6F1'+g.to_bytes(4,'big')+bytes([shift])+bytes(7)+b''.join(int(x).to_bytes(5,'big') for x in packed)+compact[16+n:]

def source(folder):
 raw=(folder/'weights.bin').read_bytes();assert hashlib.sha256(raw).hexdigest()==PIN
 return raw,json.loads((folder/'manifest.json').read_text())

def tensor(raw,t):
 g=t['group_count'];blob=raw[t['offset']:t['offset']+t['byte_count']]
 return np.frombuffer(blob[:g*4],dtype='<i4'),np.frombuffer(blob[g*4:g*8],dtype='<u4'),old_codes(blob,g).reshape(g,64)

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--anvil',type=Path,required=True);p.add_argument('--full',action='store_true');p.add_argument('--port',type=int,default=18561);p.add_argument('--no-baseline',action='store_true');p.add_argument('--quick',action='store_true');p.add_argument('--profile',action='store_true');p.add_argument('--output',type=Path);p.add_argument('--candidates',default='SixBitSigned,SixBitBranch,SixBitAligned');a=p.parse_args()
 raw,m=source(a.source);art=json.loads((ROOT/'compiled.json').read_text());base=json.loads((ROOT.parent/'sixbit-optimization/compiled.json').read_text());contracts={**base['contracts'],**art['contracts']}
 names=([] if a.no_baseline else ['SixBitFast'])+a.candidates.split(',');evm=LocalEVM(a.anvil,a.profile,a.port)
 report={'status':'running','scope':'Independent synthetic signed-int16 inputs; matrix arithmetic only, NOT token inference','environment':'Local Anvil Cancun; code-size limit 98304; standard gas schedule, not a live-chain fee quote','compiler':art['compiler'],'source_sha256':PIN,'public_transactions_broadcast':0,'kernel_deployments':{},'checks':[],'benchmarks':[]}
 path=a.output or ROOT/('full-results.json' if a.full else 'candidate-results.json')
 def save():path.write_text(json.dumps(report,indent=2)+'\n')
 def run(label,o,s,c,rows,cols,cases):
  compact,_=encode_matrix(legacy(o,s,c.reshape(-1)),len(o));ca,cgas=evm.deploy(initcode(compact));shards={};sizes={};deploy_gas={}
  for name in names:
   if name=='SixBitAligned':blob=aligned(compact)
   elif name.startswith('SixBitDirect'):blob=direct(compact)
   elif name.startswith('SixBitPredecoded'):blob=predecoded(o,s,compact)
   elif name=='SixBitShifted':blob=shifted(o,s,compact)
   elif name=='SixBitFixed':blob=fixed(o,s,compact)
   else:shards[name]=ca;continue
   shards[name],deploy_gas[name]=evm.deploy(initcode(blob));sizes[name]=len(blob)
  weights=(o.astype(np.int64)[:,None]+s.astype(np.int64)[:,None]*c.astype(np.int64)).reshape(rows,cols)
  entry={'label':label,'rows':rows,'cols':cols,'compact_bytes':len(compact),'compact_deploy_gas':cgas,'variant_bytes':sizes,'variant_deploy_gas':deploy_gas,'cases':[]}
  for case,x in cases:
   expected=(weights@x).tolist();r={'case':case,'gas':{}}
   for name in names:
    actual,gas=evm.call(engines[name],shards[name],x,rows,cols)
    assert actual==expected,(label,case,name,actual[:3],expected[:3]);r['gas'][name]=gas
    if a.profile and label=='model.embed_tokens.weight' and case=='random':
     from collections import Counter
     trace=evm.rpc('debug_traceTransaction',[evm.last_receipt['transactionHash'],{'disableStack':True,'disableMemory':True,'disableStorage':True}]);counts=Counter();cost=Counter()
     for op in trace['structLogs']:counts[op['op']]+=1;cost[op['op']]+=op['gasCost']
     report.setdefault('opcode_profiles',{})[name]={'counts':dict(counts),'gas':dict(cost)}
   entry['cases'].append(r)
  return entry
 try:
  engines={}
  for name in names:
   addr,gas=evm.deploy(bytes.fromhex(contracts[name]['evm']['bytecode']['object']));engines[name]=addr
   report['kernel_deployments'][name]={'gas':gas,'runtime_bytes':len(contracts[name]['evm']['deployedBytecode']['object'])//2,'runtime_sha256':hashlib.sha256(bytes.fromhex(contracts[name]['evm']['deployedBytecode']['object'])).hexdigest()}
  rng=np.random.default_rng(923711 if not a.full else 85112)
  if not a.full:
   chosen=['model.embed_tokens.weight','model.layers.0.feed_forward.down_proj.weight','model.layers.11.mamba.in_proj.weight','model.layers.23.self_attn.v_proj.weight']
   for name in chosen:
    t=next(t for t in m['tensors'] if t['name']==name);o,s,c=tensor(raw,t);rows=32;cols=t['shape'][1];g=rows*cols//64
    cases=[('random',rng.integers(-32768,32768,cols,dtype=np.int64)),('maximum',np.full(cols,32767,dtype=np.int64)),('minimum',np.full(cols,-32768,dtype=np.int64)),('alternating',np.tile([-32768,32767],cols//2)),('zero',np.zeros(cols,dtype=np.int64))]
    r=run(name,o[:g],s[:g],c[:g],rows,cols,cases);report['benchmarks'].append(r);save();print(json.dumps({'matrix':name,'gas':r['cases'][0]['gas']}),flush=True)
   if a.quick:
    report['status']='completed';save();return
   for label,offset,step in [('edges',-9437184,264224),('tie_up',-6520832,292832),('zero_offset',0,1)]:
    rows=8;cols=64;o=np.full(rows,offset);s=np.full(rows,step);c=np.stack([np.arange(64),np.arange(63,-1,-1),np.zeros(64),np.full(64,63),np.tile([0,63],32),np.tile([63,0],32),rng.integers(0,64,64),rng.integers(0,64,64)]).astype(np.uint8)
    cases=[('max',np.full(64,32767,dtype=np.int64)),('min',np.full(64,-32768,dtype=np.int64)),('alt',np.tile([-32768,32767],32)),('random',rng.integers(-32768,32768,64,dtype=np.int64))]
    for lane in range(8):
     x=np.zeros(64,dtype=np.int64);x[lane::8]=-32768;cases.append(('negative_lane_'+str(lane),x))
    report['benchmarks'].append(run(label,o,s,c,rows,cols,cases));save()
   # First/last groups from every matrix, including all zero offsets.
   for t in m['tensors']:
    if 'group_count' not in t:continue
    o,s,c=tensor(raw,t);g=len(o);idx=np.unique(np.r_[np.arange(min(8,g)),np.arange(max(0,g-8),g),np.flatnonzero(o==0)])
    r=run('boundaries/'+t['name'],o[idx],s[idx],c[idx],len(idx),64,[('random',rng.integers(-32768,32768,64,dtype=np.int64))]);report['checks'].append({'name':r['label'],'rows':len(idx),'passed':True})
   save()
  else:
   report.update(matrices=[],usage_gas={n:0 for n in names},rows_verified=0,tiles=0,weight_elements=0)
   for t in m['tensors']:
    if 'group_count' not in t:continue
    rows,cols=t['shape'];o,s,c=tensor(raw,t);x=rng.integers(-32768,32768,cols,dtype=np.int64)
    item={'name':t['name'],'shape':t['shape'],'gas':{n:0 for n in names},'tiles':0}
    for start in range(0,rows,64):
     n=min(64,rows-start);lo=start*cols//64;hi=(start+n)*cols//64
     r=run(t['name'],o[lo:hi],s[lo:hi],c[lo:hi],n,cols,[('random',x)])
     for name,gas in r['cases'][0]['gas'].items():item['gas'][name]+=gas;report['usage_gas'][name]+=gas
     report['tiles']+=1;report['rows_verified']+=n;item['tiles']+=1
    report['matrices'].append(item);report['weight_elements']+=rows*cols;save()
    print(json.dumps({'matrices':len(report['matrices']),'rows':report['rows_verified'],'gas':report['usage_gas']}),flush=True)
  report['status']='completed';save();print(json.dumps({k:v for k,v in report.items() if k not in ['benchmarks','checks','matrices']},indent=2))
 finally:evm.close()
if __name__=='__main__':main()
