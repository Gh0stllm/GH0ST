"""Freeze licensed broad grammar replay plus explicitly weighted authored voice.

Source text is preserved verbatim. The existing parser creates model targets;
unknown lexical targets are masked by training, while their context/punctuation
remain. No model, GPU, external service or chain is called.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import shutil

HERE=Path(__file__).resolve().parent
VOICE=HERE.parent
spec=importlib.util.spec_from_file_location('original_nova_parser',VOICE/'voice-v8/training/prepare.py')
parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
V=8192;UNK=8193


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read_rows(path):return [json.loads(line)for line in Path(path).read_text().splitlines()]
def known(row):return sum(t<V for t in row['token_ids'])


def oversample(rows,target,rng,prefix):
    """Whole-source deterministic copies, keeping the nearest target total."""
    result=[];total=0;cycle=0
    while total<target:
        order=list(rows);rng.shuffle(order)
        for row in order:
            n=known(row)
            if total and total+n>target and abs(target-total)<=abs(target-total-n):
                return result,total
            result.append(dict(row,id=f'{prefix}:{row["id"]}:copy{cycle}',
                               source_id=row['id'],training_copy_index=cycle))
            total+=n
            if total>=target:return result,total
        cycle+=1
    return result,total


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',type=Path,default=HERE/'encoded-language')
    p.add_argument('--voice-fraction',type=float,default=.25)
    p.add_argument('--curriculum-fraction',type=float,default=.05)
    p.add_argument('--seed',type=int,default=741160)
    a=p.parse_args();assert not a.out.exists()
    assert 0<a.voice_fraction<1 and 0<=a.curriculum_fraction<1-a.voice_fraction
    grammar_root=VOICE/'large-v3/recovery-v5/grammar-replay'
    authored_root=HERE/'encoded-stage2';manifest=json.loads((grammar_root/'manifest.json').read_text())
    vb=(authored_root/'vocabulary.json').read_bytes();vocab=json.loads(vb)
    assert len(set(vocab))==V;index={w:i for i,w in enumerate(vocab)}
    result={};source_stats={};unknown=collections.defaultdict(collections.Counter)
    cross_groups={};cross_text={};source_hashes={}
    unique_authored=[];unique_curriculum=[]
    for split in ('train','validation','test'):
        grammar_file=grammar_root/f'{split}.jsonl';source_hashes[str(grammar_file.relative_to(VOICE))]=sha(grammar_file)
        assert sha(grammar_file)==manifest['outputs'][split]['sha256']
        grammar=[]
        for row in read_rows(grammar_file):
            words,punct=parser.parse(row['text']);tokens=[index.get(w,UNK)for w in words]
            assert row['source_license']=='MIT' and row['source_commit']==manifest['source_commit']
            grammar.append(dict(row,kind='grammar',domain=1,token_ids=tokens,punctuation=punct))
            unknown[f'{split}:grammar'].update(w for w,t in zip(words,tokens)if t==UNK)
        authored_file=authored_root/f'{split}.jsonl';source_hashes[str(authored_file.relative_to(VOICE))]=sha(authored_file)
        all_authored=read_rows(authored_file)
        authored=[dict(r,kind='original',domain=0)for r in all_authored
                  if r['kind']=='original' and ':oversample'not in r['id']]
        if split=='train':
            assert len(authored)==140
            unique_authored=authored
            unique_curriculum=[dict(r,kind='curriculum',domain=0)for r in all_authored
                               if r['kind']=='curriculum'and not r['id'].startswith('chain:')]
        for row in authored:
            words,punct=parser.parse(row['text'])
            assert [index.get(w,UNK)for w in words]==row['token_ids'] and punct==row['punctuation']
            unknown[f'{split}:original'].update(w for w,t in zip(words,row['token_ids'])if t==UNK)
        result[split]=grammar+authored
        source_stats[split]={'grammar':{'documents':len(grammar),'words':sum(len(r['token_ids'])for r in grammar),
                                      'known_targets':sum(map(known,grammar))},
                             'original':{'documents':len(authored),'words':sum(len(r['token_ids'])for r in authored),
                                         'known_targets':sum(map(known,authored))}}
        for row in result[split]:
            group=row['group_id'];norm=' '.join(parser.parse(row['text'])[0]);digest=hashlib.sha256(norm.encode()).hexdigest()
            assert group not in cross_groups or cross_groups[group]==split, ('group leak',group)
            assert digest not in cross_text or cross_text[digest]==split, ('text leak',row['id'])
            cross_groups[group]=split;cross_text[digest]=split
    grammar_train=[r for r in result['train']if r['kind']=='grammar']
    grammar_fraction=1-a.voice_fraction-a.curriculum_fraction
    effective_total=sum(map(known,grammar_train))/grammar_fraction
    rng=random.Random(a.seed)
    authored_train,authored_known=oversample(unique_authored,round(effective_total*a.voice_fraction),rng,'authored')
    curriculum_train,curriculum_known=oversample(unique_curriculum,round(effective_total*a.curriculum_fraction),rng,'curriculum')
    result['train']=grammar_train+authored_train+curriculum_train
    rng.shuffle(result['train'])
    a.out.mkdir(parents=True);(a.out/'vocabulary.json').write_bytes(vb)
    shutil.copyfile(authored_root/'vocabulary.bin',a.out/'vocabulary.bin')
    artifacts={};statistics={};counts={kind:[0]*V for kind in ('grammar','original','curriculum')}
    for split,rows in result.items():
        stats={}
        for row in rows:
            d=stats.setdefault(row['kind'],{'documents':0,'words':0,'known_targets':0,'unknown_words':0,
                                          'terminal_targets':0,'domain':row['domain']})
            n=len(row['token_ids']);k=known(row);d['documents']+=1;d['words']+=n
            d['known_targets']+=k;d['unknown_words']+=n-k;d['terminal_targets']+=sum(p>=2 for p in row['punctuation'])
            if split=='train':
                for t in row['token_ids']:
                    if t<V:counts[row['kind']][t]+=1
        total=sum(d['known_targets']for d in stats.values())
        for d in stats.values():
            d['target_fraction']=d['known_targets']/total;d['unknown_fraction']=d['unknown_words']/d['words']
        statistics[split]=stats
        filename=f'{split}.jsonl';file=a.out/filename
        file.write_text(''.join(json.dumps(r,ensure_ascii=True)+'\n'for r in rows))
        artifacts[filename]={'bytes':file.stat().st_size,'sha256':sha(file)}
        if split!='train':
            for kind in ('grammar','original'):
                part=a.out/f'{split}-{kind}.jsonl';part.write_text(''.join(json.dumps(r,ensure_ascii=True)+'\n'for r in rows if r['kind']==kind))
                artifacts[part.name]={'bytes':part.stat().st_size,'sha256':sha(part)}
    (a.out/'counts.json').write_text(json.dumps(counts)+'\n')
    license_dir=a.out/'licenses';license_dir.mkdir()
    shutil.copyfile(grammar_root/'raw/README-pinned.md',license_dir/'SimpleStories-README-pinned.md')
    provenance={'dataset':manifest['dataset'],'source_commit':manifest['source_commit'],
                'license':manifest['license'],'license_source':'Pinned upstream dataset card; no separate LICENSE file was present.',
                'card_sha256':sha(license_dir/'SimpleStories-README-pinned.md'),
                'source_manifest_sha256':sha(grammar_root/'manifest.json'),
                'source_manifest':manifest}
    (a.out/'SOURCES.json').write_text(json.dumps(provenance,indent=2)+'\n')
    out={'status':'FROZEN_LOCAL_LANGUAGE_REPLAY','source_text_preserved':True,
         'vocabulary_sha256':hashlib.sha256(vb).hexdigest(),'parser_sha256':sha(VOICE/'voice-v8/training/prepare.py'),
         'preparer_sha256':sha(Path(__file__)),'seed':a.seed,'source_sha256':source_hashes,
         'statistics':statistics,'unique_source_statistics':source_stats,
         'target_training_fractions':{'grammar':grammar_fraction,'original':a.voice_fraction,'curriculum':a.curriculum_fraction},
         'distinct_authored_training_documents':len(unique_authored),
         'distinct_curriculum_source_combinations':len(unique_curriculum),
         'curriculum_distinct_clauses':288,
         'oversampling':'Explicit whole-document copies; repeated rows are not independently authored stories.',
         'word_target_policy':'Only unknown lexical targets are masked. Unknown context and every punctuation target remain.',
         'domains':{'grammar':1,'original':0,'curriculum':0},
         'unknown_terms_unique_sources':{k:dict(v.most_common(100))for k,v in unknown.items()},
         'cross_split_group_overlap':0,'cross_split_normalized_text_overlap':0,
         'artifacts':artifacts,'mainnet_actions':0}
    (a.out/'manifest.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps({'status':out['status'],'statistics':statistics},indent=2))


if __name__=='__main__':main()
