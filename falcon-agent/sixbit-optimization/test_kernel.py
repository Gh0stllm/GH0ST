"""Local-only exact arithmetic and gas tests. No public RPC/key option."""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path
import numpy as np
import requests
from eth_abi import encode, decode
from eth_utils import keccak
from optimize import encode_matrix, old_codes, pack

ROOT = Path(__file__).resolve().parent


def initcode(data):
    runtime = b'\0' + data
    assert len(runtime) < 65536
    return b'\x61' + len(runtime).to_bytes(2,'big') + bytes.fromhex('80600c6000396000f3') + runtime


def legacy(o,s,c):
    g=len(o);bits=((c.reshape(-1,1) >> np.arange(6,dtype=np.uint8)) & 1).reshape(-1)
    return np.asarray(o,dtype='<i4').tobytes()+np.asarray(s,dtype='<u4').tobytes()+np.packbits(bits,bitorder='little').tobytes()


def raw_matrix(o,s,c):
    g=len(o)
    return b'F6R1'+g.to_bytes(4,'big')+bytes(8)+b''.join(int(a).to_bytes(4,'big',signed=True)+int(b).to_bytes(4,'big') for a,b in zip(o,s))+pack(c.reshape(-1,8)[:,::-1].reshape(-1),6)


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--compact',type=Path,required=True);p.add_argument('--anvil',type=Path,required=True);a=p.parse_args()
    manifest=json.loads((a.source/'manifest.json').read_text());raw=(a.source/'weights.bin').read_bytes()
    artifact=json.loads((ROOT/'compiled.json').read_text());contract=artifact['contracts']['SixBitKernel']
    report={'status':'running','environment':'local Anvil Cancun, code size raised to RH documented 96KiB; NOT Nitro/RH',
            'compiler':artifact['compiler'],'public_transactions_broadcast':0,'public_eth_spent':'0',
            'arithmetic':'Exact Q24 affine weight times signed int16; no intermediate rounding. Not float32 full-model inference.',
            'activation_quality_evaluated':False,'checks':[],'benchmarks':[],'deployment_samples':[]}
    def save():(ROOT/'kernel-results.json').write_text(json.dumps(report,indent=2)+'\n')
    def check(name,condition=True):
        assert condition,name
        report['checks'].append({'name':name,'passed':True})
    log=(a.compact/'anvil-sixbit.log').open('w')
    child=subprocess.Popen([str(a.anvil.resolve()),'--host','127.0.0.1','--port','18553','--chain-id','31337','--hardfork','cancun','--gas-limit','100000000','--code-size-limit','98304','--silent'],stdout=log,stderr=log)
    session=requests.Session();session.trust_env=False
    def rpc(method,params=()):
        r=session.post('http://127.0.0.1:18553',json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=60).json()
        if 'error' in r:raise RuntimeError(str(r['error']))
        return r['result']
    try:
        for _ in range(200):
            try:check('loopback chain id',int(rpc('eth_chainId'),16)==31337);break
            except requests.ConnectionError:time.sleep(.05)
        else:raise RuntimeError('Anvil startup failed')
        account=rpc('eth_accounts')[0]
        def tx(payload):
            h=rpc('eth_sendTransaction',[{'from':account,'gas':hex(90000000),**payload}])
            for _ in range(200):
                r=rpc('eth_getTransactionReceipt',[h])
                if r is not None:break
                time.sleep(.01)
            else:raise RuntimeError('Missing local receipt')
            assert int(r['status'],16)==1,r
            return r
        def deploy(blob):
            r=tx({'data':'0x'+blob.hex()});return r['contractAddress'],int(r['gasUsed'],16)
        engine,gas=deploy(bytes.fromhex(contract['evm']['bytecode']['object']))
        report['kernel_deployment_gas']=gas;report['kernel_runtime_bytes']=len(contract['evm']['deployedBytecode']['object'])//2
        fast,gas=deploy(bytes.fromhex(artifact['contracts']['SixBitFast']['evm']['bytecode']['object']))
        report['fast_kernel_deployment_gas']=gas
        rng=np.random.default_rng(923711)
        names=['model.embed_tokens.weight','model.layers.0.feed_forward.down_proj.weight','model.layers.11.mamba.in_proj.weight','model.layers.23.self_attn.v_proj.weight']
        suites=[]
        for name in names:
            t=next(t for t in manifest['tensors'] if t['name']==name);g=t['group_count'];blob=raw[t['offset']:t['offset']+t['byte_count']]
            o=np.frombuffer(blob[:4*g],dtype='<i4');s=np.frombuffer(blob[4*g:8*g],dtype='<u4');c=old_codes(blob,g).reshape(-1,64)
            cols=t['shape'][1];rows=32;count=rows*cols//64
            start=0 if '11.mamba' not in name else 0
            suites.append((name,rows,cols,o[start:start+count],s[start:start+count],c[start:start+count].reshape(-1)))
        # Exercise all eight lanes, code values 0..63, signed extrema and
        # scale-conversion ties that differ from naive integer division.
        for label,rows,cols,offset,step in [('edges',4,64,-9437184,264224),('tie_up',4,64,-6520832,292832),('zero_offset',4,64,0,1)]:
            c=np.tile(np.arange(64,dtype=np.uint8),rows)
            suites.append((label,rows,cols,np.full(rows,offset),np.full(rows,step),c))
        for name,rows,cols,o,s,c in suites:
            blob=legacy(o,s,c);compact,_=encode_matrix(blob,len(o));plain=raw_matrix(o,s,c)
            addr0,g0=deploy(initcode(plain));addr1,g1=deploy(initcode(compact))
            data={'matrix':name,'rows':rows,'cols':cols,'raw_bytes':len(plain),'compact_bytes':len(compact),'raw_deploy_gas':g0,'compact_deploy_gas':g1,'cases':[]}
            weights=o.astype(np.int64)[:,None]+s.astype(np.int64)[:,None]*c.reshape(-1,64).astype(np.int64)
            weights=weights.reshape(rows,cols)
            for case in ['random','maximum','minimum','alternating','zero']:
                x={'random':rng.integers(-32768,32768,cols,dtype=np.int64),'maximum':np.full(cols,32767,dtype=np.int64),'minimum':np.full(cols,-32768,dtype=np.int64),'alternating':np.tile(np.array([-32768,32767],dtype=np.int64),cols//2),'zero':np.zeros(cols,dtype=np.int64)}[case]
                expected=(weights@x).tolist();xb=x.astype('>i2').tobytes();row={'case':case,'gas':{}}
                for mode in range(6):
                    payload='0x'+(keccak(text='dot(address,bytes,uint256,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256','uint256'],[addr0 if mode==0 else addr1,xb,rows,cols,mode])).hex()
                    if mode==5:payload='0x'+(keccak(text='dot(address,bytes,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256'],[addr1,xb,rows,cols])).hex()
                    target=fast if mode==5 else engine
                    result=rpc('eth_call',[{'to':target,'data':payload},'latest'])
                    actual=list(decode(['int256[]'],bytes.fromhex(result[2:]))[0])
                    check(name+'/'+case+'/mode'+str(mode),actual==expected)
                    r=tx({'to':target,'data':payload});row['gas'][str(mode)]=int(r['gasUsed'],16)
                data['cases'].append(row)
            report['benchmarks'].append(data);save()
            print(json.dumps({'matrix':name,'gas_random':data['cases'][0]['gas']}),flush=True)
        # Every original tensor's metadata type/bit alignment is also exercised
        # against EVM on its first and last groups; includes all zero-bound groups.
        for t in manifest['tensors']:
            if 'group_count' not in t:continue
            g=t['group_count'];blob=raw[t['offset']:t['offset']+t['byte_count']]
            o=np.frombuffer(blob[:4*g],dtype='<i4');s=np.frombuffer(blob[4*g:8*g],dtype='<u4');c=old_codes(blob,g).reshape(g,64)
            idx=np.unique(np.r_[np.arange(min(8,g)),np.arange(max(0,g-8),g),np.flatnonzero(o==0)])
            # 16 groups normally, at most 32 in this model.
            oo,ss,cc=o[idx],s[idx],c[idx];small=legacy(oo,ss,cc.reshape(-1));compact,_=encode_matrix(small,len(idx));addr,_=deploy(initcode(compact))
            x=rng.integers(-32768,32768,64,dtype=np.int64)
            expected=((oo.astype(np.int64)[:,None]+ss.astype(np.int64)[:,None]*cc)*x).sum(1).tolist()
            payload='0x'+(keccak(text='dot(address,bytes,uint256,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256','uint256'],[addr,x.astype('>i2').tobytes(),len(idx),64,4])).hex()
            actual=list(decode(['int256[]'],bytes.fromhex(rpc('eth_call',[{'to':engine,'data':payload},'latest'])[2:]))[0])
            check('tensor-boundary/'+t['name'],actual==expected)
            payload='0x'+(keccak(text='dot(address,bytes,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256'],[addr,x.astype('>i2').tobytes(),len(idx),64])).hex()
            actual=list(decode(['int256[]'],bytes.fromhex(rpc('eth_call',[{'to':fast,'data':payload},'latest'])[2:]))[0])
            check('fast-tensor-boundary/'+t['name'],actual==expected)
        compact=(a.compact/'weights.bin').read_bytes();limit=61439;count=(len(compact)+limit-1)//limit
        for i in [0,count//2,count-1]:
            payload=compact[i*limit:(i+1)*limit];addr,gas=deploy(initcode(payload))
            check('weight shard '+str(i),rpc('eth_getCode',[addr,'latest'])=='0x00'+payload.hex())
            report['deployment_samples'].append({'index':i,'bytes':len(payload),'gas':gas,'sha256':hashlib.sha256(payload).hexdigest()})
        report['status']='completed';save();print(json.dumps({'checks':len(report['checks']),'kernel_deployment_gas':report['kernel_deployment_gas'],'deployment_samples':report['deployment_samples']},indent=2))
    finally:
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait()
        log.close()


if __name__=='__main__':main()
