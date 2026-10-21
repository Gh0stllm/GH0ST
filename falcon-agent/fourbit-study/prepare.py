"""Prepare a pinned, unsigned four-bit deployment draft. Never sends transactions."""
import argparse
import hashlib
import json
from pathlib import Path
from eth_utils import keccak
from local import creation_gas, initcode

ROOT=Path(__file__).resolve().parent


def main():
    p=argparse.ArgumentParser();p.add_argument('--export',type=Path,required=True);a=p.parse_args()
    m=json.loads((a.export/'manifest.json').read_text())
    data=(a.export/'weights.bin').read_bytes()
    assert m['variant']=='affine64_s12z4' and hashlib.sha256(data).hexdigest()==m['sha256']
    assert len(data)==m['bytes'] and data[:8]==b'GH0ST4Q1'
    cursor=16+32*len(m['tensors'])
    for t in m['tensors']:
        assert t['offset']==cursor
        blob=data[cursor:cursor+t['byte_count']]
        assert hashlib.sha256(blob).hexdigest()==t['sha256']
        cursor+=len(blob)
    assert cursor==len(data)
    full=json.loads((ROOT/'full-results.json').read_text())
    quality=json.loads((ROOT/'heldout-quality.json').read_text())
    assert full['status']==quality['status']=='completed'
    assert full['weights_sha256']==m['sha256'] and quality['selected_before_heldout']==m['variant']
    assert full['rows_verified']==165440 and full['weight_elements']==90996736 and len(full['matrices'])==217
    c=json.loads((ROOT/'compiled-1000000.json').read_text())['contracts']['FourBitAffine64']['evm']
    checked=json.loads((ROOT/'creation-validation.json').read_text())
    assert checked['status']=='all_shards_verified' and checked['weights_sha256']==m['sha256']
    shards=[]
    for i,start in enumerate(range(0,len(data),98303)):
        payload=data[start:start+98303]
        gas=creation_gas(payload)
        assert full['shards'][i]['gas']==gas
        verified=checked['shards'][i]
        assert verified['index']==i and verified['runtime_keccak256']=='0x'+keccak(b'\0'+payload).hex()
        shards.append({'creation_encoding':verified['encoding'], 'creation_init_sha256':verified['init_sha256'],
            'creation_local_cancun_gas':verified['local_cancun_gas'],
            'maximum_signed_transaction_bytes':verified['maximum_signed_tx_bytes'], 'name':f'fourbit-weights-{i:04d}','index':i,'offset':start,'payload_bytes':len(payload),
            'runtime_keccak256':'0x'+keccak(b'\0'+payload).hex(),'init_sha256':hashlib.sha256(initcode(payload)).hexdigest(),
            'modeled_cancun_gas':gas})
    plan={'status':'lossless_creation_locally_verified','chain_id':4663,'variant':m['variant'],
        'weights_sha256':m['sha256'],'weight_bytes':len(data),'payload_limit':98303,
        'weight_shards':len(shards),'new_contracts_this_stage':len(shards)+2,
        'existing_sixbit_pilot_contracts':2,'total_contracts_including_existing_pilot':len(shards)+4,
        'prior_sixbit_weights_reused':False,'public_transactions_broadcast_this_study':0,
        'live_deployment_record':'mainnet/deployment-state.json',
        'creation_validation':'creation-validation.json',
        'submission_size_limit_bytes':95000,
        'lossless_weight_deployment_gas_local':checked['weight_deployment_gas_local'],
        'lossless_total_new_stage_gas_local':checked['weight_deployment_gas_local']+full['kernel']['deployment_gas']+full['index']['deployment_gas_local_addresses'],
        'kernel':{'name':'FourBitAffine64','runtime_keccak256':'0x'+keccak(bytes.fromhex(c['deployedBytecode']['object'])).hex(),
                  'init_sha256':hashlib.sha256(bytes.fromhex(c['bytecode']['object'])).hexdigest(),
                  'runtime_bytes':len(c['deployedBytecode']['object'])//2,'local_deployment_gas':full['kernel']['deployment_gas']},
        'index':{'runtime_bytes':49+20*len(shards),'deployment_gas_local_addresses':full['index']['deployment_gas_local_addresses'],
                 'deployment_order':'Last, after every shard receipt and exact runtime are verified',
                 'identity':'Pin the immutable index address in the eventual inference engine; its stored hash is not a per-read integrity check'},
        'weight_deployment_gas':full['weight_deployment_gas'],
        'total_new_stage_gas_local':full['weight_deployment_gas']+full['kernel']['deployment_gas']+full['index']['deployment_gas_local_addresses'],
        'batch_policy':{'default_contracts':25,'automatic_continuation':False,
            'first_batch':['FourBitAffine64']+[s['name'] for s in shards[:24]],
            'first_batch_modeled_gas':full['kernel']['deployment_gas']+checked['first_24_weight_gas_local'],
            'required_before_broadcast':['Fresh live estimates and wallet balance','Concrete batch spending cap',
              'Separate four-bit resume state and verified model/code pins','Signed transaction size accepted by sequencer',
              'Explicit instruction to start this batch'],
            'after_each_batch':['Actual receipt gas and ETH fees','Wallet balance','Verified contract count',
              'Remaining gas/fee estimate','Next-batch top-up estimate','Pause for user review']},
        'limitations':['Full tokenizer, attention/Mamba, nonlinear runtime, state and sampler remain unimplemented',
            '499 is the weights/index/matrix-kernel stage including the old pilot, not a guaranteed final system contract count',
            'Quality drift is material; this export is a research candidate, not an accuracy-certified deployment',
            'Local Cancun gas excludes RH L1 posting charges and is not a live ETH quote',
            'Existing six-bit broadcast script is not a four-bit deployment driver',
            'Lossless constructors increase deployment gas; execution gas and deployed weights are unchanged',
            'Largest conservative signed transaction is 94998 bytes; live price/nonce/size checks remain mandatory'],
        'shards':shards}
    (ROOT/'selected-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    (ROOT/'deployment-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
    print(json.dumps({k:v for k,v in plan.items() if k not in ['shards','limitations','batch_policy','index','kernel']}))


if __name__=='__main__':main()
