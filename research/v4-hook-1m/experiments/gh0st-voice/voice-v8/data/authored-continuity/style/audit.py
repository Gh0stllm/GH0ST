#!/usr/bin/env python3
"""Audit only the newly authored continuity corpus; no model or network use."""
from pathlib import Path
from collections import Counter,defaultdict
import hashlib,json,re,statistics

HERE=Path(__file__).resolve().parent
SPLITS=('train','validation','test')
WORDS=re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
FORBIDDEN=re.compile(r'\b(?:keys?|mugs?|notebooks?|birds?|frogs?)\b',re.I)

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def words(text):return WORDS.findall(text.lower())

def main():
    plan=json.loads((HERE/'family-plan.json').read_text())
    all_rows=[];stats={};seen={};groups={};grams=defaultdict(set);sentence_lengths=[];sentence_counts=[]
    vocabulary_path=HERE.parents[3]/'voice-v7/training/encoded-curriculum/vocabulary.json'
    vocabulary=set(json.loads(vocabulary_path.read_text()))if vocabulary_path.exists()else None
    for split in SPLITS:
        file=HERE/f'{split}.jsonl';rows=[json.loads(line)for line in file.read_text().splitlines()]
        counts=[];unknown=0;ids=set()
        for row in rows:
            assert set(row)=={'id','group_id','text','split','source_kind'}
            assert row['split']==split and row['source_kind']=='assistant_authored_continuity'
            assert row['id']not in ids;ids.add(row['id'])
            family=row['group_id'].split(':',1)[1]
            assert family in plan[split]
            assert row['group_id']not in groups or groups[row['group_id']]==split
            groups[row['group_id']]=split
            assert not FORBIDDEN.search(row['text']),row['id']
            tokens=words(row['text']);count=len(tokens);assert 240<=count<=360
            sentences=[s.strip()for s in re.split(r'[.!?]+',row['text'])if s.strip()]
            assert 18<=len(sentences)<=28
            norm=' '.join(tokens);assert norm not in seen;seen[norm]=row['id']
            counts.append(count);sentence_counts.append(len(sentences));sentence_lengths.extend(len(words(s))for s in sentences)
            if vocabulary is not None:unknown+=sum(token not in vocabulary for token in tokens)
            for i in range(len(tokens)-11):grams[tuple(tokens[i:i+12])].add(row['id'])
        all_rows.extend(rows)
        stats[split]={'episodes':len(rows),'words':sum(counts),'min_words':min(counts),'max_words':max(counts),
            'families':sorted({r['group_id']for r in rows}),'sha256':sha(file),'bytes':file.stat().st_size}
        if vocabulary is not None:stats[split]['frozen_vocabulary_coverage']={'unknown_words':unknown,'known_fraction':1-unknown/sum(counts)}
    assert [stats[s]['episodes']for s in SPLITS]==[18,3,3]
    review=json.loads((HERE/'self-review.json').read_text())
    assert {r['id']for r in review['episodes']}=={r['id']for r in all_rows}
    report={'status':'PASS_STRUCTURAL_AND_AUTHOR_SELF_REVIEW_NOT_MODEL_EVALUATION',
        'provenance':'24individually assistant-authored original episodes; not human-authored, no templates or combinatorial expansion',
        'splits':stats,'total_episodes':len(all_rows),'total_words':sum(s['words']for s in stats.values()),
        'sentence_counts':dict(Counter(sentence_counts)),'sentence_lengths':{'min':min(sentence_lengths),'max':max(sentence_lengths),
            'mean':statistics.mean(sentence_lengths),'within8to16':sum(8<=n<=16 for n in sentence_lengths),'total':len(sentence_lengths)},
        'cross_split_group_overlap':0,'exact_normalized_episode_duplicates':0,
        'shared12word_sequences_across_episodes':sum(len(owners)>1 for owners in grams.values()),
        'excluded_entity_matches':0,'family_plan_sha256':sha(HERE/'family-plan.json'),
        'self_review_sha256':sha(HERE/'self-review.json'),'audit_source_sha256':sha(Path(__file__)),
        'runtime_use':'Training text only; no runtime grammar repair, sentence bank, or forced continuations',
        'model_training_started':False,'gpu_calls':0,'network_calls':0,
        'limitations':['Assistant self-review is not independent human annotation.','Only24original plots; repetition and long-run model generalization require independent evaluation.','Validation/test themes are reserved and must not be mixed into training.']}
    if vocabulary is not None:report['coverage_vocabulary_sha256']=sha(vocabulary_path)
    (HERE/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k]for k in ('status','total_episodes','total_words','sentence_lengths','shared12word_sequences_across_episodes')},indent=2))

if __name__=='__main__':main()
