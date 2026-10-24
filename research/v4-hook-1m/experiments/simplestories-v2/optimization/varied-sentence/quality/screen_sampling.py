"""Offline seeded decoding study. Original model, checkpoint and reference stay unchanged."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import sys
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
sys.dont_write_bytecode = True
import numpy as np

OUT = Path(__file__).resolve().parent
REFERENCE = OUT.parents[1] / "full-sentence/quality/screen.py"
spec = importlib.util.spec_from_file_location("unchanged_sentence_reference", REFERENCE)
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
tokenizer = reference.tokenizer
TERMINALS = {1, 2, 15, 30}
PUNCTUATION = [2, 15, 30]
CAP = 4
MODEL = reference.BASE


def stable_seed(prompt: list[int], seed: int) -> int:
    # Domain separation ensures equal integer seeds do not couple different prompts.
    data = json.dumps(["GH0ST_OFFLINE_VARIETY_V1", prompt, seed], separators=(",", ":")).encode()
    return int.from_bytes(hashlib.sha256(data).digest(), "big")


class Predictor:
    def __init__(self):
        self.cache = {}
        self.calls = 0
        self.hits = 0
        self.started = time.monotonic()

    def __call__(self, context):
        key = tuple(context)
        if key in self.cache:
            self.hits += 1
            return self.cache[key]
        out = reference.forward(list(context))
        logits = np.asarray(out["logits"], dtype=np.int64)
        # Retain enough scores for every planned top-k setting and all real stop tokens.
        # Stable sorting breaks ties by the original token id, matching argmax.
        order = np.argsort(-logits, kind="stable")[:64]
        scores = {int(i): int(logits[i]) for i in order}
        for i in TERMINALS:
            scores[i] = int(logits[i])
        row = {"top_ids": list(map(int, order)), "scores": scores,
               "top_token": int(out["next_token"]),
               "punctuation_rank": {str(i): int(np.count_nonzero(logits > logits[i])) + 1 for i in PUNCTUATION}}
        self.cache[key] = row
        self.calls += 1
        if self.calls % 250 == 0:
            print(f"computed {self.calls} unique prefix states in {time.monotonic()-self.started:.1f}s", flush=True)
        return row

    def save(self):
        records = [{"context_ids": list(key), **value} for key, value in self.cache.items()]
        (OUT / "prefix-score-cache.json").write_text(json.dumps(records, separators=(",", ":")) + "\n")


def sample(row, k, temperature, rng, allowed=None):
    if allowed is None:
        candidates = [x for x in row["top_ids"] if x != 0][:k]
    else:
        candidates = sorted(allowed, key=lambda i: (-row["scores"][i], i))[:k]
    assert candidates
    if temperature == 0:
        return candidates[0]
    maximum = max(row["scores"][x] for x in candidates)
    weights = [math.exp((row["scores"][x]-maximum)/(reference.Q*temperature)) for x in candidates]
    needle = rng.random() * sum(weights)
    cumulative = 0.0
    for token, weight in zip(candidates, weights):
        cumulative += weight
        if needle < cumulative:
            return token
    return candidates[-1]


def generate(predict, prompt, seed, k, temperature, constrained, cap=CAP):
    rng = random.Random(stable_seed(prompt, seed))
    generated, decisions = [], []
    for step in range(cap):
        context = prompt + generated
        row = predict(context)
        allowed = PUNCTUATION if constrained and step == cap-1 else None
        token = sample(row, k, temperature, rng, allowed)
        natural_top_k = [i for i in row["top_ids"] if i != 0][:k]
        decisions.append({"token": token, "logit": row["scores"][token],
            "model_argmax": row["top_token"], "forced_punctuation_step": allowed is not None,
            "selected_token_in_unconstrained_top_k": token in natural_top_k,
            "punctuation_rank": row["punctuation_rank"].get(str(token))})
        generated.append(token)
        if token in TERMINALS:
            break
    valid_hook_ending = (2 <= len(generated) <= cap and generated[-1] in TERMINALS
                         and any(x not in TERMINALS and x != 0 for x in generated[:-1]))
    return {"seed": seed, "tokens": generated,
        "text": tokenizer.decode(generated, skip_special_tokens=True),
        "combined": tokenizer.decode(prompt+generated, skip_special_tokens=True),
        "naturally_terminated": generated[-1] in TERMINALS and not decisions[-1]["forced_punctuation_step"],
        "constrained_terminal": decisions[-1]["forced_punctuation_step"],
        "hook_ending_valid": valid_hook_ending,
        "decisions": decisions}


def summarize(rows):
    completed = [r for r in rows if r["hook_ending_valid"]]
    counts = {}
    for row in rows:
        counts[row["text"]] = counts.get(row["text"], 0) + 1
    examples = sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    return {"samples": len(rows), "unique_outputs": len(counts),
        "valid_hook_endings": len(completed),
        "unique_valid_endings": len({r["text"] for r in completed}),
        "naturally_terminated": sum(r["naturally_terminated"] for r in rows),
        "constrained_terminal": sum(r["constrained_terminal"] for r in rows),
        "dominant_output_fraction": max(counts.values()) / len(rows),
        "examples": [{"text": text, "count": count} for text, count in examples]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=64)
    parser.add_argument("--prompts", default=':,Because,",I,We,It,He,She,They,Everyone,Hello,Yes,No,But,And,Then,Now,Today')
    parser.add_argument("--top-k", default="2,4,8")
    parser.add_argument("--temperatures", default="0.4,0.7,1.0")
    args = parser.parse_args()
    assert 1 <= args.seeds <= 2048
    predictor = Predictor()
    targets = []
    for text in args.prompts.split(","):
        ids = tokenizer.encode(text, add_special_tokens=False)
        if len(ids) != 1:
            continue
        targets.append((text, ids))
    results = {"schema_version": 1, "scope": "Offline only; no chain, wallet, training or checkpoint changes.",
        "model": "SimpleStories/SimpleStories-V2-1.25M", "parameters": 1235968,
        "weights_sha256": hashlib.sha256(reference.blob).hexdigest(),
        "reference_sha256": hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
        "maximum_new_tokens": CAP, "seed_domain": "GH0ST_OFFLINE_VARIETY_V1",
        "sampler": "Top-k of all Q12 vocabulary logits (UNK removed), float exp(logit/(4096*T)), SHA256-seeded Python Random.",
        "constrained_sampler": "Same sampler, but final fourth step is limited to actual punctuation tokens ! . ?. No character is appended after inference.",
        "limitations": ["This Python sampler is an offline feasibility study, not yet a bit-identical Solidity sampler.",
            "A terminal token and syntactically complete English sentence are different measurements.",
            "A constrained ending can hide a grammatical fragment; examples require manual review.",
            "Random seeds do not guarantee a previously unseen output and there is no corpus novelty audit."],
        "cases": []}
    all_rows = []
    settings = [(1, 0.0)] + [(int(k), float(t)) for k in args.top_k.split(",") for t in args.temperatures.split(",")]
    for text, ids in targets:
        for k, temperature in settings:
            for constrained in [False, True]:
                if k == 1 and constrained:
                    continue
                seeds = range(1) if k == 1 else range(args.seeds)
                rows = [generate(predictor, ids, seed, k, temperature, constrained) for seed in seeds]
                case = {"prompt": text, "prompt_ids": ids, "top_k": k, "temperature": temperature,
                    "constrained_final_punctuation": constrained, **summarize(rows)}
                results["cases"].append(case)
                all_rows.append({k:case[k] for k in ["prompt","prompt_ids","top_k","temperature","constrained_final_punctuation"]} | {"rows": rows})
        print(json.dumps({"finished_prompt": text, "unique_prefixes": predictor.calls}), flush=True)
        results["unique_prefix_evaluations"] = predictor.calls
        results["prefix_cache_hits"] = predictor.hits
        (OUT / "sampling-screen.json").write_text(json.dumps(results, indent=2) + "\n")
        (OUT / "sampling-rows.json").write_text(json.dumps(all_rows, separators=(",", ":")) + "\n")
        predictor.save()
    results["elapsed_seconds"] = round(time.monotonic()-predictor.started, 3)
    results["status"] = "COMPLETE"
    (OUT / "sampling-screen.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps({"status":"COMPLETE","cases":len(results["cases"]),"prefix_evaluations":predictor.calls,"elapsed_seconds":results["elapsed_seconds"]}), flush=True)


if __name__ == "__main__":
    main()
