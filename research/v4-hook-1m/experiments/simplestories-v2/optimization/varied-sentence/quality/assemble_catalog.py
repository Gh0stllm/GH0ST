"""Merge disjoint offline seed runs, apply the explicit heuristic, and export a reproducible catalog."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import random
from grammar_screen import reason, OUT
from exact_sampling import reference


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('inputs',nargs='+')
    parser.add_argument('--count',type=int,default=10000)
    parser.add_argument('--stem')
    args=parser.parse_args()
    stem=args.stem or f'catalog-{args.count}'
    unique={};sources=[]
    for name in args.inputs:
        path=Path(name);rows=json.loads(path.read_text())
        sources.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'distinct_exact_strings':len(rows)})
        for row in rows:
            assert row['prompt_ids']==[3] and row['top_k']==64 and row['temperature_milli']==1000
            assert row['complete'] and row['tokens'][-1] in {1,2,15,30} and len(row['tokens'])<=5
            key=row['text']
            if key not in unique or int(row['seed'],16)<int(unique[key]['seed'],16):unique[key]=row
    filtered={};rejections={}
    for row in sorted(unique.values(),key=lambda r:(int(r['seed'],16),r['text'])):
        rejected=reason(row)
        if rejected:
            rejections[rejected]=rejections.get(rejected,0)+1;continue
        words=' '.join(row['text'].casefold().rstrip('.!?').split())
        filtered.setdefault(words,row|{'word_sequence_key':words})
    pool=list(filtered.values())
    (OUT/'merged-quote5-natural-unique.json').write_text(json.dumps(list(unique.values()),separators=(',',':'))+'\n')
    (OUT/'merged-quote5-grammar-accepted.json').write_text(json.dumps(pool,separators=(',',':'))+'\n')
    meta={'scope':'Offline natural model generations passing a conservative word-level grammar heuristic. No phrase templates, forced punctuation, or output repair.',
        'status':'TARGET_MET_OFFLINE' if len(pool)>=args.count else 'BELOW_TARGET',
        'target':args.count,'unique_natural_exact_strings':len(unique),'grammar_screened_distinct_word_sequences':len(pool),
        'sources':sources,'weights_sha256':hashlib.sha256(reference.blob).hexdigest(),
        'grammar_screen_sha256':hashlib.sha256((OUT/'grammar_screen.py').read_bytes()).hexdigest(),
        'deduplication':'casefold; normalize whitespace; remove final .!?; compare complete word sequence',
        'prompt_ids':[3],'top_k':64,'temperature_milli':1000,'max_new_tokens':5,
        'sampler':'Q12 logits; stable top-k excluding UNK0; original integer exponential lookup; Keccak ABI GH0ST_SAMPLE_STEP_V1/seed/step.',
        'rejection_reasons':rejections,
        'limitations':['Heuristic acceptance is not a proof of grammatical correctness; independently review the fresh random sample.',
            'This catalog is evidence of model capacity, not a runtime output lookup table.',
            'Different arbitrary seeds may repeat, produce incomplete text or poor language; no all-seed uniqueness guarantee.',
            'Gas and EVM token parity must be checked separately using the selected cached model.']}
    if len(pool)>=args.count:
        catalog=[{k:row[k] for k in ['seed','seed_index','prompt_ids','top_k','temperature_milli','tokens','text','word_sequence_key']}|{'max_new_tokens':5} for row in pool[:args.count]]
        path=OUT/f'{stem}.json';path.write_text(json.dumps(catalog,separators=(',',':'))+'\n')
        meta['catalog_file']=path.name;meta['catalog_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        assert len({r['word_sequence_key'] for r in catalog})==args.count
        sample=random.Random(314159).sample(catalog,min(150,len(catalog)))
        (OUT/f'{stem}-review.json').write_text(json.dumps(sample,indent=2)+'\n')
        (OUT/f'{stem}-review.txt').write_text('\n'.join(f'{i+1}. {r["text"]}' for i,r in enumerate(sample))+'\n')
    (OUT/f'{stem}.metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps(meta,indent=2))


if __name__=='__main__':main()
