"""Freeze authored first-person episodes with existing N0VA token identities."""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
VOICE=HERE.parent
spec=importlib.util.spec_from_file_location('v8_parse',VOICE/'voice-v8/training/prepare.py')
legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
sha=lambda b:hashlib.sha256(b).hexdigest()


def main():
    out=HERE/'encoded';assert not out.exists()
    out.mkdir()
    vb=(VOICE/'nova-fast-market/selected/vocabulary.json').read_bytes()
    vocabulary=json.loads(vb);index={w:i for i,w in enumerate(vocabulary)}
    assert len(index)==8192
    (out/'vocabulary.json').write_bytes(vb)
    (out/'vocabulary.bin').write_bytes(b''.join(w.encode().ljust(32,b'\0')for w in vocabulary))
    counts=[0]*8192;groups={};digests={};statistics={};sources={};artifacts={}
    for split in ('train','validation','test'):
        rows=[];unknown=collections.Counter();known=0;total=0
        for prefix,root in [('v10',HERE/'data'),('authored-v8',VOICE/'voice-v8/data/authored-continuity/style')]:
            path=root/(split+'.jsonl');raw=path.read_bytes();sources[str(path.relative_to(VOICE))]=sha(raw)
            for line in raw.decode().splitlines():
                source=json.loads(line);words,punct=legacy.parse(source['text'])
                digest=sha(' '.join(words).encode());assert digest not in digests
                digests[digest]=split
                family=prefix+':'+source.get('family',source.get('group_id','ungrouped'))
                assert family not in groups or groups[family]==split
                groups[family]=split
                tokens=[index.get(w,8193)for w in words]
                assert len(tokens)>1
                for w,t in zip(words,tokens):
                    total+=1
                    if t==8193:unknown[w]+=1
                    else:
                        known+=1
                        if split=='train':counts[t]+=1
                rows.append({'id':prefix+':'+source['id'],'group_id':family,'text':source['text'],
                             'kind':'original','domain':0,'token_ids':tokens,'punctuation':punct})
        authored_count=len(rows)
        # Train continuation beyond an episode ending, without changing words.
        # Only join whole authored episodes from the same training family.
        if split=='train':
            families=collections.defaultdict(list)
            for row in rows:families[row['group_id']].append(row)
            chains=[]
            for family,items in families.items():
                if len(items)<2:continue
                for i,row in enumerate(items):
                    nxt=items[(i+1)%len(items)]
                    chains.append({'id':'chain:'+row['id']+':'+nxt['id'],'group_id':family,
                                   'text':row['text']+' '+nxt['text'],'kind':'original','domain':0,
                                   'token_ids':row['token_ids']+nxt['token_ids'],
                                   'punctuation':row['punctuation']+nxt['punctuation'],
                                   'source_ids':[row['id'],nxt['id']]})
            rows+=chains
        raw=''.join(json.dumps(r,ensure_ascii=True)+'\n'for r in rows).encode()
        (out/(split+'.jsonl')).write_bytes(raw)
        artifacts[split+'.jsonl']={'bytes':len(raw),'sha256':sha(raw)}
        statistics[split]={'documents':len(rows),'independently_authored_documents':authored_count,
                           'words_in_authored_documents':total,'training_rows_include_same_family_pairs':split=='train',
                           'effective_words':sum(len(r['token_ids'])for r in rows),'known_words':known,
                           'oov_rate':1-known/total,'unknown_words':dict(unknown.most_common())}
    (out/'counts.json').write_text(json.dumps({'original':counts})+'\n')
    manifest={'status':'FROZEN_AUTHORED_VOICE_ONLY','vocabulary_sha256':sha(vb),
              'source_sha256':sources,'artifacts':artifacts,'statistics':statistics,
              'kind':'original','domain':0,'new_vocabulary_fitted':False,
              'cross_split_family_overlap':0,'duplicate_normalized_documents':0,
              'punctuation':'Neural targets at every position, including unknown words',
              'public_chain_actions':0,'parser_sha256':sha((VOICE/'voice-v8/training/prepare.py').read_bytes())}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({s:{k:v for k,v in row.items()if k!='unknown_words'}for s,row in statistics.items()},indent=2))


if __name__=='__main__':main()
