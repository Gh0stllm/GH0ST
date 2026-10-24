"""Create a new mixed snapshot; never mutate the original large-v3 corpus."""
import json,hashlib,collections,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--name',default='mixed-teacher-v4');args=parser.parse_args()
assert args.name.replace('-','').isalnum()
old=ROOT/'corpus';teacher=ROOT/'teacher-v4';out=ROOT/args.name
assert (teacher/'manifest.json').exists(),'Need finalized teacher dataset'
if (out/'manifest.json').exists():raise ValueError('Existing merged snapshot is immutable')
out.mkdir(exist_ok=True)
counts={};ids=set();hashes={};parents={}
for split in ['train','validation','test']:
 c=collections.Counter();rows=[]
 for origin in [old,teacher]:
  p=origin/(split+'.jsonl');parents[str(p.relative_to(ROOT))]=hashlib.sha256(p.read_bytes()).hexdigest()
  for line in p.read_text().splitlines():
   if not line.strip():continue
   row=json.loads(line);assert row['split']==split;ident=row['id'];assert ident not in ids,ident;ids.add(ident)
   digest=hashlib.sha256(' '.join(row['text'].casefold().split()).encode()).hexdigest()
   if digest in hashes:
    assert hashes[digest]==split,'Cross-split duplicate';continue
   hashes[digest]=split;c[row['source_kind']]+=1;rows.append(row)
 (out/(split+'.jsonl')).write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows))
 counts[split]=dict(c)
manifest={'schema_version':1,'purpose':'Local-only four-source corpus; independent licensed teacher prose added to immutable original large corpus.','counts':counts,'total_documents':sum(sum(x.values()) for x in counts.values()),'parent_file_sha256':parents,'licensed_teacher_provenance':json.loads((teacher/'manifest.json').read_text()),'original_large_corpus_manifest_sha256':hashlib.sha256((old/'manifest.json').read_bytes()).hexdigest(),'files':{s:{'bytes':(out/(s+'.jsonl')).stat().st_size,'sha256':hashlib.sha256((out/(s+'.jsonl')).read_bytes()).hexdigest()} for s in counts}}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'counts':counts,'total_documents':manifest['total_documents']}))
