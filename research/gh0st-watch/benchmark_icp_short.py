"""Meter a complete synthetic response on an already-loaded LOCAL ICP 2B canister.
Requires icp-py-core==2.3.1 and benchmark_icp_local.py / benchmark_contract_audit.py.
"""
import argparse,json,time
from pathlib import Path
from benchmark_icp_local import connect,ok,balance
from improve_audit import cases,make_prompt
from evidence_audit import trace_prompt,GRAMMAR

EXPECTED='aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['url','cid','did','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--cache',required=True,help='Use a previously unused prompt cache name')
    p.add_argument('--case',default='mint_vulnerable');p.add_argument('--trace-file',help='Use measured execution observations instead of Solidity');p.add_argument('--trace-format',choices=['raw','facts'],default='raw');a=p.parse_args()
    agent,c=connect(a.url,a.cid,a.did)
    details=ok(c.uploaded_file_details({'filename':'models/model.gguf'}))
    assert details['filesha256']==EXPECTED,details
    case=next(x for x in cases() if x['id']==a.case)
    grammar='root ::= "A" | "B" | "U"'; prompt=make_prompt(case,'terse')
    if a.trace_file:
        case=next(r for r in json.loads(Path(a.trace_file).read_text())['runs'] if r['id']==a.case)
        prompt=trace_prompt(case,form=a.trace_format); grammar=GRAMMAR
    # Each allowed English answer occupied one visible token in the native raw-trace screen.
    # The four-token source trial emitted 'AA'. Never salvage malformed output via first-letter parsing.
    limit=1 if a.trace_file else 4
    report={'scope':'local ICP replica only; not a mainnet or full-project audit','mode':a.trace_format if a.trace_file else 'terse-source','model_sha256':EXPECTED,'case':case,'calls':[]}
    def call(name,arg):
        before=balance(c);started=time.perf_counter()
        try:r=ok(getattr(c,name)(arg,verify_certificate=False,timeout=600));error=None
        except Exception as exc:r=None;error=str(exc)
        row={'method':name,'args':arg,'result':r,'error':error,'elapsed_seconds':time.perf_counter()-started,'cycles_delta':before-balance(c)}
        report['calls'].append(row);Path(a.output).write_text(json.dumps(report,indent=2)+'\n')
        print(name,row['elapsed_seconds'],row['cycles_delta'],error,flush=True)
        if error:raise RuntimeError(error)
        return r
    call('set_max_tokens',{'max_tokens_update':0,'max_tokens_query':1})
    call('new_chat',{'args':['--prompt-cache',a.cache]})
    call('run_update_full',{'args':['--prompt-cache',a.cache,'--prompt-cache-all','--simple-io','--no-display-prompt','-n',str(limit),'--grammar',grammar,'--seed','42','--temp','0','-p',prompt]})
if __name__=='__main__':main()
