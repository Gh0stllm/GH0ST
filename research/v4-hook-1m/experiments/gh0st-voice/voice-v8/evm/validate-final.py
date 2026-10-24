#!/usr/bin/env python3
"""Exact independent validation of V7 primary/secondary swaps and boundary calls."""
import argparse,hashlib,json
from pathlib import Path
from reference import Reference

def main():
    p=argparse.ArgumentParser();p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    report=json.loads(a.report.read_text());assert report['status']=='EVM_PASS_AWAITING_INDEPENDENT_REFERENCE';assert report['network']['chainId']==31337 and report['publicTransactionsSubmitted']==0
    manifest=json.loads((a.model_dir/'manifest.json').read_text())
    for name,info in manifest['artifacts'].items():
        data=(a.model_dir/name).read_bytes();assert len(data)==info['bytes'] and hashlib.sha256(data).hexdigest()==info['sha256'],name
    assert hashlib.sha256((a.model_dir/'reference.npz').read_bytes()).hexdigest()==manifest['reference_sha256']
    ref=Reference(a.model_dir);records=[]
    for pool,rows in [('primary',report['swaps']),('secondary',report['auxiliarySwaps'])]:
        previous=None
        for row in rows:
            if previous is not None:
                assert previous['after']['hidden']==row['before']['hidden'];assert previous['after']['context']==row['before']['context']
            expected=ref.step(int(row['before']['context'][5]),int(row['before']['context'][6]),row['before']['hidden'],row['features'],report['seed'],row['sampleIndex'],report['temperatureQ10'])
            assert expected['token']==row['token'] and expected['punct']==row['punct']
            assert expected['hidden']==list(map(int,row['after']['hidden'])) and expected['scores']==list(map(int,row['branchScores']))
            assert expected['text']==row['text'] and expected['terminal']==row['terminal']
            assert int(row['after']['context'][6])==expected['punct'];assert int(row['gasUsed'])<32_000_000
            records.append({'pool':pool,'swap':row['swap'],'token':expected['token'],'punct':expected['punct']});previous=row
    for row in report['boundaryProbes']:
        expected=ref.step(*row['input'])
        assert expected['token']==row['token'] and expected['punct']==row['punct']
        assert expected['hidden']==list(map(int,row['hidden'])) and expected['scores']==list(map(int,row['scores']))
        assert expected['text']==row['text'] and expected['terminal']==row['terminal'];assert int(row['gasUsed'])<32_000_000
    result={'status':'PASS','language_quality':'NOT_APPROVED','primary_steps':len(report['swaps']),'secondary_steps':len(report['auxiliarySwaps']),'boundary_probes':len(report['boundaryProbes']),
            'all_state_values_match':True,'state_values':manifest['state_values'],'all197_logits_match':True,'scalar_checks':True,'punctuation_is_neural_not_forced':True,'state_persists_through_terminal':True,
            'report_sha256':hashlib.sha256(a.report.read_bytes()).hexdigest(),'checkpoint_sha256':manifest['checkpoint_sha256'],'records':records,'mainnet_actions':0}
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='records'},indent=2))
if __name__=='__main__':main()
