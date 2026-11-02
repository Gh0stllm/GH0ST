"""LOCALHOST ONLY: reproduce load/decoding with pinned ICPP Wasm, no real cycles."""
import argparse,hashlib,json,time,sys
from pathlib import Path
from urllib.parse import urlsplit
from icp_core import Agent,Identity,Client,Canister
from icp_core import Types,encode

def connect(url,cid,did):
    if urlsplit(url).hostname not in ('localhost','127.0.0.1'): raise ValueError('Local replica only')
    agent=Agent(Identity(anonymous=True),Client(url=url))
    return agent,Canister(agent,cid,candid_str=Path(did).read_text())
def value(r): return r[0].get('value',r[0])
def ok(r):
    v=value(r)
    if 'Err' in v: raise RuntimeError(str(v))
    return v.get('Ok',v)
def balance(c): return ok(c.get_cycle_balance())['cycle_balance']
def save(out,report): Path(out).write_text(json.dumps(report,indent=2)+'\n')
def main():
    p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--cid',required=True);p.add_argument('--did',required=True);p.add_argument('--model',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);p.add_argument('--skip-upload',action='store_true');p.add_argument('--prompt-file');p.add_argument('--ctx',default=2048,type=int);p.add_argument('--batch',default=4,type=int);a=p.parse_args()
    agent,c=connect(a.url,a.cid,a.did)
    # Mint valueless local test cycles, using the local canister as routing ID.
    agent.update_raw('aaaaa-aa','provisional_top_up_canister',encode([{'type':Types.Record({'canister_id':Types.Principal,'amount':Types.Nat}),'value':{'canister_id':a.cid,'amount':1000000000000000}}]),effective_canister_id=a.cid,verify_certificate=False)
    m=Path(a.model)
    with m.open('rb') as f: digest=hashlib.sha256(f.read()).hexdigest()
    assert digest==a.sha256,(digest,a.sha256)
    report={'scope':'local ICP replica only; cycle balance deltas include storage during elapsed time; no mainnet deployment','model':m.name,'bytes':m.stat().st_size,'sha256':digest,'canister_wasm_sha256':'964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5','runtime':'onicai/llama_cpp_canister v0.23.0rc4','calls':[]}
    def call(name,arg):
        before=balance(c); t=time.perf_counter()
        try: r=value(getattr(c,name)(arg,verify_certificate=False,timeout=180)); error=None
        except Exception as e: r=None;error=str(e)
        row={'method':name,'args':arg,'result':r,'error':error,'elapsed_seconds':time.perf_counter()-t,'cycles_delta':before-balance(c)}
        report['calls'].append(row); save(a.output,report); print(name,row['elapsed_seconds'],row['cycles_delta'],error or str(r)[:200],flush=True)
        if error: raise RuntimeError(error)
        if r and 'Err' in r: raise RuntimeError(str(r))
        return r.get('Ok',r)
    if not a.skip_upload:
        before=balance(c);start=time.perf_counter();offset=0
        with m.open('rb') as f:
            while chunk:=f.read(2000000):
                r=ok(c.file_upload_chunk({'filename':'models/model.gguf','chunk':chunk,'chunksize':len(chunk),'offset':offset},verify_certificate=False,timeout=180))
                offset+=len(chunk)
                if offset%100000000==0: print('uploaded',offset,'seconds',round(time.perf_counter()-start,2),flush=True)
        assert r['filesha256']==digest,r
        report['upload']={'cycles_delta':before-balance(c),'elapsed_seconds':time.perf_counter()-start,'chunks':(offset+1999999)//2000000,'result':r};save(a.output,report)
    call('load_model',{'args':['--model','models/model.gguf','--no-warmup','-c',str(a.ctx),'--batch-size',str(a.batch),'--ubatch-size',str(a.batch),'--cache-type-k','q8_0','--cache-type-v','q8_0']})
    call('set_max_tokens',{'max_tokens_update':1,'max_tokens_query':1})
    prompt=Path(a.prompt_file).read_text() if a.prompt_file else '<|im_start|>user\nReply OK.<|im_end|>\n<|im_start|>assistant\n'
    cache=f'audit-probe-{a.ctx}-{a.batch}.cache'
    call('new_chat',{'args':['--prompt-cache',cache]})
    out='';generated=0
    for i in range(700):
        r=call('run_update',{'args':['--prompt-cache',cache,'--prompt-cache-all','--simple-io','--no-display-prompt','-n','128','--seed','42','--temp','0','-p',prompt]})
        out+=r['output'];generated+=sum(r.get('n_tokens_generated',[]))
        if r['prompt_remaining']=='': prompt=''
        if r['generated_eog'] or generated>=32: break
    report['output']=out;report['generated_tokens']=generated;save(a.output,report)
if __name__=='__main__': main()
