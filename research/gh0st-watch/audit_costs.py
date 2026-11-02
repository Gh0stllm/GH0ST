"""Recompute bounded model-engine costs from LOCAL ICP evidence. Not a mainnet quote."""
import json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def read(name): return json.loads((ROOT/name).read_text())
def main():
    usd=1.40; t=1e12
    probe=read('audit-icp-2b.json'); audit=read('audit-icp-2b-contract.json'); status=read('audit-icp-2b-status.json')
    complete=next(c for c in audit['calls'] if c['method']=='run_update_full')
    assert complete['result']['generated_eog'] and complete['result']['partial']==[False]
    job=sum(c['cycles_delta'] for c in audit['calls'])
    idle=int(status['idle_cycles_burned_per_day'].replace('_',''))*30
    memory=int(status['memory_size'].replace('_',''))
    # Reconcile actual replica idle report against the matching public IC source fees.
    formula_idle=(memory/(1024**3)*317500+10000)*86400*30
    assert abs(formula_idle-idle)<100
    load=next(c['cycles_delta'] for c in probe['calls'] if c['method']=='load_model')
    setup=500_000_000_000+probe['upload']['cycles_delta']+load+100_000_000_000
    result={'scope':'model engine only; local metering projected to USD, not a mainnet invoice or security-service price','usd_per_trillion_cycles_planning_assumption':usd,'mainnet_verified':False,'storage_pricing_discrepancy':'Public docs list 127000 cycles/GiB-second. Tested local replica and cited IC source match 317500 plus 10000 base cycles/second. Use reported idle rate; verify target subnet before funding.','memory_bytes':memory,'idle_30_days_cycles':idle,'idle_30_days_usd':idle/t*usd,'setup_cycles_including_allowance':setup,'setup_usd_including_allowance':setup/t*usd,'setup_components_cycles':{'creation_published_fee':500_000_000_000,'upload_local_delta':probe['upload']['cycles_delta'],'load_local_delta':load,'installation_and_other_setup_allowance_not_measured':100_000_000_000},'complete_synthetic_job':{'input_tokens':complete['result']['n_prompt_tokens_decoded'][0],'output_tokens':complete['result']['n_tokens_generated'][0],'cycles':job,'usd':job/t*usd,'seconds':sum(c['elapsed_seconds'] for c in audit['calls']),'output_is_correct_audit':False},'single_token_probe':{},'monthly_same_job_scenarios':[],'larger_workload_projections':[],'excluded_unpriced':['source retrieval and RPC','scanner/fuzzer hosting and engineering','production coordinator calls','human confirmation','target-subnet storage reservations/funding requirements']}
    for field in ['n_prompt_tokens_decoded','n_tokens_generated']:
        rows=[c for c in probe['calls'] if c['method']=='run_update' and c.get('result') and c['result']['Ok'][field] and c['result']['Ok'][field][0]>0]
        result['single_token_probe'][field]={'tokens':sum(c['result']['Ok'][field][0] for c in rows),'mean_cycles':statistics.mean(c['cycles_delta'] for c in rows),'min_cycles':min(c['cycles_delta'] for c in rows),'max_cycles':max(c['cycles_delta'] for c in rows)}
    for count in [10,100,1000]:
        steady=idle+job*count
        result['monthly_same_job_scenarios'].append({'jobs':count,'steady_state_cycles':steady,'steady_state_usd':steady/t*usd,'first_month_with_setup_usd':(steady+setup)/t*usd,'first_month_with_setup_and_20pct_job_retry_allowance_usd':(idle+job*count*1.2+setup)/t*usd})
    for ins,outs,passes in [(256,64,1),(1024,256,1),(1024,256,3)]:
        # Rounded single-token rates. Not a measured large-context/batching result.
        cycles=(ins*8_000_000_000+outs*8_050_000_000)*passes
        result['larger_workload_projections'].append({'input_tokens_per_pass':ins,'output_tokens_per_pass':outs,'passes':passes,'cycles':cycles,'usd':cycles/t*usd,'scope':'linear projection from short one-token updates; excludes idle/setup/external costs; context-dependent and unvalidated'})
    (ROOT/'audit-costs.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
