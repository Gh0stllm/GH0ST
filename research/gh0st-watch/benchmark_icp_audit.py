"""Meter a complete synthetic response on an already-loaded LOCAL ICP 2B canister.
Requires icp-py-core==2.3.1 and benchmark_icp_local.py / benchmark_contract_audit.py.
"""
import argparse,json,time
from pathlib import Path
from benchmark_icp_local import connect,ok,balance
from benchmark_contract_audit import FIXTURES,prompt

EXPECTED='aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['url','cid','did','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--cache',default='bounded-mint-audit.cache');a=p.parse_args()
    agent,c=connect(a.url,a.cid,a.did)
    details=ok(c.uploaded_file_details({'filename':'models/model.gguf'}))
    assert details['filesha256']==EXPECTED,details
    case=next(x for x in FIXTURES if x['id']=='mint_vulnerable')
    report={'scope':'local ICP replica only; not a mainnet or full-project audit','model_sha256':EXPECTED,'case':case,'calls':[]}
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
    call('run_update_full',{'args':['--prompt-cache',a.cache,'--prompt-cache-all','--simple-io','--no-display-prompt','-n','256','--seed','42','--temp','0','-p',prompt(case['source'],'Qwen3.5-2B-Q4_K_M')]})
if __name__=='__main__':main()
