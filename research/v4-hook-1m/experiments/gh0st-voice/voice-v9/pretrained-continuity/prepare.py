#!/usr/bin/env python3
"""Freeze original WordPiece documents; no training, EOS insertion or cross-document packing."""
import argparse,json,os,collections,hashlib
from pathlib import Path
os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
from core import VOICE,BASE,sha,save

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',type=Path,required=True);p.add_argument('--checkpoint',type=Path,default=BASE)
    p.add_argument('--legacy-voice',type=Path,default=VOICE/'voice-v7/training/encoded-base')
    p.add_argument('--new-voice',type=Path,default=VOICE/'voice-v8/data/authored-continuity/style')
    p.add_argument('--grammar',type=Path,default=VOICE/'large-v3/recovery-v5/grammar-replay')
    a=p.parse_args()
    if a.out.exists():raise ValueError('Output must be new')
    from transformers import AutoTokenizer
    tok=AutoTokenizer.from_pretrained(a.checkpoint,local_files_only=True,trust_remote_code=False)
    spec=json.loads(tok.backend_tokenizer.to_str())
    assert len(tok)==4019 and spec['model']['type']=='WordPiece' and tok.unk_token_id==0
    rows={};groups={};texts={};sources={};counts={};duplicates=collections.Counter()
    for split in ('train','validation','test'):
        rows[split]=[];counts[split]={}
        for root,kind,filter_original in [(a.legacy_voice,'voice',True),(a.new_voice,'voice',False),(a.grammar,'grammar',False)]:
            path=root/f'{split}.jsonl';sources[str(path.resolve())]=sha(path)
            for lineno,line in enumerate(path.open(),1):
                raw=json.loads(line)
                if filter_original and not(raw.get('kind')=='original' or raw.get('source_kind')=='original_voice'):continue
                group=raw['group_id'];text=raw['text'];norm=' '.join(text.lower().split())
                digest=hashlib.sha256(norm.encode()).hexdigest()
                if group in groups and groups[group]!=split:raise ValueError('Source group crosses splits: '+group)
                groups[group]=split
                if digest in texts:
                    if texts[digest]!=split:raise ValueError('Normalized duplicate crosses splits')
                    duplicates[split]+=1;continue
                texts[digest]=split
                ids=tok.encode(text,add_special_tokens=False)
                if len(ids)<2:raise ValueError('Document cannot supply a next-token target')
                row={'id':raw['id'],'group_id':group,'split':split,'kind':kind,'text':text,'token_ids':ids,
                     'source_kind':raw.get('source_kind'),'source_path':str(path.resolve()),'source_line':lineno,
                     'source_line_sha256':hashlib.sha256(line.encode()).hexdigest()}
                rows[split].append(row)
                c=counts[split].setdefault(kind,collections.Counter())
                c.update(documents=1,tokens=len(ids),known_targets=sum(x!=0 for x in ids[1:]),unknown_tokens=ids.count(0),words=len(text.split()))
    a.out.mkdir(parents=True)
    artifacts={}
    for split,items in rows.items():
        path=a.out/f'{split}.jsonl';path.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in items))
        artifacts[path.name]={'sha256':sha(path),'bytes':path.stat().st_size}
    report={'status':'COMPLETE','tokenizer_kind':'WordPiece','vocabulary':4019,'eos_inserted':False,
            'checkpoint':str(a.checkpoint.resolve()),'base_sha256':sha(a.checkpoint/'model.safetensors'),
            'tokenizer_sha256':sha(a.checkpoint/'tokenizer.json'),'statistics':counts,
            'source_files_sha256':sources,'artifacts':artifacts,'duplicate_rows_skipped':dict(duplicates),
            'cross_split_group_overlap':0,'cross_split_normalized_duplicate_overlap':0,
            'teacher_source':'Existing pinned SimpleStories grammar replay only; no Qwen/GPT2 generated additions.',
            'prepared_by_sha256':sha(Path(__file__)),'core_sha256':sha(Path(__file__).with_name('core.py'))}
    save(a.out/'manifest.json',report);print(json.dumps(report,indent=2))

if __name__=='__main__':main()
