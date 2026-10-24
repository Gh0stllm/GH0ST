#!/usr/bin/env python3
"""Check four-source parsing, weights, and conversation leakage without training."""
import json,subprocess,sys,tempfile
from pathlib import Path
import numpy as np
from prepare_cache import prepare
from common import RESEARCH,Streams


def main():
    with tempfile.TemporaryDirectory(prefix='gh0st-teacher-test-') as directory:
        root=Path(directory);data=root/'data';data.mkdir()
        bodies=['a small bird found a key beside the door.',
                'the bright cloud brought a gentle wind across the sea.',
                'an old stone held a tiny light near the river.']
        kinds=['authored','compositional','public_domain','licensed_teacher']
        for index,split in enumerate(['train','validation','test']):
            rows=[]
            for k,kind in enumerate(kinds):
                rows.append({'id':f'{split}-{kind}','split':split,'source_kind':kind,
                             'family_id':f'{split}-{kind}','conversation_id':f'{split}-conversation',
                             'text':('"' if k==0 else '')+bodies[index]+f' i see {k+1} quiet stars.'+('"' if k==0 else '')})
            (data/f'{split}.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
        tokenizer=RESEARCH/'experiments/simplestories-v2/model-cache'
        first=prepare(data,root/'cache',tokenizer)
        assert first==prepare(data,root/'cache',tokenizer)
        streams=Streams(root/'cache');rng=np.random.default_rng(123)
        weights={'authored':.1,'compositional':.15,'public_domain':.15,'licensed_teacher':.6}
        counts=dict.fromkeys(kinds,0)
        for _ in range(500):
            batch=streams.batch('train',rng,16,weights=weights)
            for kind in batch[3]:counts[kind]+=1
            for i,quote in enumerate(batch[4]):
                assert (batch[1][i,:1 if quote else 64]==-100).all()
                if quote:assert int(batch[0][i,0])==3
        for kind,probability in weights.items():assert abs(counts[kind]/8000-probability)<.025
        assert all(1 not in values for values in streams.arrays.values())
        try:streams.batch('train',rng,1,weights={'authored':.4,'licensed_teacher':.4})
        except ValueError:pass
        else:raise AssertionError('Invalid mixture accepted')
        subprocess.run([sys.executable,str(Path(__file__).with_name('train_teacher.py')),
                        '--cache',str(root/'cache'),'--output',str(root/'one-step'),
                        '--max-steps','1','--target-tokens','1','--validation-blocks','16',
                        '--probe-tokens','16','--snapshot-every','1'],check=True,capture_output=True,text=True)
        smoke=json.loads((root/'one-step/training-report.json').read_text())
        assert smoke['status']=='COMPLETE' and smoke['completed_steps']==1 and smoke['trained_target_tokens']>0
        path=data/'validation.jsonl';rows=[json.loads(x) for x in path.read_text().splitlines()]
        rows[-1]['conversation_id']='train-conversation';path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        try:prepare(data,root/'leaked',tokenizer)
        except ValueError as error:assert 'Teacher conversation crosses splits' in str(error)
        else:raise AssertionError('Cross-split teacher conversation accepted')
    result={'status':'PASS','four_source_counts':counts,'requested_source_probabilities':weights,
            'cache_reuse':True,'quote_start_labels':True,'no_inserted_eos':True,
            'invalid_mixture_rejected':True,'teacher_conversation_overlap_rejected':True,
            'one_step_training_smoke':True}
    Path(__file__).with_name('pipeline-selftest.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':main()
