#!/usr/bin/env python3
"""Pin a public checkpoint and test its actual local pretrained generations.

No training, remote code, credentials, hosted inference, or chain RPC is used.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
CACHE = ROOT/"model-cache"
MODEL = "SimpleStories/SimpleStories-V2-1.25M"
os.environ["HF_HOME"] = str(CACHE/".hf-cache")
os.environ["TOKENIZERS_PARALLELISM"] = "false"


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True)+"\n")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def public_get(url):
    request = urllib.request.Request(url, headers={"User-Agent":"GH0ST-public-model-evaluation/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def download():
    CACHE.mkdir(parents=True, exist_ok=True)
    existing = ROOT/"provenance.json"
    if existing.exists():
        provenance = json.loads(existing.read_text())
        assert all(digest(CACHE/name)==item["sha256"] for name,item in provenance["files"].items())
        return provenance
    metadata = json.loads(public_get("https://huggingface.co/api/models/"+MODEL))
    revision = metadata["sha"]
    names = {entry["rfilename"] for entry in metadata["siblings"]}
    candidates = ["config.json","generation_config.json","tokenizer.json","tokenizer_config.json",
                  "special_tokens_map.json","added_tokens.json","vocab.txt","README.md","LICENSE","model.safetensors"]
    selected = [name for name in candidates if name in names]
    if "model.safetensors" not in selected:
        raise RuntimeError("Expected safetensors checkpoint is absent; refusing pickle fallback")
    files = {}
    for name in selected:
        url = "https://huggingface.co/"+MODEL+"/resolve/"+revision+"/"+urllib.parse.quote(name)
        data = public_get(url)
        if len(data)>100_000_000:
            raise RuntimeError("Unexpectedly large checkpoint file")
        path = CACHE/name
        path.write_bytes(data)
        files[name]={"sha256":digest(path),"bytes":len(data),"url":url}
        print(json.dumps({"downloaded":name,"bytes":len(data),"sha256":files[name]["sha256"]}),flush=True)
    from safetensors import safe_open
    tensors = {}
    with safe_open(CACHE/"model.safetensors", framework="pt", device="cpu") as model:
        for name in model.keys():
            tensor = model.get_slice(name)
            shape = tensor.get_shape()
            tensors[name]={"shape":shape,"parameters":math.prod(shape),"dtype":tensor.get_dtype()}
    provenance={"repository":MODEL,"revision":revision,"source":"https://huggingface.co/"+MODEL,
                "downloaded_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "files":files,"config":json.loads((CACHE/"config.json").read_text()),
                "tensor_count":len(tensors),"stored_tensor_parameter_count":sum(t["parameters"] for t in tensors.values()),
                "tensors":tensors,"authentication":"none; public HTTPS only"}
    write_json(existing,provenance)
    return provenance


PROMPTS = [
    "Once upon a time, a small bird found a silver key.",
    "Mia wanted to cross the river, but the bridge was broken.",
    "Tom lost his favorite toy. His sister offered to help.",
    "The little fox was afraid of the dark forest.",
    "A robot woke up in a quiet garden and heard a strange sound.",
    "Lily made a mistake and decided to tell the truth.",
    "The children planted a seed. Every morning they gave it water.",
    "A storm was coming, and the old dog could not find its home.",
    "The market was quiet. A trader watched the price change.",
    "The price moved quickly, and the machine began to speak.",
    "A curious machine remembered every trade in the pool.",
    "Ben had two apples and gave one to his friend.",
]


def evaluate(first_samples=False):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    torch.set_num_threads(4)
    tokenizer = AutoTokenizer.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(CACHE, local_files_only=True, trust_remote_code=False)
    model.eval()
    actual_parameters=sum(parameter.numel() for parameter in model.parameters())
    generations=[]
    selected_prompts=PROMPTS[:3] if first_samples else PROMPTS
    selected_seeds=[731101] if first_samples else [731101,731102]
    for prompt_index,prompt in enumerate(selected_prompts):
        encoded=tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        input_length=encoded["input_ids"].shape[1]
        for seed in selected_seeds:
            torch.manual_seed(seed)
            with torch.inference_mode():
                output=model.generate(**encoded,max_new_tokens=48,do_sample=True,temperature=.8,top_p=.95,top_k=40,
                                      pad_token_id=tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id,
                                      eos_token_id=tokenizer.eos_token_id)
            new_ids=output[0,input_length:].tolist()
            continuation=tokenizer.decode(new_ids,skip_special_tokens=True)
            words=re.findall(r"[A-Za-z']+",continuation.lower())
            bigrams=list(zip(words,words[1:]))
            ended_eos=bool(new_ids and new_ids[-1]==tokenizer.eos_token_id)
            generations.append({"prompt_index":prompt_index,"prompt":prompt,"seed":seed,"input_tokens":input_length,
                                "new_tokens":len(new_ids),"token_ids":new_ids,"continuation":continuation,
                                "full_text":tokenizer.decode(output[0],skip_special_tokens=True),"ended_eos":ended_eos,
                                "hit_token_cap":len(new_ids)==48 and not ended_eos,
                                "repeated_bigram_count":len(bigrams)-len(set(bigrams)),
                                "nonempty":bool(words)})
            print(json.dumps({"prompt_index":prompt_index,"seed":seed,"continuation":continuation}),flush=True)
    report={"repository":MODEL,"revision":json.loads((ROOT/"provenance.json").read_text())["revision"],
            "actual_unique_model_parameters":actual_parameters,"device":"cpu","max_new_tokens":48,"seeds":selected_seeds,
            "tokenizer_policy":{"add_special_tokens":False,"prepend_bos":False,"eos_token_id":tokenizer.eos_token_id,"pad_token_id":tokenizer.pad_token_id,
                                "note":"Use actual tokenizer EOS1 rather than inconsistent model config EOS2; avoid automatic EOS appended to prompts."},
            "sampling":{"temperature":.8,"top_p":.95,"top_k":40},"generations":generations,
            "mechanical_metrics":{"samples":len(generations),"nonempty":sum(r["nonempty"] for r in generations),
                                  "eos_completions":sum(r["ended_eos"] for r in generations),
                                  "token_cap_hits":sum(r["hit_token_cap"] for r in generations),
                                  "distinct_continuations":len({r["continuation"] for r in generations})},
            "limitations":["24 small-sample local continuations, not a standardized comparative benchmark.",
                           "Mechanical repetition/completion counts do not establish grammar, coherence, factuality or instruction-following.",
                           "48-token cap can truncate otherwise coherent continuations.",
                           "This checkpoint uses its actual tokenizer and architecture; results do not establish v4 gas feasibility."]}
    write_json(ROOT/"quality-report.json",report)
    print(json.dumps({"actual_unique_model_parameters":actual_parameters,"metrics":report["mechanical_metrics"]}),flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--download-only",action="store_true")
    parser.add_argument("--evaluate-only",action="store_true")
    parser.add_argument("--first-samples",action="store_true")
    args=parser.parse_args()
    if not args.evaluate_only:
        provenance=download()
        print(json.dumps({"revision":provenance["revision"],"stored_tensor_parameter_count":provenance["stored_tensor_parameter_count"],"config":provenance["config"]}),flush=True)
    if not args.download_only:
        evaluate(first_samples=args.first_samples)


if __name__=="__main__":main()
