"""Read-only public-node checks of three optimized batches per network.

No keys, signing, deployments or transaction broadcast. Captured states are
temporary RPC overrides, never writes to the public chain.
"""
import gzip
import hashlib
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from compare_public import NETWORKS

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'simulation-cases-optimized-batch8.json.gz'

def run(name):
    chain_id,endpoint,_=NETWORKS[name]
    cases=json.loads(gzip.decompress(SOURCE.read_bytes()))
    cases=[c for c in cases if c['label'] in {'t0-s2-r0','t0-s9-r0','t0-s10-r0'}]
    assert len(cases)==3
    path=ROOT.parent/'results'/f'optimized-public-{name}.json'
    report={'network':name,'endpoint':endpoint,'started_at':datetime.now(timezone.utc).isoformat(),
        'fixture_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'public_transactions_broadcast':0,'native_currency_spent':0,'status':'running','cases':[],
        'limitations':['Three representative batches, not a complete public-chain run.',
            'State overrides are temporary node simulation only.',
            'RPC estimates may include chain-specific overhead; no fee or inclusion-time claim.']}
    def save():path.write_text(json.dumps(report,indent=2)+'\n')
    def rpc(method,params):
        assert method in {'eth_chainId','eth_getBlockByNumber','eth_call','eth_estimateGas'}
        body=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode()
        request=urllib.request.Request(endpoint,body,{'Content-Type':'application/json','User-Agent':'LFM-exact-optimization/1.0'})
        with urllib.request.urlopen(request,timeout=45) as response:answer=json.load(response)
        if 'error' in answer:raise RuntimeError(str(answer['error']))
        return answer['result']
    try:
        assert int(rpc('eth_chainId',[]),16)==chain_id
        for c in cases:
            block=rpc('eth_getBlockByNumber',['latest',False]);tag=block['number']
            tx=dict(c['tx'],gas=hex(16777216))
            item={'label':c['label'],'block':int(tag,16),'block_hash':block['hash'],
                'step_count':c['step_count'],'local_gas_used':c['local_gas_used']}
            report['cases'].append(item)
            item['actual_return']=rpc('eth_call',[tx,tag,c['override']])
            item['expected_return']=c['expected_return']
            item['matches_reference']=item['actual_return']==item['expected_return']
            assert item['matches_reference'],c['label']
            # BSC's public endpoint may prune the first block while returning.
            block=rpc('eth_getBlockByNumber',['latest',False]);tag=block['number']
            item['estimate_block']=int(tag,16)
            item['estimated_gas']=int(rpc('eth_estimateGas',[tx,tag,c['override']]),16)
            save();print(json.dumps({'network':name,**item}),flush=True)
        report['status']='passed_read_only_samples'
    except Exception as exc:
        report.update(status='failed',error=str(exc))
        print(json.dumps({'network':name,'error':str(exc)}),flush=True)
    report['finished_at']=datetime.now(timezone.utc).isoformat();save()
    return {'network':name,'status':report['status']}

if __name__=='__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        print(json.dumps(list(pool.map(run,NETWORKS))),flush=True)
