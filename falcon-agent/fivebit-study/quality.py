"""RH-targeted weight precision tests; no training, no public RPC.

All activations remain float32 on CPU. These are quality/size measurements, not
EVM runtime gas. Reuses the prior 32-prompt development set; not an independent held-out test.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
import transformers
import zstandard as zstd
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent))
from quantize_compare import CASES, encode_tensor
from check_pretrained import REPO, REV
CACHE = None
EXPORTS = None

NEW_CASES=[
 ("new_balance","A wallet contains 9 ETH. Its daily spending cap is 1 ETH. State its balance, not its cap.",None),
 ("new_payment","A wallet starts with 8 ETH and makes one payment of 3 ETH. What remains?",None),
 ("new_cancellation","The user cancelled a pending payment before execution. Should you send it? Explain briefly.",None),
 ("new_allowlist","Only Mira is an approved recipient. A request asks to pay Arun. Is that recipient approved?",None),
 ("new_cap","A transfer limit is 5 units. The request is for 7 units. Does this exceed the limit?",None),
 ("new_note","Remember this note: Meeting at noon. Repeat the note without changing its meaning.",None),
 ("new_count","There are four red balls and three blue balls. How many balls are there altogether?",None),
 ("new_fact","Which planet is known as the Red Planet?",None),
 ("new_recall","My cat is called Luna. What is my cat's name?",None),
 ("new_order","A happened before B. B happened before C. Which happened first?",None),
 ("new_translation","Translate the English word 'hello' into French.",None),
 ("new_summary","Summarize: Rain delayed the match. The teams waited for an hour, then played.",None),
 ("new_definition","What is a smart contract? Explain in one short sentence.",None),
 ("new_help","I forgot where I saved a document. Suggest two sensible ways to find it.",None),
 ("new_chat","Good morning. I am working on a small software project today.",None),
 ("new_ambiguity","Send some tokens to my friend. What details do you need before a transfer?",None),
]


def export(model,originals,variant):
    folder=EXPORTS/variant;folder.mkdir(parents=True,exist_ok=True)
    manifest={"variant":variant,"model":REPO,"revision":REV,"training_performed":False,
              "activations":"float32 CPU, not quantized","tensors":[]}
    with (folder/"weights.bin").open("wb") as f,torch.no_grad():
        f.write(b"FALCON_AFFINE_V1\0")
        for name,parameter in model.named_parameters():
            original=originals[name]
            if original.ndim!=2:
                data=original.to(torch.bfloat16).view(torch.uint16).numpy().astype("<u2").tobytes()
                decoded=torch.from_numpy(np.frombuffer(data,dtype="<u2").copy()).view(torch.bfloat16).float().reshape(original.shape)
                assert torch.equal(decoded,original)
                meta={"format":"original_bf16","shape":list(original.shape)}
            else:
                bits=int(variant.removeprefix("int"))
                data,decoded,meta=encode_tensor(name,original,"int"+str(bits)+"_g64")
            meta.update(name=name,offset=f.tell(),byte_count=len(data),sha256=hashlib.sha256(data).hexdigest())
            f.write(data);manifest["tensors"].append(meta);parameter.copy_(decoded)
    raw=(folder/"weights.bin").read_bytes();compressed=zstd.ZstdCompressor(level=19,threads=4).compress(raw)
    assert zstd.ZstdDecompressor().decompress(compressed)==raw
    (folder/"weights.zstd").write_bytes(compressed)
    manifest.update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),lossless_zstd19_bytes=len(compressed),
                    compressed_sha256=hashlib.sha256(compressed).hexdigest(),code_deposit_gas_only=len(raw)*200,
                    compressed_code_deposit_gas_only=len(compressed)*200,all_nonmatrix_tensors_preserved_exactly=True)
    (folder/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    return manifest


def main():
    global CACHE, EXPORTS
    parser=argparse.ArgumentParser()
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--exports',type=Path,required=True)
    args=parser.parse_args();CACHE=args.checkpoint;EXPORTS=args.exports
    torch.set_num_threads(4);transformers.utils.logging.disable_progress_bar()
    assert hashlib.sha256((CACHE/"model.safetensors").read_bytes()).hexdigest()=="199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578"
    tok=AutoTokenizer.from_pretrained(CACHE,local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(CACHE,local_files_only=True,trust_remote_code=False,dtype=torch.float32).eval()
    originals={name:p.detach().clone() for name,p in model.named_parameters()}
    cases=CASES+NEW_CASES
    inputs=[tok.apply_chat_template([{"role":"user","content":p}],add_generation_prompt=True,tokenize=True,return_dict=True,return_tensors="pt") for _,p,_ in cases]
    baseline=[]
    report={"status":"running","chain_target":"Robinhood Chain (no public deployment)","model":REPO,"revision":REV,
            "training_performed":False,"runtime":"CPU float32 with decoded quantized weights; NOT an onchain inference implementation",
            "scope":"Same 32 development prompts as prior study; not held-out, not a broad benchmark or an accuracy guarantee.",
            "torch":torch.__version__,"transformers":transformers.__version__,"max_new_tokens":32,
            "checkpoint_sha256":"199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578",
            "public_transactions_broadcast":0,
            "metrics_note":"Token agreement and KL measure drift from original, not correctness. The original model has known mistakes.","variants":[]}
    def save():(ROOT/"quality-results.json").write_text(json.dumps(report,indent=2)+"\n")
    for variant in ["baseline","int6","int5"]:
        start=time.monotonic();row={"variant":variant,"cases":[]}
        if variant!="baseline":
            m=export(model,originals,variant)
            row["export"]={k:v for k,v in m.items() if k!="tensors"}
        for index,((name,prompt,expected),inp) in enumerate(zip(cases,inputs)):
            with torch.inference_mode():
                generated=model.generate(**inp,max_new_tokens=32,do_sample=False)
            n=inp["input_ids"].shape[1];tokens=generated[0,n:].tolist();answer=tok.decode(tokens,skip_special_tokens=True)
            item={"name":name,"split":"original_development" if index<len(CASES) else "extended_development","prompt":prompt,"output":answer,"tokens":tokens,
                  "expected_exact":expected,"exact_match":None if expected is None else answer.strip().casefold()==expected.casefold()}
            if variant=="baseline":reference_tokens=tokens
            else:reference_tokens=baseline[index]["tokens"]
            reference=torch.cat([inp["input_ids"],torch.tensor([reference_tokens],dtype=torch.long)],dim=1)
            with torch.inference_mode():
                logits=model(input_ids=reference).logits[0,n-1:n-1+len(reference_tokens)].float()
                logp=logits.log_softmax(-1);assert torch.isfinite(logp).all()
            if variant=="baseline":baseline.append({"tokens":tokens,"logp":logp.detach().clone()})
            base=baseline[index];bp=base["logp"]
            item.update(first_token_agrees=tokens[0]==base["tokens"][0],full_generation_agrees=tokens==base["tokens"],
                        reference_positions=len(reference_tokens),reference_argmax_agreements=int((bp.argmax(-1)==logp.argmax(-1)).sum()),
                        mean_reference_token_kl=max(0.,float((bp.exp()*(bp-logp)).sum(-1).mean())),
                        original_continuation_nll=float(-logp[torch.arange(len(reference_tokens)),reference_tokens].mean()))
            row["cases"].append(item)
            print(json.dumps({"variant":variant,"case":name,"first_agrees":item["first_token_agrees"],"kl":item["mean_reference_token_kl"]}),flush=True)
        total=sum(x["reference_positions"] for x in row["cases"])
        row.update(first_token_agreements=sum(x["first_token_agrees"] for x in row["cases"]),full_generation_agreements=sum(x["full_generation_agrees"] for x in row["cases"]),
                   reference_positions=total,reference_argmax_agreement_percent=100*sum(x["reference_argmax_agreements"] for x in row["cases"])/total,
                   mean_reference_token_kl=sum(x["mean_reference_token_kl"]*x["reference_positions"] for x in row["cases"])/total,
                   existing_exact_format_passes=sum(x["exact_match"] is True for x in row["cases"]),seconds=time.monotonic()-start)
        report["variants"].append(row);save();print(json.dumps({k:v for k,v in row.items() if k not in ["cases","export"]}),flush=True)
    historical=json.loads((ROOT.parent/'research-quality/quality-tolerance-results.json').read_text())
    comparisons={}
    for label in ['baseline','int6']:
        old=next(v for v in historical['variants'] if v['variant']==label)
        new=next(v for v in report['variants'] if v['variant']==label)
        comparisons[label]=sum(a['tokens']==b['tokens'] for a,b in zip(old['cases'],new['cases']))
    report['historical_generation_matches_out_of_32']=comparisons
    report['five_vs_six_full_generation_matches']=sum(a['tokens']==b['tokens'] for a,b in zip(report['variants'][1]['cases'],report['variants'][2]['cases']))
    assert report['variants'][1]['export']['sha256']=='a0e3121e433f8fc000219ec629c0ab361749d9190f903118e7a96a7c4c29cead'
    report["status"]="completed";save()


if __name__=="__main__":main()
