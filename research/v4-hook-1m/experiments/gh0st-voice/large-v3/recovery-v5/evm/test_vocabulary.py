"""Cross-check complete-word JavaScript display against the actual Python tokenizer."""
from pathlib import Path
import argparse
import hashlib
import json
import random
import subprocess
import sys

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'export'))
import export_recovery as exporter


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--export-dir',type=Path,default=HERE.parent/'export/initial-layout-check')
    parser.add_argument('--report',type=Path,default=HERE/'vocabulary-test.json')
    args=parser.parse_args();source=args.export_dir.resolve()
    tokenizer,_,_,_=exporter.load_wordlevel(source/'vocabulary/tokenizer.json')
    rng=random.Random(20261024)
    cases=[[i]for i in range(4019)]
    cases.extend([list(range(32)),[3,3,15,2,30],[0,1,0],*[rng.choices(range(4019),k=k)for k in[2,8,32,64]for _ in range(32)]])
    for text in ["i can't see the machine.","i don't know why it won't work!",'" the machine asked, why? "',"i am thinking about the pool."]:
        cases.append(tokenizer.encode(text,add_special_tokens=False))
    expected=[tokenizer.decode(ids,skip_special_tokens=True)for ids in cases]
    script='''import fs from"node:fs";import assert from"node:assert/strict";import{pathToFileURL}from"node:url";
const m=await import(pathToFileURL(process.argv[1]).href),source=process.argv[2],fixture=JSON.parse(fs.readFileSync(0,"utf8")),v=m.loadVocabulary(source);
for(let i=0;i<fixture.cases.length;i++)assert.equal(m.decodeIds(fixture.cases[i],v.words),fixture.expected[i],"decode case"+i);
let rejected=false;const bad=Buffer.from(v.blob);bad.writeUInt32BE(1,8);try{m.decodeVocabularyBlob(bad);}catch{rejected=true;}assert(rejected);
process.stdout.write(JSON.stringify({cases:fixture.cases.length,all_python_decodes_match:true,all4019_entries_checked:true,corrupt_offsets_rejected:true,vocabulary_bytes:v.blob.length,shards:v.manifest.shards.length}));'''
    result=json.loads(subprocess.check_output([exporter.q12.NODE,'--input-type=module','-e',script,str(HERE/'vocabulary.mjs'),str(source)],input=json.dumps({'cases':cases,'expected':expected}).encode(),cwd=exporter.q12.RESEARCH))
    result.update(status='PASS',scope='Offline WordLevel display/blob parity; no local EVM execution',tokenizer_sha256=hashlib.sha256((source/'vocabulary/tokenizer.json').read_bytes()).hexdigest(),vocabulary_sha256=hashlib.sha256((source/'vocabulary/vocabulary.bin').read_bytes()).hexdigest())
    args.report.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
