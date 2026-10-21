"""Prepare a reviewable, unsigned RH weight-data plan. Never broadcasts."""
import argparse,hashlib,json,shutil,sys
from pathlib import Path
from eth_utils import keccak
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from prepare_deployment import init_code,cancun_creation_gas


def main():
    p=argparse.ArgumentParser();p.add_argument('--export',type=Path,required=True);a=p.parse_args()
    m=json.loads((a.export/'manifest.json').read_text());data=(a.export/'weights.bin').read_bytes()
    assert m['variant']=='int6_exact_compact_v2' and hashlib.sha256(data).hexdigest()==m['sha256']
    assert len(data)==m['bytes'] and data[:8]==b'FC6BIT02'
    cursor=16+32*len(m['tensors'])
    for t in m['tensors']:
        assert t['offset']==cursor;cursor+=t['byte_count']
        assert hashlib.sha256(data[t['offset']:cursor]).hexdigest()==t['sha256']
    assert cursor==len(data)
    shards=[]
    for i,start in enumerate(range(0,len(data),61439)):
        payload=data[start:start+61439];init,runtime=init_code(payload)
        shards.append({'index':i,'offset':start,'payload_bytes':len(payload),'runtime_keccak256':'0x'+keccak(runtime).hex(),
                       'modeled_cancun_creation_gas':cancun_creation_gas(init,runtime)})
    checks=json.loads((ROOT/'kernel-results.json').read_text())
    assert checks['status']=='completed'
    for sample in checks['deployment_samples']:
        expected=shards[sample['index']]
        assert sample['gas']==expected['modeled_cancun_creation_gas']
    result={'status':'weights_and_local_kernels_verified_full_engine_missing','chain_target':'existing Robinhood Chain',
            'variant':m['variant'],'weights_sha256':m['sha256'],'weight_bytes':len(data),'public_transactions_broadcast':0,
            'local_model_manifest':'selected-weight-manifest.json','shard_count':len(shards),'payload_limit':61439,
            'modeled_weight_deployment_gas':sum(s['modeled_cancun_creation_gas'] for s in shards),
            'code_deposit_gas_only':200*(len(data)+len(shards)),
            'maximum_shard_gas':max(s['modeled_cancun_creation_gas'] for s in shards),
            'cost_scope':'Standard Cancun model, not a live Robinhood quote. Includes file header/tensor index; excludes address index, tokenizer, inference engine, controller and L1 fees.',
            'missing':['Cross-shard tensor reader and validated scheduler','On-chain tokenizer','Complete attention/Mamba and nonlinear runtime','Activation/state precision validation','Persistent per-agent state','Full token and reply gas','Live RH transaction-budget and fee validation'],
            'note':'Benchmark kernels read a complete matrix tile from one local shard. Production file shards may cross tensor/tile boundaries; that reader is not implemented.',
            'samples':checks['deployment_samples'],'shards':shards}
    historical=ROOT.parent/'historical-weight-layouts';historical.mkdir(exist_ok=True)
    for name in ['deployment-manifest.json','selected-weight-manifest.json']:
        old=ROOT.parent/name
        if old.exists():
            previous=json.loads(old.read_text())
            if previous.get('variant')=='nf4_g128':
                target=historical/name
                if not target.exists():shutil.copy2(old,target)
    (ROOT.parent/'selected-weight-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    (ROOT.parent/'deployment-manifest.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['shards','missing']},indent=2))


if __name__=='__main__':main()
