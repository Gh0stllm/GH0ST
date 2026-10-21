"""Local-only projection microbenchmarks; state injection is not deployment.

Receipt gas includes ABI calldata overhead. Use full-block receipts to claim
inference savings; this harness screens kernels and checks arithmetic extremes.
"""
import argparse
import json
import random
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import requests
from eth_abi import encode, decode
from eth_utils import keccak
from reference import pack, unpack

ROOT=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--anvil',required=True)
    p.add_argument('--contracts',nargs='+',default=['LfmBlockSwar6','LfmBlockFast6'])
    p.add_argument('--output',default='kernel-sweep.json')
    args=p.parse_args()
    compiled=json.loads((ROOT/'compiled.json').read_text())['contracts']
    child=subprocess.Popen([args.anvil,'--host','127.0.0.1','--port','18546','--chain-id','31337',
        '--hardfork','cancun','--gas-limit','16777216','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    session=requests.Session();session.trust_env=False
    def rpc(method,params=()):
        v=session.post('http://127.0.0.1:18546',json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=120).json()
        if 'error' in v:raise RuntimeError(str(v['error']))
        return v['result']
    report={'at':datetime.now(timezone.utc).isoformat(),'public_transactions_broadcast':0,
        'environment':'local Cancun Anvil; injected runtime for pure projection probes',
        'limitations':['Microbenchmarks include calldata; they are not full-block costs or deployed-contract receipts.'],
        'variants':[],'status':'running'}
    def save(): (ROOT.parent/'results'/args.output).write_text(json.dumps(report,indent=2)+'\n')
    try:
        for _ in range(100):
            try:
                assert int(rpc('eth_chainId'),16)==31337
                break
            except requests.ConnectionError:time.sleep(.05)
        sender=rpc('eth_accounts')[0]
        ref=np.load(ROOT/'data/token-2-reference.npz')
        fixtures=[]
        for shard,cols,rows,key in [(0,1024,32,'norm1'),(96,1024,32,'convolution'),
                                    (128,1024,32,'norm2'),(288,2560,16,'activation')]:
            x=pack(ref[key]);w=(ROOT/'data'/f'matrix-{shard:03d}.bin').read_bytes()
            fixtures.append((f'model-shard-{shard}',x,w,rows,cols))
        rng=random.Random(20261020)
        for i in range(64):
            cols=[4,8,12,32,64,192,1024,2560][i%8];rows=1+i%4
            vals=[rng.randint(-100000,100000) for _ in range(cols)]
            matrix=[[rng.randint(-8,7) for _ in range(cols)] for _ in range(rows)]
            scale=16777216
            if i<24:
                vals=[(-2**31 if i%3==0 else 2**31-1 if i%3==1 else (-2**31 if j%2==0 else 2**31-1)) for j in range(cols)]
                matrix=[[(-8 if i<8 else 7 if i<16 else (-8 if j%2==0 else 7)) for j in range(cols)] for _ in range(rows)]
                scale=1
            w=b''.join(scale.to_bytes(4,'big')+bytes((r[j]&15)|((r[j+1]&15)<<4) for j in range(0,cols,2)) for r in matrix)
            fixtures.append((f'extreme-random-{i}',pack(vals),w,rows,cols))
        for index,name in enumerate(args.contracts):
            addr='0x'+format(0x1000+index,'040x')
            rpc('anvil_setCode',[addr,'0x'+compiled[name]['evm']['deployedBytecode']['object']])
            variant={'contract':name,'cases':[],'runtime_bytes':len(compiled[name]['evm']['deployedBytecode']['object'])//2}
            report['variants'].append(variant)
            for label,x,w,rows,cols in fixtures:
                expected=[];values=unpack(x).tolist();stride=cols//2+4
                for row in range(rows):
                    off=row*stride;scale=int.from_bytes(w[off:off+4],'big',signed=True)
                    weights=[((w[off+4+j//2]>>((j%2)*4))&15) for j in range(cols)]
                    acc=sum((a-16 if a>=8 else a)*b for a,b in zip(weights,values))*scale
                    expected.append((abs(acc)//16777216)*(-1 if acc<0 else 1))
                calldata='0x'+(keccak(text='projectProbe(bytes,bytes,uint256,uint256)')[:4]+encode(['bytes','bytes','uint256','uint256'],[x,w,rows,cols])).hex()
                tx={'from':sender,'to':addr,'data':calldata,'gas':'0xf00000'}
                result=rpc('eth_call',[tx,'latest'])
                assert decode(['bytes'],bytes.fromhex(result[2:]))[0]==pack(expected),(name,label)
                item={'label':label,'rows':rows,'cols':cols,'matches_reference':True}
                if label.startswith('model'):
                    h=rpc('eth_sendTransaction',[tx]);receipt=None
                    for _ in range(1000):
                        receipt=rpc('eth_getTransactionReceipt',[h])
                        if receipt is not None:break
                        time.sleep(.01)
                    assert receipt is not None
                    assert int(receipt['status'],16)==1
                    item['gas_used']=int(receipt['gasUsed'],16)
                variant['cases'].append(item)
            save()
            print(json.dumps({'contract':name,'checks':len(variant['cases']),
                'model_gas':[x['gas_used'] for x in variant['cases'] if 'gas_used' in x]}),flush=True)
        report['status']='passed';save()
    except Exception as exc:
        report.update(status='failed',error=str(exc));save();raise
    finally:
        child.terminate();child.wait(timeout=10)

if __name__=='__main__':main()
