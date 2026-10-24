"""Offline gas-rerun fixtures using the unchanged, already-exported Q12 model.

The numerical functions are compiled verbatim from the original independent
reference. This script never invokes that file's exporter or main function.
It reads the existing packed tensors and tables, leaving prior reports intact.
"""
from __future__ import annotations

import ast
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess

os.environ["TOKENIZERS_PARALLELISM"] = "false"
BASE = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    import numpy as np
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.set_num_threads(2)
    protocol = json.loads((BASE / "contracts/protocol.json").read_text())
    manifest = json.loads((BASE / "model/manifest.json").read_text())
    original = json.loads((BASE / "integer-reference.json").read_text())
    provenance = json.loads((BASE / "provenance.json").read_text())
    weights = (BASE / "model/weights.bin").read_bytes()
    tables = (BASE / "model/tables.bin").read_bytes()
    assert hashlib.sha256(weights).hexdigest() == manifest["artifacts"]["weights.bin"]["sha256"]
    assert hashlib.sha256(tables).hexdigest() == manifest["artifacts"]["tables.bin"]["sha256"]
    assert sha(BASE / "model-cache/model.safetensors") == provenance["files"]["model.safetensors"]["sha256"]
    tensors = {
        x["name"]: np.frombuffer(weights, dtype=">i2", count=x["elements"], offset=x["byte_offset"])
        .astype(np.int64).reshape(x["shape"])
        for x in protocol["weights"]["tensor_layout"]
    }
    assert sum(x.size for x in tensors.values()) == protocol["parameter_count"] == 1235968
    cos = np.frombuffer(tables, dtype=">i2", count=256, offset=0).astype(np.int64).reshape(16, 16)
    sin = np.frombuffer(tables, dtype=">i2", count=256, offset=512).astype(np.int64).reshape(16, 16)
    sigmoid = np.frombuffer(tables, dtype=">u4", count=257, offset=1024).astype(np.int64)
    exp = np.frombuffer(tables, dtype=">u4", count=257, offset=2052).astype(np.int64)

    # Reuse exactly the original mathematical definitions, not its side effects.
    source_path = BASE / "integer_reference.py"
    module = ast.parse(source_path.read_text(), filename=str(source_path))
    old_main = next(x for x in module.body if isinstance(x, ast.FunctionDef) and x.name == "main")
    functions = [x for x in old_main.body if isinstance(x, ast.FunctionDef)]
    assert {x.name for x in functions} == {"div", "checked", "linear", "rms", "rotate", "interpolate", "silu", "forward"}
    scope = dict(np=np, math=math, os=os, subprocess=subprocess, ROOT=BASE, Q=4096,
                 tensors=tensors, cos=cos, sin=sin, sigmoid=sigmoid, exp=exp)
    compiled = compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), str(source_path), "exec")
    exec(compiled, scope)
    forward = scope["forward"]
    tokenizer = AutoTokenizer.from_pretrained(BASE / "model-cache", local_files_only=True, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(BASE / "model-cache", local_files_only=True,
                                               trust_remote_code=False, attn_implementation="eager").eval()
    qa = json.loads((BASE / "qa-probe.json").read_text())["probes"][0]
    minimal_prompt = "The"
    minimal_ids = tokenizer.encode(minimal_prompt, add_special_tokens=False)
    attention_ids = tokenizer.encode("The little", add_special_tokens=False)
    qa_ids = tokenizer.encode(qa["prompt"], add_special_tokens=False)
    assert minimal_ids == [85]
    assert attention_ids == [85, 611]
    assert qa_ids == qa["prompt_token_ids"] and len(qa_ids) == 10
    fixtures = []
    inputs = [("single-token", minimal_prompt, minimal_ids),
              ("two-token-attention", "The little", attention_ids),
              ("qa-short", qa["prompt"], qa_ids)]
    with torch.inference_mode():
        for name, prompt, ids in inputs:
            item = forward(ids, include_trace=True)
            item.pop("layer_outputs")
            item.update(name=name, prompt=prompt, prompt_ids=ids,
                        next_token_text=tokenizer.decode([item["next_token"]], skip_special_tokens=True))
            fp32_next = int(model(torch.tensor([ids])).logits[0, -1].argmax())
            item.update(fp32_next_token=fp32_next,
                        fp32_next_token_text=tokenizer.decode([fp32_next], skip_special_tokens=True),
                        fp32_next_token_matches=fp32_next == item["next_token"])
            if name != "qa-short":
                prior = next(x for x in original["fixtures"] if x["name"] == name)
                assert item["next_token"] == prior["next_token"]
                assert item["last_hidden"] == prior["last_hidden"]
                assert item["logits"] == prior["logits"]
                assert item["logit_hash"] == prior["logit_hash"]
            fixtures.append(item)
            print(json.dumps({k: item[k] for k in ["name", "prompt_ids", "next_token", "next_token_text", "logit_hash"]}), flush=True)

        generations = []
        for prefix, prompt, initial in [("minimal", minimal_prompt, minimal_ids), ("qa-short", qa["prompt"], qa_ids)]:
            for limit in (1, 4):
                assert len(initial) + limit <= protocol["bounds"]["maximum_context_tokens"]
                context = initial.copy()
                steps, tokens = [], []
                for i in range(limit):
                    out = forward(context, include_trace=True)
                    nxt = out["next_token"]
                    exact_next = int(model(torch.tensor([context])).logits[0, -1].argmax())
                    steps.append({"step": i, "input_tokens": len(context), "context_ids": context.copy(),
                                  "next_token": nxt, "last_hidden": out["last_hidden"],
                                  "logit_hash": out["logit_hash"], "fp32_next_token": exact_next,
                                  "fp32_next_token_matches": nxt == exact_next})
                    tokens.append(nxt)
                    context.append(nxt)
                    if nxt == 1:
                        break
                greedy = model.generate(torch.tensor([initial]), max_new_tokens=limit, do_sample=False,
                                        eos_token_id=1, pad_token_id=0)[0, len(initial):].tolist()
                record = {"name": f"{prefix}-{limit}", "prompt": prompt, "prompt_ids": initial,
                          "maximum_new_tokens": limit, "tokens": tokens, "ended": tokens[-1] == 1,
                          "last_logit_hash": steps[-1]["logit_hash"],
                          "text": tokenizer.decode(tokens, skip_special_tokens=True), "steps": steps,
                          "fp32_greedy_tokens": greedy,
                          "fp32_greedy_text": tokenizer.decode(greedy, skip_special_tokens=True),
                          "fp32_greedy_tokens_match": greedy == tokens}
                generations.append(record)
                print(json.dumps({k: record[k] for k in ["name", "tokens", "text", "ended", "last_logit_hash", "fp32_greedy_tokens_match"]}), flush=True)

    output = {"schema_version": 1, "model": provenance["repository"], "revision": provenance["revision"],
              "actual_unique_model_parameters": protocol["parameter_count"], "quantization": "Existing INT16 Q12 export; not regenerated",
              "execution": "Offline CPU only; no chain access",
              "source_sha256": {str(p.relative_to(BASE)): sha(p) for p in [source_path, BASE / "contracts/protocol.json",
                    BASE / "contracts/SimpleStoriesV2Model.sol", BASE / "model/manifest.json", BASE / "model/weights.bin",
                    BASE / "model/tables.bin", BASE / "model-cache/model.safetensors", BASE / "qa-probe.json"]},
              "helper_sha256": sha(Path(__file__)), "prior_reference_minimal_and_attention_exact_match": True,
              "tokenizer_policy": {"add_special_tokens": False, "eos_token_id": 1, "context_limit": 16,
                                   "maximum_new_tokens": 4, "text_decoding": "Native saved WordPiece tokenizer"},
              "fixtures": fixtures, "generation_fixtures": generations,
              "limitations": ["Fixed point approximates FP32; matching this reference verifies implementation, not language quality.",
                              "Four generated tokens are capped fragments unless EOS is reached.",
                              "Existing short QA asks sky color; it is not a general question-answering benchmark."]}
    destination = OUT / "reference.json"
    destination.write_text(json.dumps(output, indent=2) + "\n")
    print(f"Wrote {destination}", flush=True)


if __name__ == "__main__":
    main()
