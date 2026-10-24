#!/usr/bin/env python3
"""Independent paragraph/split/coverage audit. Never edits the source corpus."""
import argparse,collections,hashlib,heapq,importlib.util,json,re,unicodedata
from pathlib import Path

TOKEN=re.compile(r"[a-z]+(?:'[a-z]+)*(?:[.!?])?")


def words(text):
    text=unicodedata.normalize('NFKD',text).lower().replace('’',"'").replace('‘',"'")
    text=re.sub(r'[\u2010-\u2015\u2212]', ' ', text)
    text=re.sub(r'\s+', ' ', text)
    return TOKEN.findall(text.encode('ascii','ignore').decode())


def canonical(tokens):
    return [w.rstrip('.!?') for w in tokens]


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def spans(ws,n):return [tuple(ws[i:i+n]) for i in range(max(0,len(ws)-n+1))]


def main():
    global words
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,required=True)
    p.add_argument('--vocabulary',type=Path)
    p.add_argument('--normalizer',type=Path,help='Optional exact training prepare.py exposing tokens(text)')
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();a.output.mkdir(parents=True)
    if a.normalizer:
        spec=importlib.util.spec_from_file_location('frozen_v6_normalizer',a.normalizer)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);words=mod.tokens
    held=Path(__file__).with_name('heldout-cases.json');cases=json.loads(held.read_text())
    lookups=collections.defaultdict(set);prefixes={}
    for c in cases:
        full=c['prefix']+' '+c['reference_continuation']
        for sp in spans(canonical(words(full)),12):lookups[sp].add(c['id'])
        prefixes[tuple(canonical(words(c['prefix'])))]=c['id']
    pairs_path=Path(__file__).with_name('retention-pairs.json')
    if pairs_path.exists():
        for pair in json.loads(pairs_path.read_text()):
            for side in ['a','b']:
                prefixes[tuple(canonical(words(pair[f'prefix_{side}'])))]=pair['id']+':'+side
    vocab=None
    if a.vocabulary:
        raw=json.loads(a.vocabulary.read_text());vocab=set(raw if isinstance(raw,list) else raw.keys())
    group_owner={};exact_owner={};overlap=[];duplicate=[];eval_matches=[]
    counters=collections.defaultdict(collections.Counter);lengths=collections.defaultdict(list)
    sentence_counts=collections.Counter();sample=[];files=[];missing_groups=[]
    child={'boy','girl','princess','prince','fairy','dragon','kingdom','treasure','unicorn'}
    for split in ['train','validation','test']:
        path=a.data/f'{split}.jsonl';files.append({'path':str(path),'sha256':sha(path),'bytes':path.stat().st_size})
        for lineno,line in enumerate(path.open(),1):
            row=json.loads(line);text=row['text'];ws=words(text);norm=canonical(ws)
            kind=row.get('source_kind','unspecified');key=f'{split}:{kind}';count=counters[key]
            singular={'i','me','my','mine','myself',"i'm","i've","i'd","i'll"}
            first_person=singular|{'we','us','our','ours','ourselves',"we're","we've","we'd","we'll"}
            count.update(documents=1,words=len(ws),first_person_words=sum(w in first_person for w in norm),singular_first_person_words=sum(w in singular for w in norm),child_trope_words=sum(w in child for w in norm))
            if any(w in first_person for w in norm):count['documents_with_first_person']+=1
            if norm and norm[0] in {'i','my','we','our'}:count['first_person_starts']+=1
            if vocab is not None:
                known=sum(w in vocab for w in ws);count.update(known_targets=known,masked_unknown_targets=len(ws)-known)
            lengths[key].append(len(ws))
            rid=row.get('id',f'{split}:{lineno}')
            group=row.get('group_id',row.get('family_id',row.get('conversation_id')))
            if not group:
                if len(missing_groups)<20:missing_groups.append(rid)
            else:
                old=group_owner.setdefault(str(group),split)
                if old!=split and len(overlap)<100:overlap.append({'group':group,'splits':[old,split],'id':rid})
            h=hashlib.sha256(' '.join(norm).encode()).hexdigest()
            if h in exact_owner:
                if len(duplicate)<100:duplicate.append({'first':exact_owner[h],'next':[split,rid]})
            else:exact_owner[h]=(split,rid)
            hits=set()
            for sp in set(spans(norm,12))&lookups.keys():hits.update(lookups[sp])
            if hits and len(eval_matches)<100:eval_matches.append({'split':split,'id':rid,'cases':sorted(hits)})
            for pref,cid in prefixes.items():
                if len(pref)<=len(norm) and any(tuple(norm[i:i+len(pref)])==pref for i in range(len(norm)-len(pref)+1)):
                    if len(eval_matches)<100:eval_matches.append({'split':split,'id':rid,'case':cid,'type':'entire_prefix_match'})
            sent=[]
            for w in ws:
                sent.append(w.rstrip('.!?'))
                if w.endswith(('.', '!', '?')):
                    if len(sent)>=5:sentence_counts[' '.join(sent)]+=1
                    sent=[]
            # Deterministic hash selection, independent of file order or content score.
            priority=int.from_bytes(hashlib.sha256(f'{split}:{rid}'.encode()).digest(),'big')
            item=(-priority,split,rid,kind,text)
            if len(sample)<24:heapq.heappush(sample,item)
            elif priority < -sample[0][0]:heapq.heapreplace(sample,item)
    stats={}
    for key,c in counters.items():
        ls=sorted(lengths[key]);stats[key]={**dict(c),'word_length_min':min(ls),'word_length_median':ls[len(ls)//2],'word_length_max':max(ls),'unique_group_count_total_all_sources':len(group_owner)}
        if vocab is not None:stats[key]['known_target_fraction']=c['known_targets']/max(1,c['words'])
    coverage=[]
    for c in cases:
        ws=words(c['prefix']);unknown=[] if vocab is None else [{'position':i,'word':w} for i,w in enumerate(ws) if w not in vocab]
        coverage.append({'case':c['id'],'words':len(ws),'unknown_inputs':unknown,'fully_represented':not unknown if vocab is not None else None})
    result={'status':'AUDIT_COMPLETE_REQUIRES_MANUAL_SAMPLE_REVIEW','source_files':files,'script_sha256':sha(Path(__file__)),'heldout_sha256':sha(held),
            'normalization':'Exact supplied training tokens(text)' if a.normalizer else 'NFKD/lowercase/ASCII; Unicode dash/whitespace separated; letter words with apostrophes and optional attached terminal punctuation.',
            'normalizer_sha256':sha(a.normalizer) if a.normalizer else None,
            'statistics':stats,'group_overlap_examples':overlap,'missing_group_examples':missing_groups,'exact_duplicate_examples':duplicate,
            'evaluation_overlap_examples':eval_matches,'top_repeated_normalized_sentences':sentence_counts.most_common(30),
            'prefix_coverage':coverage,'vocabulary_sha256':sha(a.vocabulary) if a.vocabulary else None,
            'interpretation':'Child-trope or first-person counts are diagnostics, not an automatic judgment of prose quality. Exact evaluation overlap must be investigated before training.'}
    (a.output/'audit.json').write_text(json.dumps(result,indent=2)+'\n')
    rows=[{'split':s,'id':rid,'source_kind':k,'text':t} for _,s,rid,k,t in sorted(sample,reverse=True)]
    (a.output/'manual-sample.json').write_text(json.dumps(rows,indent=2)+'\n')
    (a.output/'manual-sample.txt').write_text('\n\n'.join(f"{r['split']} / {r['source_kind']} / {r['id']}\n{r['text']}" for r in rows)+'\n')
    print(json.dumps({'path':str(a.output),'groups_overlap':len(overlap),'evaluation_matches':len(eval_matches),'statistics':stats}))


if __name__=='__main__':main()
