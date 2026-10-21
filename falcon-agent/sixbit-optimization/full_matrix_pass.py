"""Measure every 2D weight matrix on the local EVM with synthetic int16 inputs.

This deliberately does NOT call itself token inference: no actual layer-to-layer
activations, normalization, Mamba/attention state, tokenizer, sampling or agent.
It establishes arithmetic correctness and receipts for the dominant linear work.
"""
import argparse,json,subprocess,time
from pathlib import Path
import numpy as np,requests
from eth_abi import encode,decode
from eth_utils import keccak
from optimize import old_codes,encode_matrix
from test_kernel import legacy,initcode
ROOT=Path(__file__).resolve().parent


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--anvil',type=Path,required=True);a=p.parse_args()
    raw=(a.source/'weights.bin').read_bytes();m=json.loads((a.source/'manifest.json').read_text());artifact=json.loads((ROOT/'compiled.json').read_text())
    report={'status':'running','scope':'All 217 two-dimensional matrices once with synthetic signed-int16 vectors, exact integer reference. NOT one model token or complete inference.',
            'environment':'Local Anvil Cancun, 96KiB code limit; not a RH/Nitro execution or fee quote.',
            'excludes':['nonlinear functions','attention and Mamba state updates','state persistence','tokenization','sampling','on-chain matrix scheduling','agent','L1 data fees'],
            'public_transactions_broadcast':0,'weight_elements':0,'usage_receipt_gas':0,'local_weight_tile_deploy_gas':0,'tiles':0,'rows_verified':0,'matrices':[]}
    def save():(ROOT/'full-matrix-results.json').write_text(json.dumps(report,indent=2)+'\n')
    child=subprocess.Popen([str(a.anvil.resolve()),'--host','127.0.0.1','--port','18555','--hardfork','cancun','--code-size-limit','98304','--gas-limit','16777216','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    session=requests.Session();session.trust_env=False
    def rpc(method,params=()):
        r=session.post('http://127.0.0.1:18555',json={'jsonrpc':'2.0','id':1,'method':method,'params':list(params)},timeout=60).json()
        if 'error' in r:raise RuntimeError(r['error'])
        return r['result']
    try:
        for _ in range(200):
            try:account=rpc('eth_accounts')[0];break
            except requests.ConnectionError:time.sleep(.05)
        else:raise RuntimeError('Local Anvil startup failed')
        def tx(payload):
            h=rpc('eth_sendTransaction',[{'from':account,'gas':hex(16000000),**payload}])
            for _ in range(200):
                r=rpc('eth_getTransactionReceipt',[h])
                if r is not None:break
                time.sleep(.01)
            assert int(r['status'],16)==1,r
            return r
        receipt=tx({'data':'0x'+artifact['contracts']['SixBitFast']['evm']['bytecode']['object']});engine=receipt['contractAddress'];report['kernel_deployment_gas']=int(receipt['gasUsed'],16)
        rng=np.random.default_rng(85112)
        for t in m['tensors']:
            if 'group_count' not in t:continue
            g=t['group_count'];rows,cols=t['shape'];blob=raw[t['offset']:t['offset']+t['byte_count']]
            o=np.frombuffer(blob[:g*4],dtype='<i4');s=np.frombuffer(blob[g*4:g*8],dtype='<u4');c=old_codes(blob,g).reshape(g,64)
            x=rng.integers(-32768,32768,cols,dtype=np.int64);xb=x.astype('>i2').tobytes()
            result={'tensor':t['name'],'shape':t['shape'],'usage_gas':0,'weight_deploy_gas':0,'tiles':0}
            for start in range(0,rows,64):
                n=min(64,rows-start);lo=start*cols//64;hi=(start+n)*cols//64
                oo,ss,cc=o[lo:hi],s[lo:hi],c[lo:hi]
                old=legacy(oo,ss,cc.reshape(-1));compact,_=encode_matrix(old,len(oo));receipt=tx({'data':'0x'+initcode(compact).hex()})
                result['weight_deploy_gas']+=int(receipt['gasUsed'],16)
                payload={'to':engine,'data':'0x'+(keccak(text='dot(address,bytes,uint256,uint256)')[:4]+encode(['address','bytes','uint256','uint256'],[receipt['contractAddress'],xb,n,cols])).hex()}
                actual=list(decode(['int256[]'],bytes.fromhex(rpc('eth_call',[payload,'latest'])[2:]))[0])
                expected=((oo.astype(np.int64)[:,None]+ss.astype(np.int64)[:,None]*cc.astype(np.int64)).reshape(n,cols)@x).tolist()
                assert actual==expected,(t['name'],start)
                receipt=tx(payload);result['usage_gas']+=int(receipt['gasUsed'],16);result['tiles']+=1
                # Profile one representative tile without retaining bulky traces.
                if t['name']=='model.layers.0.feed_forward.gate_proj.weight' and start==0:
                    trace=rpc('debug_traceTransaction',[receipt['transactionHash'],{'disableStack':True,'disableMemory':True,'disableStorage':True}])
                    from collections import Counter
                    counts=Counter();gas=Counter()
                    for op in trace['structLogs']:counts[op['op']]+=1;gas[op['op']]+=op['gasCost']
                    result['first_tile_opcode_profile']={k:{'count':counts[k],'gas':gas[k]} for k in gas}
            report['matrices'].append(result);report['weight_elements']+=rows*cols;report['usage_receipt_gas']+=result['usage_gas'];report['local_weight_tile_deploy_gas']+=result['weight_deploy_gas'];report['tiles']+=result['tiles'];report['rows_verified']+=rows;save()
            print(json.dumps({'matrix':t['name'],'matrices_done':len(report['matrices']),'tiles':report['tiles'],'total_usage_gas':report['usage_receipt_gas']}),flush=True)
        report['status']='completed';save();print(json.dumps({k:v for k,v in report.items() if k!='matrices'},indent=2))
    finally:
        child.terminate();child.wait(timeout=5)


if __name__=='__main__':main()
