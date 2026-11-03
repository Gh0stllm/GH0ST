"""Recalculate the report from committed local measurements; no network access."""
from collections import Counter
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def load(name):return json.loads((ROOT/name).read_text())
def summarize(rows):
    totals=Counter()
    for expected,answer in rows:
        assert expected in ('yes','no','unknown') and answer in ('yes','no','unknown')
        totals['n']+=1;totals['correct']+=expected==answer;totals['abstained']+=answer=='unknown'
        if expected=='yes':
            totals['positives']+=1;totals['true_positive']+=answer=='yes'
        if expected=='no':
            totals['negatives']+=1;totals['false_positive']+=answer=='yes'
    return dict(totals)
def main():
    res={};labels={'A':'yes','B':'no','U':'unknown'}
    for filename in ['audit-improvement-results.json','audit-short-results.json']:
        runs=load(filename)['runs']
        for variant in sorted({r['variant'] for r in runs}):
            group=[r for r in runs if r['variant']==variant];assert len(group)==25
            res[variant]=summarize((labels[r['expected']],labels.get(r['output'],r['output'])) for r in group)
    for fmt,filename in [('raw','audit-evidence-results.json'),('facts','audit-facts-results.json')]:
        rows=load(filename)['runs']
        for missing in (False,True):
            sel=[r for r in rows if r['missing']==missing];assert len(sel)==(6 if missing else 25)
            res[fmt+('_missing' if missing else '')]=summarize((r['expected'],r['answer']) for r in sel)
    witness=load('audit-evm-witnesses.json')['runs']
    assert len({r['id'] for r in witness})==25
    baseline=load('audit-costs.json');usd=baseline['usd_per_trillion_cycles_planning_assumption'];idle=baseline['idle_30_days_cycles'];setup=baseline['setup_cycles_including_allowance']
    samples={}
    for task in ('short','trace'):
        for case in ('mint_vulnerable','mint_fixed'):
            d=load(f'audit-icp-{task}-{case}.json');calls=d['calls']
            assert [c['method'] for c in calls]==['set_max_tokens','new_chat','run_update_full']
            assert all(c['error'] is None for c in calls)
            r=calls[-1]['result'];assert r['status_code']==200 and not r['error'] and r['partial']==[False] and r['n_prompt_tokens_cached']==[0]
            cycles=sum(c['cycles_delta'] for c in calls);base=baseline['complete_synthetic_job']['cycles']
            answer=r['output'].strip();allowed={'A','B','U'} if task=='short' else {'yes','no','unknown'}
            expected=({'mint_vulnerable':'A','mint_fixed':'B'} if task=='short' else {'mint_vulnerable':'yes','mint_fixed':'no'})[case]
            samples[task+'_'+case]=dict(exact_format_valid=answer in allowed,expected=expected,correct_within_task=answer==expected,input=sum(r['n_prompt_tokens_decoded']),output_tokens=sum(r['n_tokens_generated']),answer=r['output'].strip(),cycles=cycles,usd=cycles/1e12*usd,seconds=sum(c['elapsed_seconds'] for c in calls),reduction_vs_prior_open_mint=1-cycles/base)
    mean=sum(k['cycles'] for s,k in samples.items() if s.startswith('trace_'))/2
    scenarios=[]
    for requests in (0,10,100):
        steady=(idle+requests*mean)/1e12*usd
        scenarios.append({'incoming':100,'model_calls':requests,'assumed_skipped':100-requests,'steady_state_engine_usd':steady,'first_month_with_setup_allowance_usd':steady+setup/1e12*usd})
    report={'quality':res,'witness_reproduced':sum(r['witness'] for r in witness),'witness_controls_reproduced':sum(r['witness'] for r in witness if r['expected']=='B'),
            'local_icp':samples,'usd_per_trillion_assumption':usd,'idle_cycles_30d_reference':idle,'setup_cycles_reference':setup,'monthly_scenarios':scenarios,
            'scope':'Two mint fixtures per bounded workload, fresh prompt caches. 30-day projections average the two trace jobs, assume 100 incoming events, one warm canister and no retries. Cycle deltas include elapsed idle so adding full-month idle is slightly conservative. Excludes scanner, data, RPC, storage outside the canister, human review and production overhead.'}
    (ROOT/'audit-improvement-summary.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()
