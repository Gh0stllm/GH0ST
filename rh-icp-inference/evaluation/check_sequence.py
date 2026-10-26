#!/usr/bin/env python3
"""Replay actual first-pass outputs through the Rust gate and one model repair.

Prompts retain the exporter's confirmed-memory fixtures; recent-output freshness
references are accumulated chronologically from accepted completions. This is a
local quality/retry stress test, not a full canister/blockchain simulation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--model',required=True)
    p.add_argument('--first-pass',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--regate-only',action='store_true',help='Require cached native repair outputs; never invoke generation')
    args=p.parse_args()
    root=Path(__file__).resolve().parents[1]
    toolchain=Path('/workspace/scratch/d5d53b682373/toolchain')
    env=dict(os.environ,CARGO_HOME=str(toolchain/'cargo'),RUSTUP_HOME=str(toolchain/'rustup'))
    cargo=str(toolchain/'cargo/bin/cargo')
    base=[cargo,'run','--quiet','--manifest-path',str(root/'coordinator/Cargo.toml'),'--example']
    def gate(name,text,references):
        raw=subprocess.check_output(base+['check_voice_outputs'],input=json.dumps([{'name':name,'text':text,'recent_references':references}]).encode(),cwd=root,env=env)
        return json.loads(raw)[0]
    rows=[json.loads(line) for line in args.first_pass.read_text().splitlines() if json.loads(line).get('record_type')=='completion']
    accepted=[];records=[]
    args.output.parent.mkdir(parents=True,exist_ok=True)
    for row in rows:
        name=row['case']['name']
        references=row['case'].get('recent_references',[])+accepted[-8:]
        first=gate(name,row['text'],references)
        record={'name':name,'source_id':row['case']['source_id'],'references':references,'first_text':row['text'],'first_gate':first,'accepted':False,'attempts':1}
        if first['valid']:
            record.update(accepted=True,accepted_text=first.get('normalized',row['text']),accepted_attempt=1)
        else:
            repair_input=args.output.parent/f'repair-input-{name}.json'
            repair_input.write_text(json.dumps([{'name':name,'answer':row['text'],'input_tokens':row['prompt_tokens'],'output_tokens':row['generated_tokens']+int(row['ended_naturally']),'recent_references':references}],indent=2)+'\n')
            exported=json.loads(subprocess.check_output(base+['export_voice_cases','--','--repairs',str(repair_input.resolve())],cwd=root,env=env))
            case=next(c for c in exported['cases'] if c['name']==name)
            if case.get('first_pass_valid'):
                raise RuntimeError('Gate and repair exporter disagree')
            case['wire_prompt']=case['repair_wire_prompt']
            case['chunk_seeds']=case['chunk_seeds_by_attempt_and_generated_offset'][1]
            case['variant']='repair'
            repair_cases=args.output.parent/f'repair-case-{name}.json'
            repair_cases.write_text(json.dumps({'profile_hash':exported['profile_hash'],'cases':[case]},indent=2)+'\n')
            repair_output=args.output.parent/f'repair-output-{name}.jsonl'
            reusable=False
            if repair_output.exists():
                previous=json.loads(repair_output.read_text().splitlines()[0])
                reusable=previous.get('prompt_export_sha256')==hashlib.sha256(repair_cases.read_bytes()).hexdigest()
            if not reusable:
                if args.regate_only:
                    raise RuntimeError('Missing matching cached repair; regate-only will not generate')
                subprocess.run([sys.executable,str(root/'evaluation/evaluate_voice.py'),'--model',args.model,'--cases',str(repair_cases),'--output',str(repair_output),'--kv-q8'],cwd=root,check=True)
            repaired=next(json.loads(line) for line in repair_output.read_text().splitlines() if json.loads(line).get('record_type')=='completion')
            second=gate(name,repaired['text'],references)
            record.update(attempts=2,repair_text=repaired['text'],repair_gate=second,repair_record=str(repair_output.resolve().relative_to(root)))
            if second['valid']:
                record.update(accepted=True,accepted_text=second.get('normalized',repaired['text']),accepted_attempt=2)
        if record['accepted']:
            accepted.append(record['accepted_text'])
        records.append(record)
        print(json.dumps({'name':name,'first_valid':first['valid'],'accepted':record['accepted'],'attempts':record['attempts'],'text':record.get('accepted_text',record.get('repair_text'))}),flush=True)
    summary={'method':'local sequential recent-output quality/retry stress; fixed exported confirmed-memory fixtures; same native Q8 runner; no ICP execution/cost measurement','records':records,
        'first_pass_accepted':sum(r.get('accepted_attempt')==1 for r in records),'repair_accepted':sum(r.get('accepted_attempt')==2 for r in records),'rejected_after_limit':sum(not r['accepted'] for r in records),'total':len(records),'regate_only':args.regate_only}
    temporary=args.output.with_suffix(args.output.suffix+'.tmp')
    temporary.write_text(json.dumps(summary,indent=2)+'\n')
    temporary.replace(args.output)


if __name__=='__main__':main()
