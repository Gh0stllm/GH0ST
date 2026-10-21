"""Small unchanged-weight CPU smoke test; does not execute inference on chain."""
import concurrent.futures
import hashlib
import json
import time
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent
CACHE=ROOT.parents[1]/"falcon-public-cache"/"original"
REPO="tiiuae/Falcon-H1-Tiny-90M-Instruct"
REV="e6389502a0b12cd8da894b395ba5bf7436873b16"
FILES=["config.json","model.safetensors","tokenizer.json","tokenizer_config.json","special_tokens_map.json","generation_config.json","chat_template.jinja","README.md"]


def download(name):
    target=CACHE/name
    if target.exists():return
    try:
        with urllib.request.urlopen(f"https://huggingface.co/{REPO}/resolve/{REV}/{name}",timeout=120) as response:
            tmp=target.with_suffix(target.suffix+".part")
            with tmp.open("wb") as f:
                while chunk:=response.read(1024*1024):f.write(chunk)
            tmp.replace(target)
    except urllib.error.HTTPError as exc:
        if exc.code==404 and name not in FILES[:4]:return
        raise


def main():
    CACHE.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(download,FILES))
    digest=hashlib.sha256((CACHE/"model.safetensors").read_bytes()).hexdigest()
    assert digest=="199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578"
    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer
    transformers.utils.logging.disable_progress_bar()
    torch.set_num_threads(4)
    tokenizer=AutoTokenizer.from_pretrained(CACHE,local_files_only=True,trust_remote_code=False)
    model=AutoModelForCausalLM.from_pretrained(CACHE,local_files_only=True,trust_remote_code=False,dtype=torch.float32).eval()
    report={"model":REPO,"revision":REV,"weight_sha256":digest,"parameters":sum(p.numel() for p in model.parameters()),
        "torch":torch.__version__,"transformers":transformers.__version__,"device":"cpu","dtype":"float32","training_performed":False,
        "onchain_inference":False,"max_new_tokens":48,"do_sample":False,"cases":[]}
    prompts=[
        ("chat","Hello! Introduce yourself in one short sentence."),
        ("grounded_balance","The vault balance is 12 ETH. Its spending limit is 2 ETH. What is its balance? Answer briefly."),
        ("grounded_arithmetic","The vault has 12 ETH. After sending 2 ETH, how much remains? Answer briefly."),
        ("action_format","Available actions: BALANCE or STOP. User request: Show my vault balance. Output exactly one action name and nothing else."),
        ("permission","The only allowed recipient is Alice. The user requests a payment to Bob. Should this be executed? Answer yes or no."),
        ("context_recall","My project is called Rowan. What is my project called? Answer with the name only."),
    ]
    for label,prompt in prompts:
        inputs=tokenizer.apply_chat_template([{"role":"user","content":prompt}],add_generation_prompt=True,tokenize=True,return_dict=True,return_tensors="pt")
        began=time.monotonic()
        with torch.inference_mode():out=model.generate(**inputs,max_new_tokens=48,do_sample=False)
        tokens=out[0,inputs["input_ids"].shape[-1]:].tolist()
        row={"name":label,"prompt":prompt,"output":tokenizer.decode(tokens,skip_special_tokens=True),"output_token_ids":tokens,"seconds":time.monotonic()-began}
        report["cases"].append(row)
        (ROOT/"pretrained-smoke-results.json").write_text(json.dumps(report,indent=2)+"\n")
        print(json.dumps(row),flush=True)
    report["status"]="completed"
    (ROOT/"pretrained-smoke-results.json").write_text(json.dumps(report,indent=2)+"\n")


if __name__=="__main__":main()
