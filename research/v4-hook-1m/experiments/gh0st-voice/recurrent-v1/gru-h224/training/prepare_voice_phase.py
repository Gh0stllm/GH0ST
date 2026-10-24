#!/usr/bin/env python3
"""Extend the frozen corpus with original prose, without fitting a new vocabulary."""
import argparse,collections,hashlib,json,re,shutil,unicodedata
from pathlib import Path
import numpy as np

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def words(text):
    text=unicodedata.normalize('NFKD',text).lower().replace('’',"'").replace('‘',"'")
    return re.findall(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?",text.encode('ascii','ignore').decode())
def spans(tokens,vocab):
    sentence=[];span=[]
    for token in tokens:
        sentence.append(token)
        if token.endswith(('.', '!', '?')):
            if all(word in vocab for word in sentence):span+=sentence
            elif span:yield span;span=[]
            sentence=[]
    if span:yield span

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',type=Path,required=True)
    p.add_argument('--extra',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    assert not a.output.exists(),'Output must be new'
    a.output.mkdir(parents=True)
    vocabulary=json.loads((a.base/'vocabulary.json').read_text())
    index={word:i for i,word in enumerate(vocabulary)}
    assert len(index)==8192
    records={s:[json.loads(line) for line in (a.base/f'{s}.jsonl').read_text().splitlines()] for s in ('train','validation','test')}
    exact={row['text']:split for split,rows in records.items() for row in rows}
    group_splits={row['group_id']:split for split,rows in records.items() for row in rows}
    stats=collections.Counter();additional=[]
    for line in a.extra.read_text().splitlines():
        row=json.loads(line);split=row['split'];tokens=words(row['text'])
        assert split in records
        group='original-b:'+row['group_id']
        assert group_splits.get(group,split)==split
        group_splits[group]=split
        stats[split+':input_words']+=len(tokens)
        stats[split+':unknown_words']+=sum(word not in index for word in tokens)
        for i,span in enumerate(spans(tokens,index)):
            if len(span)<5:continue
            text=' '.join(span)
            if text in exact:stats[split+':duplicate_spans']+=1;continue
            exact[text]=split
            item={'id':row['id']+f':span-{i}','split':split,'source_kind':'authored',
                  'group_id':group,'text':text,'token_ids':[index[word] for word in span],
                  'new_original':True,'retained_complete_sentence_span':len(span)!=len(tokens)}
            records[split].append(item);additional.append(item)
            stats[split+':retained_words']+=len(span);stats[split+':retained_spans']+=1
    counts={kind:np.zeros(8192,dtype=np.int64) for kind in ('authored','grammar','teacher')}
    for row in records['train']:np.add.at(counts[row['source_kind']],row['token_ids'],1)
    assert np.all(sum(counts.values())>0)
    for name in ('vocabulary.json','vocabulary.bin'):shutil.copyfile(a.base/name,a.output/name)
    write(a.output/'counts.json',{key:value.tolist() for key,value in counts.items()})
    artifacts={}
    for split,rows in records.items():
        path=a.output/f'{split}.jsonl'
        path.write_text(''.join(json.dumps(row)+'\n' for row in rows))
        artifacts[path.name]={'bytes':path.stat().st_size,'sha256':digest(path)}
    (a.output/'additional.jsonl').write_text(''.join(json.dumps(row)+'\n' for row in additional))
    report={'status':'COMPLETE','base_manifest_sha256':digest(a.base/'manifest.json'),
            'extra_sha256':digest(a.extra),'vocabulary_size':8192,'vocabulary_fit':'Unchanged base training vocabulary.',
            'retained_training_vocabulary_unseen':0,'extension_stats':dict(stats),'artifacts':artifacts,
            'group_overlap':False,'cross_split_exact_duplicates_retained':False,
            'limitations':['Whole in-vocabulary sentences only; excluded sentences are never joined across.',
                           'Authored prose is original training text, not a runtime lookup table.']}
    write(a.output/'manifest.json',report)
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
