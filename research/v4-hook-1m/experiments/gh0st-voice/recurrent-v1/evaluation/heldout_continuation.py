#!/usr/bin/env python3
"""Continue two deterministic held-out authored prefixes without changing state."""
import argparse
import json
from pathlib import Path
from screen_checkpoint import Model, copy_matches, sha


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,required=True)
    p.add_argument('--data',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    assert not a.output.exists()
    a.output.mkdir(parents=True)
    documents=sorted([json.loads(line) for line in (a.data/'test.jsonl').open()
                      if line.strip()],key=lambda r:r['id'])
    documents=[r for r in documents if r['source_kind']=='authored' and len(r['text'].split())>=40][:2]
    assert len(documents)==2
    model=Model(a.checkpoint,a.data)
    rows=[]
    for doc in documents:
        prefix=' '.join(doc['text'].split()[:8])
        for temp in [512,768]:
            for seed in [0,42]:
                row=model.generate(seed,64,temp/1024,prefix)
                row['heldout_source']={'id':doc['id'],'group_id':doc['group_id'],
                                       'actual_continuation':' '.join(doc['text'].split()[8:])}
                rows.append(row)
    copy_matches(rows,a.data)
    report={'status':'REQUIRES_HUMAN_CONTINUITY_REVIEW','source':model.source,
            'test_sha256':sha(a.data/'test.jsonl'),'script_sha256':sha(Path(__file__)),
            'selection':'First two id-sorted authored test documents with at least40words; first8words supplied once.',
            'state_policy':'No hidden resets or forced punctuation. Prompt consumed only at initialization.',
            'outputs':rows}
    (a.output/'raw-outputs.json').write_text(json.dumps(report,indent=2)+'\n')
    (a.output/'raw-outputs.txt').write_text('\n\n'.join(
        f"{r['heldout_source']['id']} / seed {r['seed']} / temperature Q10 {r['temperature_q10']}\nPREFIX: {r['prompt']}\nMODEL: {r['text']}\nACTUAL HELDOUT: {r['heldout_source']['actual_continuation']}"
        for r in rows)+'\n')
    print(json.dumps({'path':str(a.output),'outputs':len(rows)}))


if __name__=='__main__':main()
