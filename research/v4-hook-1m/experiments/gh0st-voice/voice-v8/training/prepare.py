"""Fit bare words on training only; retain independent punctuation at every position."""
import argparse,collections,hashlib,json,re,unicodedata
from pathlib import Path
V,BOS,UNK=8192,8192,8193
PUNCT={',':1,';':1,':':1,'.':2,'!':3,'?':4}

def parse(text):
    text=unicodedata.normalize('NFKD',text).lower().replace('’',"'").replace('‘',"'")
    text=''.join(c if ord(c)<128 else '' if unicodedata.combining(c) else ' ' for c in text)
    words=[];punct=[]
    # Numeric spans remain one unknown input position; internal decimal/grouping
    # marks must never be attached as sentence punctuation to a preceding word.
    for token in re.findall(r"[a-z]+(?:'[a-z]+)*|[0-9]+(?:[.,][0-9]+)*|[,.!?;:]",text):
        if token in PUNCT:
            if words and PUNCT[token]>=punct[-1]:punct[-1]=PUNCT[token]
        else:words.append(token);punct.append(0)
    return words,punct

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')

def main():
    p=argparse.ArgumentParser();p.add_argument('--base',type=Path,required=True)
    p.add_argument('--expansion',type=Path,required=True);p.add_argument('--curriculum',type=Path)
    p.add_argument('--vocabulary',type=Path,help='Reuse a previously fitted training-only vocabulary without changing token IDs')
    p.add_argument('--out',type=Path,required=True);a=p.parse_args();assert not a.out.exists();a.out.mkdir(parents=True)
    rows={s:[] for s in ('train','validation','test')};sources={}
    for split in rows:
        path=a.base/f'{split}.jsonl';sources[str(path)]=sha(path)
        for line in path.open():
            row=json.loads(line);row['kind']='original' if row['source_kind']=='original_voice' else 'adult';rows[split].append(row)
    sources[str(a.expansion)]=sha(a.expansion)
    rows['train'] += [json.loads(line)|{'kind':'original'} for line in a.expansion.open()]
    if a.curriculum:
        for split in rows:
            path=a.curriculum/f'{split}.jsonl';sources[str(path)]=sha(path)
            rows[split]+=[json.loads(line)|{'kind':'curriculum'} for line in path.open()]
    frequencies=collections.Counter();voice=collections.Counter();groups={};hashes={};parsed={}
    for split,items in rows.items():
        parsed[split]=[]
        for row in items:
            words,punct=parse(row['text']);assert len(words)>1
            group=row['group_id'];assert group not in groups or groups[group]==split;groups[group]=split
            normal=' '.join(words);digest=hashlib.sha256(normal.encode()).hexdigest()
            assert digest not in hashes or hashes[digest]==split;hashes[digest]=split
            parsed[split].append((row,words,punct))
            if split=='train':
                eligible=[w for w in words if len(w)<=32 and re.fullmatch(r"[a-z]+(?:'[a-z]+)*",w)]
                frequencies.update(eligible)
                if row['kind']!='adult':voice.update(eligible)
    selected=[w for w,c in voice.most_common(3000) if c>=2];seen=set(selected)
    for w,_ in frequencies.most_common():
        if w not in seen:selected.append(w);seen.add(w)
        if len(selected)==V:break
    assert len(selected)==V
    selected.sort(key=lambda w:(-frequencies[w],w));index={w:i for i,w in enumerate(selected)}
    if a.vocabulary:
        selected=json.loads(a.vocabulary.read_text());assert len(set(selected))==V
        index={w:i for i,w in enumerate(selected)}
    write(a.out/'vocabulary.json',selected);(a.out/'vocabulary.bin').write_bytes(b''.join(w.encode().ljust(32,b'\0')for w in selected))
    counts={k:[0]*V for k in ('original','adult','curriculum')};stats={};artifacts={}
    for split,items in parsed.items():
        output=[];by_kind={}
        for row,words,punct in items:
            ids=[index.get(w,UNK)for w in words];kind=row['kind'];domain=int(kind=='adult')
            output.append(row|{'token_ids':ids,'punctuation':punct,'domain':domain})
            d=by_kind.setdefault(kind,{'documents':0,'words':0,'unknown_words':0,'terminal_targets':0,'punctuation_targets':0})
            d['documents']+=1;d['words']+=len(ids);d['unknown_words']+=sum(t==UNK for t in ids)
            d['terminal_targets']+=sum(p>=2 for p in punct);d['punctuation_targets']+=len(punct)
            if split=='train':
                for token in ids:
                    if token<V:counts[kind][token]+=1
        path=a.out/f'{split}.jsonl';path.write_text(''.join(json.dumps(r,ensure_ascii=True)+'\n'for r in output))
        artifacts[path.name]={'sha256':sha(path),'bytes':path.stat().st_size};stats[split]=by_kind
    write(a.out/'counts.json',counts)
    meta={'status':'FROZEN','vocabulary':V,'bos':BOS,'input_only_unk':UNK,'punctuation':['',',','.','!','?'],
          'all_punctuation_targets_retained':True,'word_and_punctuation_factorization':'P(word|h)*P(punctuation|h,word)',
          'word_mask':'Only unknown word targets masked; their punctuation and complete context remain.',
          'numeric_policy':'Preserve digit and decimal spans as unknown word positions; do not fit them to the alphabetical output vocabulary.',
          'statistics':stats,'source_sha256':sources,'artifacts':artifacts,'vocabulary_sha256':sha(a.out/'vocabulary.json'),
          'cross_split_group_overlap':0,'cross_split_lexical_duplicates':0,'parser_sha256':sha(Path(__file__))}
    if a.vocabulary:meta['reused_vocabulary_sha256']=sha(a.vocabulary)
    write(a.out/'manifest.json',meta);print(json.dumps(meta,indent=2))
if __name__=='__main__':main()
