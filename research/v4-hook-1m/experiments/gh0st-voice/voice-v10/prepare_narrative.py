"""Prepare attributed public-domain first-person prose for local training.

Books are data, never instructions. Whole paragraph groups stay within one
split. Oversampling changes training frequency, not the source wording.
"""
import argparse,collections,hashlib,importlib.util,json,re,subprocess
from pathlib import Path

HERE=Path(__file__).resolve().parent
BOOKS={201:'Flatland',1260:'Jane Eyre',600:'Notes from the Underground',1952:'The Yellow Wallpaper'}
sha=lambda data:hashlib.sha256(data).hexdigest()
spec=importlib.util.spec_from_file_location('parse',HERE.parent/'voice-v8/training/prepare.py')
parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--download',action='store_true');a=ap.parse_args()
    root=HERE/'narrative';rawdir=root/'sources';rawdir.mkdir(parents=True,exist_ok=True)
    out=HERE/'encoded-narrative'
    if out.exists():
        assert not any(p.name not in ('vocabulary.json','vocabulary.bin')for p in out.iterdir()), 'Prepared output exists'
    else:out.mkdir()
    vocabulary=(HERE/'encoded/vocabulary.json').read_bytes();vocab=json.loads(vocabulary);index={w:i for i,w in enumerate(vocab)}
    for f in ('vocabulary.json','vocabulary.bin'):(out/f).write_bytes((HERE/'encoded'/f).read_bytes())
    rows={s:[]for s in ('train','validation','test')};sources={};skipped=collections.Counter()
    for ident,title in BOOKS.items():
        path=rawdir/f'pg{ident}.txt';url=f'https://www.gutenberg.org/cache/epub/{ident}/pg{ident}.txt'
        if not path.exists():
            assert a.download, 'Download explicitly with --download'
            subprocess.run(['/usr/bin/curl','--fail','--location','--max-time','60',
                            '--silent','--show-error','--output',str(path),url],check=True)
        raw=path.read_bytes();text=raw.decode('utf-8-sig')
        start=re.search(r'\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*',text)
        end=re.search(r'\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK',text)
        assert start and end and start.end()<end.start(),ident
        body=text[start.end():end.start()]
        paragraphs=[' '.join(p.split())for p in re.split(r'\n\s*\n',body)]
        sources[str(ident)]={'title':title,'catalog':f'https://www.gutenberg.org/ebooks/{ident}',
                             'url':url,'sha256':sha(raw),'bytes':len(raw),
                             'rights':'Project Gutenberg catalog: public domain in the USA. Original license retained in source file.'}
        for block in range(0,len(paragraphs),8):
            group=f'gutenberg-{ident}-paragraphs-{block}-{block+7}'
            bucket=int(sha(group.encode())[:8],16)%10
            split='train'if bucket<8 else 'validation'if bucket==8 else'test'
            batch=[];size=0
            def flush():
                nonlocal batch,size
                if not batch:return
                content=' '.join(batch);words,punct=parser.parse(content)
                if len(words)>=32 and sum(w in {'i','my','me','myself'}for w in words)>=2:
                    rows[split].append({'id':group+f'-{len(rows[split])}','group_id':group,'text':content,
                                        'token_ids':[index.get(w,8193)for w in words],'punctuation':punct,
                                        'domain':0,'kind':'narrative','source_book':ident})
                else:skipped['short_or_not_first_person']+=1
                batch=[];size=0
            for paragraph in paragraphs[block:block+8]:
                words,_=parser.parse(paragraph)
                if len(words)>256:flush();skipped['paragraph_over_256_words']+=1;continue
                if len(words)<12:continue
                if size+len(words)>256:flush()
                batch.append(paragraph);size+=len(words)
            flush()
    raw_rows={s:list(rs)for s,rs in rows.items()}
    grammar={};original={}
    for split in rows:
        entries=[json.loads(x)for x in (HERE/'encoded-language'/f'{split}.jsonl').read_text().splitlines()]
        grammar[split]=[r for r in entries if r['kind']=='grammar']
        unique={}
        for r in entries:
            if r['kind']=='original':unique.setdefault(tuple(r['token_ids']),r)
        original[split]=list(unique.values())
    train_grammar_words=sum(sum(t<8192 for t in r['token_ids'])for r in grammar['train'])
    target_total=train_grammar_words/.30
    for kind,documents,fraction in [('narrative',raw_rows['train'],.50),('original',original['train'],.20)]:
        required=target_total*fraction
        total=0;expanded=[];i=0
        while total<required:
            r=documents[i%len(documents)];expanded.append(dict(r,id=r['id']+f':repeat{i//len(documents)}'))
            total+=sum(t<8192 for t in r['token_ids']);i+=1
        if kind=='narrative':rows['train']=expanded
        else:rows['train']+=expanded
    rows['train']+=grammar['train']
    for split in ('validation','test'):rows[split]+=original[split]
    counts=[0]*8192;artifacts={};stats={}
    for split,items in rows.items():
        data=''.join(json.dumps(r,ensure_ascii=True)+'\n'for r in items).encode()
        (out/(split+'.jsonl')).write_bytes(data);artifacts[split+'.jsonl']={'sha256':sha(data),'bytes':len(data)}
        kinds=collections.defaultdict(lambda:{'documents':0,'words':0,'known_words':0})
        for r in items:
            k=kinds[r['kind']];k['documents']+=1;k['words']+=len(r['token_ids']);k['known_words']+=sum(t<8192 for t in r['token_ids'])
            if split=='train':
                for t in r['token_ids']:
                    if t<8192:counts[t]+=1
        stats[split]=dict(kinds)
    (out/'counts.json').write_text(json.dumps({'all':counts})+'\n')
    manifest={'scope':'LOCAL_ONLY_FIRST_PERSON_NARRATIVE_TRAINING','sources':sources,'artifacts':artifacts,
              'vocabulary_sha256':sha(vocabulary),'statistics':stats,'skipped':dict(skipped),
              'source_narrative_documents':{s:len(rs)for s,rs in raw_rows.items()},
              'training_known_target_mix':{'narrative':.5,'grammar':.3,'original':.2},
              'overlap_policy':'Disjoint contiguous groups of eight source paragraphs; no source paragraph crosses splits.',
              'limits':'Same books occur across splits; this tests held-out passages, not unseen authors. Repeated training rows are frequency weights.',
              'mainnet_actions':0}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (root/'SOURCES.json').write_text(json.dumps(sources,indent=2)+'\n')
    print(json.dumps({'narrative_documents':manifest['source_narrative_documents'],'statistics':stats,'skipped':dict(skipped)}))


if __name__=='__main__':main()
