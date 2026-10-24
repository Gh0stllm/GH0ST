#!/usr/bin/env python3
"""Extract a bounded, deterministic grammar replay sample from one pinned train shard."""
import argparse,collections,hashlib,json,re,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'vendor'))
import pyarrow.parquet as pq

COMMIT='e63b8adc3b1a1bdc7cac5b500d150b71346b0628'
SHARD='data/train-00000-of-00007.parquet'
EXPECTED='ca33531b99f3bebb4125e82f56017c223a4900331b55bcf7cde1b0f750d88fd4'
WORD=re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--limit',type=int,default=25000);a=ap.parse_args()
    source=HERE/'raw/train-00000-of-00007.parquet';assert sha(source)==EXPECTED
    parquet=pq.ParquetFile(source);handles={s:(HERE/f'{s}.jsonl').open('w') for s in ['train','validation','test']}
    seen=set();groups={s:set() for s in handles};counts=collections.Counter();word_counts=collections.Counter();reject=collections.Counter();frequency=collections.Counter();rows_read=0;accepted=0
    try:
        for batch in parquet.iter_batches(batch_size=4096,columns=['story','generation_id','word_count','model']):
            for row in batch.to_pylist():
                row_index=rows_read;rows_read+=1;text=str(row['story']).strip().replace('\r\n','\n')
                if not text.isascii() or any(ord(c)<32 and c not in '\n\t' for c in text):reject['non_ascii_or_control']+=1;continue
                words=WORD.findall(text)
                if not 35<=len(words)<=260:reject['word_length']+=1;continue
                if not re.search(r'[.!?][\"\x27)\]]*$',text):reject['incomplete_ending']+=1;continue
                if 'http://' in text or 'https://' in text or '<script' in text.lower():reject['markup_or_url']+=1;continue
                canonical=' '.join(text.lower().split());digest=hashlib.sha256(canonical.encode()).hexdigest()
                if digest in seen:reject['duplicate_story']+=1;continue
                seen.add(digest);generation=str(row['generation_id'] or f'row-{row_index}')
                # Upstream IDs include a terminal per-story number; keep siblings together.
                completion=re.sub(r'-\d+$','',generation) if row['generation_id'] else generation
                group='simplestories:'+COMMIT+':'+completion
                bucket=int(hashlib.sha256(('gh0st-grammar-v1:'+group).encode()).hexdigest()[:8],16)%10000
                split='train' if bucket<8000 else 'validation' if bucket<9000 else 'test'
                item={'id':f'simplestories-{COMMIT[:12]}-{row_index}','text':text,'split':split,'source_kind':'licensed_teacher',
                      'group_id':group,'source_group':group,'conversation_id':group,'source_dataset':'SimpleStories/SimpleStories',
                      'source_commit':COMMIT,'source_file':SHARD,'source_row':row_index,'generation_id':generation,'source_completion_id':completion,
                      'generator_model':row['model'],'source_license':'MIT','word_count':len(words),'text_sha256':digest}
                handles[split].write(json.dumps(item,ensure_ascii=True)+'\n');groups[split].add(group);counts[split]+=1;word_counts[split]+=len(words)
                if split=='train':frequency.update(w.lower() for w in words)
                accepted+=1
                if accepted>=a.limit:break
            if accepted>=a.limit:break
    finally:
        for f in handles.values():f.close()
    assert accepted>=10000
    assert not groups['train']&groups['validation'] and not groups['train']&groups['test'] and not groups['validation']&groups['test']
    save(HERE/'train-word-frequencies.json',{'scope':'Training split only; full-story lexical words, case folded; no validation/test vocabulary information.',
          'words':frequency.most_common(),'unique_words':len(frequency),'total_words':sum(frequency.values())})
    report={'status':'COMPLETE','dataset':'SimpleStories/SimpleStories','source_commit':COMMIT,'source_split':'train','source_shard':SHARD,
            'source_shard_bytes':source.stat().st_size,'source_shard_sha256':EXPECTED,'raw_total_shard_rows':parquet.metadata.num_rows,
            'rows_read':rows_read,'accepted_stories':accepted,'counts':dict(counts),'lexical_word_counts':dict(word_counts),
            'group_counts':{s:len(v) for s,v in groups.items()},'group_overlap':0,'duplicate_story_overlap':0,'rejected':dict(reject),
            'word_bounds':[35,260],'split_rule':'Strip terminal -storynumber from generation_id; SHA256(gh0st-grammar-v1:+source_commit/completion_group) modulo10000:80/10/10',
            'model_generated':True,'license':'MIT per pinned dataset card','license_card_sha256':sha(HERE/'raw/README-upstream.md'),
            'extractor_sha256':sha(Path(__file__)),'outputs':{s:{'sha256':sha(HERE/f'{s}.jsonl'),'bytes':(HERE/f'{s}.jsonl').stat().st_size} for s in handles},
            'limit_notes':'Bounded prefix of one upstream training shard, not a uniform sample of the complete dataset. Output splits are local generation-group splits; they are not upstream official test data.'}
    save(HERE/'manifest.json',report);print(json.dumps(report,indent=2))

if __name__=='__main__':main()
