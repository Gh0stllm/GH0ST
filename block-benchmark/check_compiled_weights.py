"""Differential tests of generated EVM weight programs on local Anvil only."""
import argparse,json,random,subprocess,time
from datetime import datetime,timezone
import numpy as np
import requests
from compiled_weights import ROOT,runtime,creation,packed_input,decode_rows
from reference import pack

def main():
    p=argparse.ArgumentParser();p.add_argument('--anvil',required=True);args=p.parse_args()
    child=subprocess.Popen([args.anvil,'--host','127.0.0.1','--port','18549','--chain-id','31337',
        '--hardfork','cancun','--gas-limit','16777216','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    session=requests.Session();session.trust_env=False
    def rpc(method,params=()):
        ans=session.post('http://127.0.0.1:18549',json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=120).json()
        if 'error' in ans:raise RuntimeError(str(ans['error']))
        return ans['result']
    def receipt(h):
        for _ in range(1000):
            r=rpc('eth_getTransactionReceipt',[h])
            if r is not None:return r
            time.sleep(.01)
        raise TimeoutError('Local receipt')
    report={'at':datetime.now(timezone.utc).isoformat(),'status':'running','public_transactions_broadcast':0,'cases':[]}
    def save():(ROOT.parent/'results/compiled-weight-kernels.json').write_text(json.dumps(report,indent=2)+'\n')
    try:
        for _ in range(100):
            try:
                assert int(rpc('eth_chainId'),16)==31337;break
            except requests.ConnectionError:time.sleep(.05)
        sender=rpc('eth_accounts')[0];ref=np.load(ROOT/'data/token-2-reference.npz')
        cases=[]
        for shard,cols,count,key in [(0,1024,3,'norm1'),(96,1024,3,'convolution'),(128,1024,3,'norm2'),(288,2560,1,'activation')]:
            decoded=decode_rows((ROOT/'data'/f'matrix-{shard:03d}.bin').read_bytes(),32 if cols==1024 else 16,cols)
            cases.append((f'model-{shard}',ref[key].tolist(),decoded[:count]))
        rng=random.Random(20261020)
        for i in range(64):
            cols=[4,8,12,32,64,192,1024,2560][i%8];rows=1 if cols==2560 else 1+i%3
            x=[rng.randint(-100000,100000) for _ in range(cols)]
            weights=[[rng.randint(-8,7) for _ in range(cols)] for _ in range(rows)];scale=16777216
            if i<24:
                x=[(-2**31 if i%3==0 else 2**31-1 if i%3==1 else (-2**31 if j%2==0 else 2**31-1)) for j in range(cols)]
                weights=[[(-8 if i<8 else 7 if i<16 else (-8 if j%2==0 else 7)) for j in range(cols)] for _ in range(rows)]
                scale=1
            cases.append((f'extreme-random-{i}',x,[(scale,w) for w in weights]))
        # Explicit successful negative truncation, zero, and overflow rejection.
        cases.extend([('negative-rounding',[-1,0,0,0],[(1<<23,[1,0,0,0])]),
                      ('zero',[0]*8,[(1<<24,[7]*8)]),
                      ('overflow',[2**31-1]*8,[(1<<24,[7]*8)])])
        for i,(label,x,rows) in enumerate(cases):
            code=runtime(rows,len(x));raw=packed_input(x)
            addr='0x'+format(0x2000+i,'040x')
            if label.startswith('model'):
                r=receipt(rpc('eth_sendTransaction',[{'from':sender,'data':'0x'+creation(code).hex(),'gas':'0xf00000'}]))
                assert int(r['status'],16)==1;addr=r['contractAddress']
                assert rpc('eth_getCode',[addr,'latest'])=='0x'+code.hex()
            else:rpc('anvil_setCode',[addr,'0x'+code.hex()])
            expected=[]
            for scale,w in rows:
                acc=sum(a*b for a,b in zip(w,x))*scale
                expected.append((abs(acc)//(1<<24))*(-1 if acc<0 else 1))
            tx={'from':sender,'to':addr,'data':'0x'+raw.hex(),'gas':'0xf00000'}
            overflow=any(v<-(1<<31) or v>=1<<31 for v in expected)
            try:actual=rpc('eth_call',[tx,'latest'])
            except RuntimeError:
                assert overflow,label
                report['cases'].append({'label':label,'expected_overflow_rejected':True});continue
            assert not overflow and actual=='0x'+pack(expected).hex(),(label,actual,expected)
            for bad in [b'',raw[:-1],raw+b'\x00']:
                try:rpc('eth_call',[dict(tx,data='0x'+bad.hex()),'latest'])
                except RuntimeError:pass
                else:raise AssertionError('Invalid length accepted')
            item={'label':label,'matches_reference':True,'invalid_lengths_rejected':3,'runtime_bytes':len(code)}
            if label.startswith('model'):
                r=receipt(rpc('eth_sendTransaction',[tx]));assert int(r['status'],16)==1
                item['gas_used_with_external_calldata']=int(r['gasUsed'],16)
            report['cases'].append(item)
        report['status']='passed';save();print(json.dumps({'status':'passed','cases':len(report['cases']),
            'model_cases':report['cases'][:4]}))
    except Exception as exc:report.update(status='failed',error=str(exc));save();raise
    finally:child.terminate();child.wait(timeout=10)

if __name__=='__main__':main()
