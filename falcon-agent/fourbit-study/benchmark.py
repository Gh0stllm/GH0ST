"""Local exact-arithmetic, reader, compiler and full model matrix benchmarks."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from codec import CONFIGS, encode, decode
from local import EVM, index_blob, creation_gas

ROOT=Path(__file__).resolve().parent
NAMES={'sym32_s8':'FourBitSym32','sym64_s12':'FourBitSym64',
       'affine64_s12z4':'FourBitAffine64','affine128_s12z4':'FourBitAffine128'}


def quick(a):
    evm=EVM(a.anvil)
    rng=np.random.default_rng(41139)
    report={'status':'running','public_transactions_broadcast':0,'compiler_runs':a.runs,
            'scope':'Local Cancun, 96 KiB code limit, 32 million gas block limit; synthetic int16 exact arithmetic',
            'kernel_deployments':{},'cases':[],'reader_checks':[],'invalid_checks':[]}
    artifact=json.loads((ROOT/f'compiled-{a.runs}.json').read_text())
    def save():(ROOT/f'quick-{a.runs}.json').write_text(json.dumps(report,indent=2)+'\n')
    try:
        for variant,(group,bits,affine) in CONFIGS.items():
            name=NAMES[variant]
            c=artifact['contracts'][name]
            engine,gas=evm.deploy(bytes.fromhex(c['evm']['bytecode']['object']))
            report['kernel_deployments'][name]={'gas':gas,'runtime_bytes':len(c['evm']['deployedBytecode']['object'])//2}
            rows,cols=64,512
            g=rows*cols//group
            codes=rng.integers(0,16,(g,group),dtype=np.uint8)
            codes[:4]=np.array([np.zeros(group),np.full(group,15),np.tile([0,15],group//2),np.tile([15,0],group//2)],dtype=np.uint8)
            scales=rng.integers(1,1<<bits,g)
            scales[:4]=(1<<bits)-1
            zeros=rng.integers(0,16,g) if affine else np.full(g,8)
            unit=17
            blob=encode(codes,scales,zeros,group,bits,affine,unit)
            weights=((codes.astype(np.int64)-zeros[:,None])*(scales*unit)[:,None]).reshape(rows,cols)
            shard,_=evm.data(blob)
            cases={'random':rng.integers(-32768,32768,cols,dtype=np.int64),'minimum':np.full(cols,-32768,dtype=np.int64),
                   'maximum':np.full(cols,32767,dtype=np.int64),'alternating':np.tile([-32768,32767],cols//2),'zero':np.zeros(cols,dtype=np.int64)}
            for lane in range(8):
                x=np.zeros(cols,dtype=np.int64);x[lane::8]=-32768
                cases[f'negative_lane_{lane}']=x
            for label,x in cases.items():
                actual,gas=evm.dot(engine,shard,x,rows,cols)
                assert actual==(weights@x).tolist(),(variant,label)
                report['cases'].append({'variant':variant,'case':label,'rows':rows,'cols':cols,'gas':gas,'exact':True})
            # Intentionally force headers, metadata and codes across small shards.
            prefix=bytes(1010)
            raw=prefix+blob
            addresses=[evm.data(raw[i:i+1013])[0] for i in range(0,len(raw),1013)]
            index,_=evm.data(index_blob(raw,addresses,1013))
            x=cases['random']
            for first,n in [(0,64),(1,1),(7,19),(63,1)]:
                actual,gas=evm.file(engine,index,len(prefix),x,first,n,cols)
                assert actual==(weights[first:first+n]@x).tolist(),(variant,first,n)
                report['reader_checks'].append({'variant':variant,'first_row':first,'rows':n,'gas':gas,'exact':True})
            bad={'magic':b'BAD!'+blob[4:],'truncated':blob[:-1], 'trailing':blob+b'\0',
                 'group_count':blob[:4]+(g+1).to_bytes(4,'big')+blob[8:],
                 'group_size':blob[:8]+bytes([1])+blob[9:],'scale_bits':blob[:9]+bytes([7])+blob[10:],
                 'affine_flag':blob[:10]+bytes([1-int(affine)])+blob[11:],
                 'zero_unit':blob[:12]+bytes(4)+blob[16:], 'reserved':blob[:11]+b'\1'+blob[12:]}
            payloads=[]
            for label,b in bad.items():
                address,_=evm.data(b)
                payloads.append((label,evm.payload(engine,'dot(address,bytes,uint256,uint256)',
                    ['address','bytes','uint256','uint256'],[address,x.astype('>i2').tobytes(),rows,cols])))
            payloads.append(('file_bounds',evm.payload(engine,'dotFile(address,uint256,bytes,uint256,uint256,uint256)',
                ['address','uint256','bytes','uint256','uint256','uint256'],[index,len(prefix),x.astype('>i2').tobytes(),64,1,cols])))
            payloads.append(('wrong_index',evm.payload(engine,'dotFile(address,uint256,bytes,uint256,uint256,uint256)',
                ['address','uint256','bytes','uint256','uint256','uint256'],[shard,len(prefix),x.astype('>i2').tobytes(),0,1,cols])))
            for label,payload in payloads:
                try:evm.rpc('eth_call',[payload,'latest'])
                except RuntimeError as e:
                    assert 'revert' in str(e).lower()
                    report['invalid_checks'].append({'variant':variant,'case':label,'rejected':True})
                else:raise AssertionError((variant,label,'not rejected'))
            save()
            print(json.dumps({'variant':variant,'random_gas':next(r['gas'] for r in report['cases'] if r['variant']==variant and r['case']=='random')}),flush=True)
        report['status']='completed';save()
    finally:evm.close()


def full(a):
    assert a.variant and a.exports
    folder=a.exports/a.variant
    m=json.loads((folder/'manifest.json').read_text())
    data=(folder/'weights.bin').read_bytes()
    assert hashlib.sha256(data).hexdigest()==m['sha256']
    artifact=json.loads((ROOT/f'compiled-{a.runs}.json').read_text())
    name=NAMES[m.get('format_variant',a.variant)]
    evm=EVM(a.anvil)
    report={'status':'running','variant':a.variant,'weights_sha256':m['sha256'],'compiler_runs':a.runs,
        'scope':'All matrix rows verified using the real sharded file and index; random int16 inputs. NOT full-token inference.',
        'public_transactions_broadcast':0,'payload_limit':98303,'weight_bytes':len(data),'shards':[],
        'matrices':[],'usage_gas':0,'rows_verified':0,'tiles':0,'weight_elements':0,'tile_sweep':[]}
    def save():(ROOT/'full-results.json').write_text(json.dumps(report,indent=2)+'\n')
    try:
        engine,gas=evm.deploy(bytes.fromhex(artifact['contracts'][name]['evm']['bytecode']['object']))
        report['kernel']={'name':name,'deployment_gas':gas,'runtime_bytes':len(artifact['contracts'][name]['evm']['deployedBytecode']['object'])//2}
        addresses=[]
        for i,start in enumerate(range(0,len(data),98303)):
            payload=data[start:start+98303]
            addr,gas=evm.data(payload);addresses.append(addr)
            report['shards'].append({'index':i,'offset':start,'payload_bytes':len(payload),'gas':gas})
        report['weight_deployment_gas']=sum(s['gas'] for s in report['shards'])
        report['weight_shards']=len(addresses)
        ix=index_blob(data,addresses,98303)
        index,gas=evm.data(ix)
        report['index']={'deployment_gas_local_addresses':gas,'runtime_bytes':len(ix)+1,
                         'note':'Final calldata gas depends on actual deployed addresses.'}
        rng=np.random.default_rng(85112)
        # Memory growth depends on matrix width. Select a tile for each actual
        # width using a fixed representative before verifying every matrix row.
        tiles={}
        for cols in sorted({t['shape'][1] for t in m['tensors'] if t['matrix']}):
            t=max((t for t in m['tensors'] if t['matrix'] and t['shape'][1]==cols),key=lambda t:t['shape'][0])
            c,s,z,u=decode(data[t['offset']:t['offset']+t['byte_count']])
            weights=((c-z[:,None])*(s*u)[:,None]).reshape(t['shape'])
            x=rng.integers(-32768,32768,cols,dtype=np.int64)
            for rows in [32,64,128,256]:
                if rows>t['shape'][0]:continue
                actual,gas=evm.file(engine,index,t['offset'],x,0,rows,cols)
                assert actual==(weights[:rows]@x).tolist()
                report['tile_sweep'].append({'cols':cols,'rows':rows,'gas':gas,'gas_per_row':gas/rows})
            tiles[cols]=min((r for r in report['tile_sweep'] if r['cols']==cols),key=lambda r:r['gas_per_row'])['rows']
        report['selected_tile_rows_by_columns']=tiles
        # Match the preserved six-bit full-matrix benchmark's input stream.
        rng=np.random.default_rng(85112)
        for t in m['tensors']:
            if not t['matrix']:continue
            rows,cols=t['shape']
            tile=tiles[cols]
            c,s,z,u=decode(data[t['offset']:t['offset']+t['byte_count']])
            weights=((c-z[:,None])*(s*u)[:,None]).reshape(rows,cols)
            x=rng.integers(-32768,32768,cols,dtype=np.int64)
            expected=weights@x
            item={'name':t['name'],'shape':t['shape'],'gas':0,'tiles':0}
            for first in range(0,rows,tile):
                n=min(tile,rows-first)
                actual,gas=evm.file(engine,index,t['offset'],x,first,n,cols)
                assert actual==expected[first:first+n].tolist(),(t['name'],first)
                item['gas']+=gas;item['tiles']+=1
                report['usage_gas']+=gas;report['tiles']+=1;report['rows_verified']+=n
            report['matrices'].append(item);report['weight_elements']+=rows*cols
            save()
            if len(report['matrices'])%20==0:print(json.dumps({'matrices':len(report['matrices']),'gas':report['usage_gas']}),flush=True)
        report['status']='completed';save()
        print(json.dumps({k:v for k,v in report.items() if k not in ['matrices','shards','tile_sweep']}),flush=True)
    finally:evm.close()


def main():
    p=argparse.ArgumentParser();p.add_argument('--anvil',type=Path,required=True)
    p.add_argument('--runs',type=int,default=1000000);p.add_argument('--full',action='store_true')
    p.add_argument('--variant');p.add_argument('--exports',type=Path)
    a=p.parse_args()
    full(a) if a.full else quick(a)


if __name__=='__main__':main()
