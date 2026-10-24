"""Voice-focused consolidation after the short grammar curriculum."""
import collections
import hashlib
import json
from pathlib import Path
import random

HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    src=HERE/'encoded-stage2';out=HERE/'encoded-stage3';assert not out.exists();out.mkdir()
    rows=[json.loads(x)for x in (src/'train.jsonl').read_text().splitlines()]
    originals=[r for r in rows if r['kind']=='original' and ':oversample' not in r['id']]
    assert len(originals)==140
    curricula=[r for r in rows if r['kind']=='curriculum' and not r['id'].startswith('chain:')]
    chosen=random.Random(741130).sample(curricula,2000)
    train=list(chosen)
    for copy in range(40):
        train.extend(dict(r,id=r['id']+f':voice{copy}')for r in originals)
    groups=collections.defaultdict(list)
    for r in originals:groups[r['group_id']].append(r)
    for family,items in groups.items():
        for i,a in enumerate(items):
            if len(items)<2:continue
            b=items[(i+1)%len(items)]
            for copy in range(10):
                train.append({'id':f'voice-chain:{a["id"]}:{b["id"]}:{copy}',
                              'group_id':family,'text':a['text']+' '+b['text'],
                              'token_ids':a['token_ids']+b['token_ids'],
                              'punctuation':a['punctuation']+b['punctuation'],
                              'kind':'original','domain':0})
    counts=[0]*8192
    for r in train:
        for t in r['token_ids']:
            if t<8192:counts[t]+=1
    report={'scope':'LOCAL_ONLY','distinct_authored_training_documents':140,
            'grammar_replay_combinations':2000,'authored_single_repeats':40,'authored_chain_repeats':10,
            'not_independently_authored_training_rows':True,'splits':{},'source_manifest_sha256':sha((src/'manifest.json').read_bytes())}
    for split in ('train','validation','test'):
        raw=''.join(json.dumps(r)+'\n'for r in train).encode()if split=='train'else(src/(split+'.jsonl')).read_bytes()
        (out/(split+'.jsonl')).write_bytes(raw)
        parsed=[json.loads(x)for x in raw.decode().splitlines()]
        report['splits'][split]={'rows':len(parsed),'words':sum(len(r['token_ids'])for r in parsed),'sha256':sha(raw)}
    for f in ('vocabulary.json','vocabulary.bin'):(out/f).write_bytes((src/f).read_bytes())
    (out/'counts.json').write_text(json.dumps({'original':counts})+'\n')
    (out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
