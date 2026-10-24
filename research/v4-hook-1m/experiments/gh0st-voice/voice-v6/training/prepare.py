#!/usr/bin/env python3
"""Fit training-only 8K vocabulary; keep complete source context around UNKs."""
import argparse,collections,hashlib,json,re,unicodedata
from pathlib import Path
import numpy as np

V,BOS,UNK=8192,8192,8193
def tokens(text):
    text=unicodedata.normalize('NFKD',text).lower().replace('’',"'").replace('‘',"'")
    # Dropping a Unicode dash or separator would silently concatenate words.
    # Combining accent marks are removed; all other unsupported symbols delimit.
    text=''.join(c if ord(c)<128 else '' if unicodedata.combining(c) else ' ' for c in text)
    return re.findall(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?",text.encode('ascii','ignore').decode())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    assert not a.out.exists();a.out.mkdir(parents=True)
    rows={};freq=collections.Counter();voice=collections.Counter();groups={};hashes={}
    for split in ('train','validation','test'):
        rows[split]=[]
        for line in (a.source/f'{split}.jsonl').open():
            row=json.loads(line);seq=tokens(row['text']);group=row['group_id']
            assert group not in groups or groups[group]==split;groups[group]=split
            digest=hashlib.sha256(' '.join(seq).encode()).hexdigest()
            assert digest not in hashes or hashes[digest]==split;hashes[digest]=split
            domain=0 if row['source_kind']=='original_voice' else 1
            rows[split].append((row,seq,domain))
            if split=='train':
                freq.update(w for w in seq if len(w)<=32)
                if domain==0:voice.update(w for w in seq if len(w)<=32)
    # Reserve frequent target-style vocabulary, then fill by real overall use.
    chosen=[];seen=set()
    for word,count in voice.most_common(2000):
        if count>=2:chosen.append(word);seen.add(word)
    for word,_ in freq.most_common():
        if word not in seen:chosen.append(word);seen.add(word)
        if len(chosen)==V:break
    assert len(chosen)==V
    # Frequency bins are contiguous classes of 64; no test words enter fitting.
    chosen.sort(key=lambda w:(-freq[w],w));index={w:i for i,w in enumerate(chosen)}
    write(a.out/'vocabulary.json',chosen)
    (a.out/'vocabulary.bin').write_bytes(b''.join(w.encode().ljust(32,b'\0') for w in chosen))
    counts={str(d):np.zeros(V,dtype=np.int64) for d in (0,1)};stats={};artifacts={}
    for split,entries in rows.items():
        out=[];n=unknown=0;by_domain={str(d):{'words':0,'unknown':0,'documents':0} for d in (0,1)}
        for row,seq,domain in entries:
            ids=[index.get(w,UNK) for w in seq];n+=len(ids);u=sum(t==UNK for t in ids);unknown+=u
            by_domain[str(domain)]['words']+=len(ids);by_domain[str(domain)]['unknown']+=u;by_domain[str(domain)]['documents']+=1
            out.append(row|{'token_ids':ids,'domain':domain,'normalized_words':len(ids),'unknown_words':u})
            if split=='train':np.add.at(counts[str(domain)],[t for t in ids if t<V],1)
        path=a.out/f'{split}.jsonl';path.write_text(''.join(json.dumps(r,ensure_ascii=True)+'\n' for r in out))
        artifacts[path.name]={'sha256':sha(path),'bytes':path.stat().st_size}
        stats[split]={'documents':len(out),'words':n,'unknown_words':unknown,'known_target_fraction':1-unknown/n,'domains':by_domain}
    assert np.all(sum(counts.values())>0)
    write(a.out/'counts.json',{key:val.tolist() for key,val in counts.items()})
    report={'status':'COMPLETE','vocabulary':V,'bos_input':BOS,'unk_input_only':UNK,'runtime_output_ids':[0,V-1],
            'normalization':'NFKD lowercase; curly apostrophes normalized; combining accents stripped; unsupported Unicode symbols and separators delimit words. ASCII alphabetic words with internal apostrophe and optional final .!?; raw paragraphs separately preserved.',
            'vocabulary_fit':'Training only: up to2000 repeated target-voice types, then frequency. Classes are contiguous64 frequency ranks.',
            'unknown_policy':'Keep complete paragraph token positions; UNK input embedding; mask only unknown target losses; no runtime UNK output.',
            'domain0':'Original contemporary target-voice paragraphs','domain1':'Licensed adult first-person grammar corpus',
            'groups':len(groups),'cross_split_group_overlap':0,'cross_split_tokenized_duplicates':0,'statistics':stats,'artifacts':artifacts,
            'source_sha256':{s:sha(a.source/f'{s}.jsonl') for s in rows},'vocabulary_sha256':sha(a.out/'vocabulary.json')}
    write(a.out/'manifest.json',report);print(json.dumps(report,indent=2))
if __name__=='__main__':main()
