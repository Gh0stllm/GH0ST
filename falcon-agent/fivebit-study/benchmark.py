"""Local five-bit kernel and deployment validation. No public RPC or signing."""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
from eth_abi import encode as abi_encode
from eth_utils import keccak
from codec import encode, decode, parse, exact_scale, layout

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent/'gas-refinement'))
# Avoid this file's name shadowing the existing harness module.
import importlib.util
spec=importlib.util.spec_from_file_location('existing_gas_harness',ROOT.parent/'gas-refinement/benchmark.py')
harness=importlib.util.module_from_spec(spec);spec.loader.exec_module(harness)
LocalEVM=harness.LocalEVM
initcode=harness.initcode


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--exports',type=Path,required=True);p.add_argument('--anvil',type=Path,required=True);a=p.parse_args()
    raw=(a.source/'weights.bin').read_bytes();m=json.loads((a.source/'manifest.json').read_text())
    assert m['variant']=='int5' and hashlib.sha256(raw).hexdigest()==m['sha256']
    artifact=json.loads((ROOT/'compiled.json').read_text())
    modes={'compact':'FiveBitCompact','shifted':'FiveBitShifted'}
    evm=LocalEVM(a.anvil,port=18573)
    report={'status':'running','environment':'Local Anvil Cancun, raised code limit 98304, solc 0.8.30 viaIR runs 1000000',
            'scope':'Exact int5 matrix arithmetic on synthetic int16 inputs; NOT complete inference or int6 equivalence',
            'source_sha256':m['sha256'],'public_transactions_broadcast':0,'kernel_deployments':{},'edge_checks':[],
            'matrices':[],'rows_verified':0,'tiles':0,'weight_elements':0,'usage_gas':{n:0 for n in modes.values()},
            'deployment_samples':[],'malformed_rejections':[]}
    def save():(ROOT/'kernel-results.json').write_text(json.dumps(report,indent=2)+'\n')
    try:
        engines={}
        for name in modes.values():
            c=artifact['contracts'][name]
            engines[name],gas=evm.deploy(bytes.fromhex(c['evm']['bytecode']['object']))
            report['kernel_deployments'][name]={'gas':gas,'runtime_bytes':len(c['evm']['deployedBytecode']['object'])//2}
        rng=np.random.default_rng(85112)
        for t in m['tensors']:
            if 'group_count' not in t:continue
            rows,cols=t['shape'];o,s,c=parse(raw[t['offset']:t['offset']+t['byte_count']],t['group_count'])
            x=rng.integers(-32768,32768,cols,dtype=np.int64)
            item={'name':t['name'],'shape':t['shape'],'gas':{n:0 for n in modes.values()},'tiles':0}
            for start in range(0,rows,64):
                n=min(64,rows-start);lo=start*cols//64;hi=(start+n)*cols//64
                oo,ss,cc=o[lo:hi],s[lo:hi],c[lo:hi]
                weights=(oo[:,None]+ss[:,None]*cc.astype(np.int64)).reshape(n,cols)
                expected=(weights@x).tolist()
                for mode,name in modes.items():
                    blob=encode(oo,ss,cc,mode);shard,_=evm.deploy(initcode(blob))
                    actual,gas=evm.call(engines[name],shard,x,n,cols)
                    assert actual==expected,(t['name'],start,name)
                    item['gas'][name]+=gas;report['usage_gas'][name]+=gas
                    if start==0 and t['name'] in ['model.embed_tokens.weight','model.layers.0.feed_forward.down_proj.weight','model.layers.11.mamba.in_proj.weight','model.layers.23.self_attn.v_proj.weight']:
                        cases={'minimum':np.full(cols,-32768,dtype=np.int64),'maximum':np.full(cols,32767,dtype=np.int64),'alternating':np.tile([-32768,32767],cols//2),'zero':np.zeros(cols,dtype=np.int64)}
                        for lane in range(8):
                            v=np.zeros(cols,dtype=np.int64);v[lane::8]=-32768;cases['negative_lane_'+str(lane)]=v
                        for label,v in cases.items():
                            result,_=evm.call(engines[name],shard,v,n,cols)
                            assert result==(weights@v).tolist(),(t['name'],name,label)
                            report['edge_checks'].append({'matrix':t['name'],'kernel':name,'case':label,'passed':True})
                report['rows_verified']+=n;report['tiles']+=1;item['tiles']+=1
            report['matrices'].append(item);report['weight_elements']+=rows*cols;save()
            if len(report['matrices'])%20==0:print(json.dumps({'matrices':len(report['matrices']),'gas':report['usage_gas']}),flush=True)
        for mode,name in modes.items():
            data=(a.exports/mode/'weights.bin').read_bytes()
            for limit in [24575,61439]:
                starts=[0,(len(data)//(2*limit))*limit,((len(data)-1)//limit)*limit]
                for start in starts:
                    block=data[start:start+limit];addr,gas=evm.deploy(initcode(block))
                    assert evm.rpc('eth_getCode',[addr,'latest'])=='0x00'+block.hex()
                    modeled=layout(block,limit)['modeled_weight_shard_deployment_gas'];assert gas==modeled
                    report['deployment_samples'].append({'mode':mode,'limit':limit,'offset':start,'bytes':len(block),'measured_gas':gas,'modeled_gas':modeled})
        t=next(t for t in m['tensors'] if 'group_count' in t)
        o,s,c=parse(raw[t['offset']:t['offset']+t['byte_count']],t['group_count']);x=np.ones(64,dtype=np.int64)
        for mode,name in modes.items():
            valid=encode(o[:1],s[:1],c[:1],mode)
            malformed={'truncated':valid[:-1],'trailing_byte':valid+b'\0','wrong_magic':b'BAD!'+valid[4:],
                       'wrong_group_count':valid[:4]+(2).to_bytes(4,'big')+valid[8:]}
            if mode=='compact':
                malformed.update(zero_width=valid[:12]+b'\0'+valid[13:],excess_width=valid[:12]+b'\x11'+valid[13:])
            else:
                malformed.update(bad_stride=valid[:8]+b'\x07'+valid[9:],bad_shift=valid[:9]+b'\x20'+valid[10:],bad_scale_bits=valid[:10]+b'\x18'+valid[11:])
            for label,blob in malformed.items():
                shard,_=evm.deploy(initcode(blob))
                payload={'to':engines[name],'data':'0x'+(keccak(text='dot(address,bytes,uint256,uint256)')[:4]+abi_encode(['address','bytes','uint256','uint256'],[shard,x.astype('>i2').tobytes(),1,64])).hex()}
                try:evm.rpc('eth_call',[payload,'latest'])
                except RuntimeError as e:
                    assert 'revert' in str(e).lower();report['malformed_rejections'].append({'kernel':name,'case':label,'passed':True})
                else:raise AssertionError((name,label,'accepted malformed input'))
        # Independent packed-lane and float32 scale boundary checks.
        r=np.random.default_rng(512031);mask256=(1<<256)-1
        mul=sum(1<<(54*j) for j in range(4));mask=sum(1023<<(64*j) for j in range(4));lanes=sum(31<<(32*j) for j in range(8))
        for _ in range(10000):
            codes=r.integers(0,32,8).tolist();v=sum(int(c)<<(5*j) for j,c in enumerate(codes))
            wide=((((v*mul)&mask256)&mask)*(1+(1<<27)))&mask256&lanes
            assert wide==sum(int(c)<<(32*j) for j,c in enumerate(codes))
        d=np.r_[r.integers(1,31*(1<<23),100000),[31*q+k for q in [1<<19,1<<20,1<<21,1<<22] for k in range(-64,65)]]
        expected=np.maximum(1,np.rint(d.astype(np.float32)/np.float32(31)).astype(np.int64))
        # Real exports have exactly float32-representable integer deltas. Filter
        # random values to that same documented domain.
        exact=d.astype(np.float32).astype(np.int64)==d
        assert np.array_equal(exact_scale(d[exact]),expected[exact])
        report['dilation_checks']=10000;report['scale_boundary_checks']=int(exact.sum())
        report['status']='completed';save();print(json.dumps({k:v for k,v in report.items() if k not in ['matrices','edge_checks','deployment_samples','malformed_rejections']}),flush=True)
    finally:evm.close()


if __name__=='__main__':main()
