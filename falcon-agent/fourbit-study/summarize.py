"""Reproduce the storage/quality comparison from measured local artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
from codec import CONFIGS
from local import creation_gas

ROOT=Path(__file__).resolve().parent


def main():
    p=argparse.ArgumentParser();p.add_argument('--exports',type=Path,required=True);a=p.parse_args()
    dev=json.loads((ROOT/'development-quality.json').read_text())
    refined=json.loads((ROOT/'refinement-quality.json').read_text())
    held=json.loads((ROOT/'heldout-quality.json').read_text())
    full=json.loads((ROOT/'full-results.json').read_text())
    plan=json.loads((ROOT/'deployment-plan.json').read_text())
    assert all(v['status']=='completed' for v in [dev,refined,held,full])
    rows=[]
    for name in list(CONFIGS)+['sym32_s8_feedback']:
        folder=a.exports/name
        m=json.loads((folder/'manifest.json').read_text());data=(folder/'weights.bin').read_bytes()
        assert hashlib.sha256(data).hexdigest()==m['sha256']
        q=next(v for v in (refined if name.endswith('_feedback') else dev)['variants'] if v['variant']==name)
        count=(len(data)+98302)//98303
        rows.append({'variant':name,'bytes':len(data),'sha256':m['sha256'],'weight_shards':count,
            'stage_contracts_including_old_pilot':count+4,
            'modeled_weight_deployment_gas':sum(creation_gas(data[i:i+98303]) for i in range(0,len(data),98303)),
            'development_next_token_agreement_percent':q['reference_argmax_agreement_percent'],
            'development_mean_token_kl':q['mean_reference_token_kl']})
    result={'status':'completed','selected':'affine64_s12z4','public_transactions_broadcast':0,
        'selection':'Development-set decision: affine64 is ~12% cheaper per representative tile than sym32 at the same file size, with mean KL within 5% of the lowest-drift four-bit candidate. Selection preceded held-out evaluation.',
        'feedback_rejected':'Regularized calibration loss fell, but development KL increased from 0.348750 to 0.370525; no feedback weights were selected.',
        'not_a_global_optimum':'Best measured compromise among these candidates; not a proof of maximal compression, speed, or preserved quality.',
        'variants':rows,'selected_full_matrix_gas':full['usage_gas'],
        'selected_new_stage_gas_local':plan['total_new_stage_gas_local'],
        'deployment_saving_vs_selected_sixbit_percent':100*(1-plan['total_new_stage_gas_local']/15649430315),
        'matrix_gas_saving_vs_selected_sixbit_percent':100*(1-full['usage_gas']/2965180104),
        'matrix_gas_saving_vs_prior_fastest_sixbit_percent':100*(1-full['usage_gas']/1187396568),
        'heldout':[{k:v[k] for k in ['variant','reference_positions','reference_argmax_agreement_percent','mean_reference_token_kl','first_token_agreements','full_generation_agreements','exact_format_passes']} for v in held['variants']],
        'limits':['No complete token-inference gas measurement','No live RH fee quote','Material weight-quantization drift','499 covers this stage including the old pilot, not the complete future system']}
    (ROOT/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
