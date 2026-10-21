"""Two local gas schedules; no claim of current RH fork activation."""
import argparse,json,subprocess,time
from pathlib import Path
import numpy as np,requests
from eth_abi import encode,decode
from eth_utils import keccak
from optimize import pack
from test_kernel import initcode
ROOT=Path(__file__).resolve().parent


def main():
    p=argparse.ArgumentParser();p.add_argument('--anvil',type=Path,required=True);a=p.parse_args()
    artifact=json.loads((ROOT/'compiled.json').read_text());report={'status':'running','scope':'One 64-element unsigned6/signed16 dot, weights in local code; includes on-chain packing. Not affine scaling or full-model inference.','public_transactions_broadcast':0,'forks':[]}
    for fork in ['cancun','osaka']:
        child=subprocess.Popen([str(a.anvil.resolve()),'--host','127.0.0.1','--port','18554','--hardfork',fork,'--gas-limit','16777216','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        session=requests.Session();session.trust_env=False
        def rpc(method,params=()):
            r=session.post('http://127.0.0.1:18554',json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=60).json()
            if 'error' in r:raise RuntimeError(r['error'])
            return r['result']
        try:
            for _ in range(200):
                try:accounts=rpc('eth_accounts');break
                except requests.ConnectionError:time.sleep(.05)
            else:raise RuntimeError('Local fork failed '+fork)
            def tx(payload):
                h=rpc('eth_sendTransaction',[{'from':accounts[0],'gas':hex(16000000),**payload}])
                for _ in range(200):
                    r=rpc('eth_getTransactionReceipt',[h])
                    if r is not None:break
                    time.sleep(.01)
                assert int(r['status'],16)==1,r
                return r
            engine=tx({'data':'0x'+artifact['contracts']['ModexpDot']['evm']['bytecode']['object']})
            out={'fork':fork,'engine_deployment_gas':int(engine['gasUsed'],16),'cases':[]}
            rng=np.random.default_rng(441)
            for label in ['ramp','maximum','minimum','random','zeros']:
                q=rng.integers(0,64,64,dtype=np.uint8);x=rng.integers(-32768,32768,64,dtype=np.int64)
                if label=='ramp':q=np.arange(64,dtype=np.uint8)
                if label=='maximum':q[:]=63;x[:]=32767
                if label=='minimum':q[:]=63;x[:]=-32768
                if label=='zeros':q[:]=0
                packed=pack(q.reshape(-1,8)[:,::-1].reshape(-1),6)
                shard=tx({'data':'0x'+initcode(packed).hex()})['contractAddress']
                data='0x'+(keccak(text='dot(address,bytes)')[:4]+encode(['address','bytes'],[shard,x.astype('>i2').tobytes()])).hex()
                payload={'to':engine['contractAddress'],'data':data};actual=decode(['int256'],bytes.fromhex(rpc('eth_call',[payload,'latest'])[2:]))[0]
                expected=int(q.astype(np.int64)@x);assert actual==expected,(fork,label,actual,expected)
                r=tx(payload);row={'case':label,'modexp_gas':int(r['gasUsed'],16),'exact':True}
                data='0x'+(keccak(text='packedDot(address,bytes)')[:4]+encode(['address','bytes'],[shard,x.astype('>i2').tobytes()])).hex()
                payload={'to':engine['contractAddress'],'data':data};actual=decode(['int256'],bytes.fromhex(rpc('eth_call',[payload,'latest'])[2:]))[0]
                assert actual==expected,(fork,label,'native')
                row['native_gas']=int(tx(payload)['gasUsed'],16);out['cases'].append(row)
            report['forks'].append(out);print(json.dumps(out),flush=True)
        finally:
            child.terminate();child.wait(timeout=5)
    report['status']='completed';(ROOT/'modexp-results.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':main()
