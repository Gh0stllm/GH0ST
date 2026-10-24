#!/usr/bin/env python3
"""Frozen quick-gate baseline from the previous selected H224 checkpoint."""
import argparse,hashlib,json,sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
PREVIOUS=HERE.parents[1]/'recurrent-v1'
sys.path.insert(0,str(PREVIOUS/'evaluation'))
from screen_gru import GRUModel
from screen_checkpoint import copy_matches,sha


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    checkpoint=PREVIOUS/'gru-h224/training/runs/voice-v3-1m/checkpoint-08253456'
    data=PREVIOUS/'training/data-v3';model=GRUModel(checkpoint,data)
    cases={x['id']:x for x in json.loads((HERE/'heldout-cases.json').read_text())}
    rows=[]
    for seed in [0,42]:
        row=model.generate(seed,128,.25);row['case']='unprompted';rows.append(row)
    for key in ['v6-h01','v6-h04','v6-h07','v6-h10']:
        row=model.generate(42,96,.25,cases[key]['prefix']);row['case']=key;rows.append(row)
    copy_matches(rows,data)
    result={'status':'FROZEN_BASELINE_REQUIRES_HUMAN_REVIEW','source':model.source,
            'script_sha256':sha(Path(__file__)),'cases_sha256':sha(HERE/'heldout-cases.json'),
            'method':'Previous model, unchanged T256 branch sampler/Keccak draws. Prefix once; no punctuation reset or forced completion.',
            'training_copy_scope':'Previous data-v3 retained training split only.','outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(f"{r['case']} / seed {r['seed']} / prefix {r['prompt']!r}\n{r['text']}" for r in rows)+'\n')
    print(json.dumps({'output':str(a.output),'streams':len(rows)}))


if __name__=='__main__':main()
