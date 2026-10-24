"""Bounded local-only decoding experiment. Does not change any default decoder.

Uses the frozen expanded checkpoint's exported Q12 tensors. Tests standard
recent-token repetition penalty and whole-history no-repeat trigrams. These
controls only alter next-token selection; there is no phrase catalog or model
update. No EVM or network calls are made.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from transformers import AutoTokenizer
from quantize_eval import BASE, Relative64, get_draws, logit_hashes, TERMINALS

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "continuous-expanded"
OUT = HERE / "continuous-expanded-decoder-probe"


def adjusted_logits(logits, history, repetition, no_repeat):
    adjusted = logits.copy()
    if repetition:
        # Exactly 1.10 as a rational, with signed truncation toward zero.
        for token in set(history[-32:]):
            value = int(adjusted[token])
            adjusted[token] = value * 10 // 11 if value >= 0 else -((-value) * 11 // 10)
    banned = {0}
    if no_repeat and len(history) >= 2:
        tail = tuple(history[-2:])
        for i in range(len(history) - 2):
            if tuple(history[i:i + 2]) == tail:
                banned.add(history[i + 2])
    return adjusted, banned


def sample(model, logits, draw, banned):
    order = np.argsort(-logits, kind="stable")
    order = np.asarray([int(token) for token in order if int(token) not in banned][:8], dtype=np.int64)
    assert len(order) > 0
    weights = model.interpolate(model.exp, (logits[order[0]] - logits[order]) * 1000 // 800, 0)
    pick = draw % int(weights.sum())
    for token, weight in zip(order, weights):
        if pick < weight:
            return int(token)
        pick -= int(weight)
    raise AssertionError("No sample selected")


def main():
    started = time.monotonic()
    OUT.mkdir(exist_ok=True)
    meta = json.loads((SOURCE / "quantization-report.json").read_text())
    blob = (SOURCE / "model/weights.bin").read_bytes()
    assert hashlib.sha256(blob).hexdigest() == meta["weights_sha256"]
    layout = json.loads((BASE / "contracts/protocol.json").read_text())["weights"]["tensor_layout"]
    tensors = {row["name"]: np.frombuffer(blob, dtype=">i2", offset=row["byte_offset"], count=row["elements"]).astype(np.int64).reshape(row["shape"]) for row in layout}
    tokenizer = AutoTokenizer.from_pretrained(BASE / "model-cache", local_files_only=True)
    seeds = [42, 0]
    draws = get_draws(seeds, 150)
    frozen = json.loads((SOURCE / "q12-continuity-comparison.json").read_text())
    report = {"schema_version": 1, "scope": "Offline reference-only decoding controls; no EVM test, weight update, or deployment",
              "checkpoint_sha256": meta["checkpoint_sha256"], "weights_sha256": meta["weights_sha256"],
              "tokens_per_run": 150, "seeds": seeds, "top_k": 8, "temperature_milli": 800,
              "repetition_penalty": "1.10 applied once per unique token in latest32 consumed tokens; positive logits divide, negative multiply, signed truncation",
              "ngram_rule": "Disallow next tokens which would repeat any exact token trigram anywhere in the current history",
              "limitations": ["Repetition counters are diagnostics, not measures of coherence or quality.",
                              "The controls require implementation and separate parity/gas tests before any on-chain adoption.",
                              "Only two fixed seeds per variant; all outputs retained, no selection."], "runs": []}
    variants = [("unchanged", False, False), ("penalty-1.10-recent32", True, False),
                ("no-repeat-trigram", False, True), ("penalty-and-no-repeat-trigram", True, True)]
    for name, repetition, no_repeat in variants:
        for seed, seed_draws in zip(seeds, draws):
            state = Relative64(tensors)
            pending = 3
            generated, turns, raw_hash_rows = [], [], []
            banned_steps = 0
            while len(generated) < 150:
                before = len(state.tokens)
                maximum = min(2 if before <= 26 else 1, 150 - len(generated))
                out = []
                for _ in range(maximum):
                    raw = state.append(pending)
                    raw_hash_rows.append(raw)
                    adjusted, banned = adjusted_logits(raw, state.tokens, repetition, no_repeat)
                    banned_steps += int(len(banned) > 1)
                    pending = sample(state, adjusted, seed_draws[len(generated)], banned)
                    generated.append(pending)
                    out.append(pending)
                    if pending in TERMINALS:
                        break
                turns.append({"turn": len(turns) + 1, "processed_before": before, "processed_after": len(state.tokens),
                              "tokens": out, "text": tokenizer.decode(out, skip_special_tokens=True),
                              "ended_eos": pending == 1, "ended_sentence": pending in {2, 15, 30}})
            hashes = logit_hashes(raw_hash_rows)
            if name == "unchanged":
                expected = next(row for row in frozen["runs"] if row["model"] == "tuned" and row["seed"] == seed)
                assert generated == expected["generated_tokens"]
                assert hashes == expected["every_step_logit_hash"]
            grams = Counter(tuple(generated[i:i + 4]) for i in range(len(generated) - 3))
            trigrams = Counter(tuple(generated[i:i + 3]) for i in range(len(generated) - 2))
            if no_repeat:
                assert max(trigrams.values()) == 1
            row = {"variant": name, "seed": seed, "tokens": generated,
                   "text": tokenizer.decode([3] + generated, skip_special_tokens=True), "turns": turns,
                   "every_step_raw_logit_hash": hashes, "steps_with_trigram_bans": banned_steps,
                   "repeated_token_4gram_fraction": sum(n - 1 for n in grams.values()) / (len(generated) - 3),
                   "maximum_token_trigram_occurrences": max(trigrams.values()),
                   "maximum_absolute_linear_input": state.maximum_linear_input,
                   "signed17_violations": state.linear_input_bound_violations}
            report["runs"].append(row)
            print(json.dumps({key: row[key] for key in ["variant", "seed", "repeated_token_4gram_fraction", "text"]}), flush=True)
    report["variant_summary"] = [{"variant": name, "mean_repeated_token_4gram_fraction": sum(row["repeated_token_4gram_fraction"] for row in report["runs"] if row["variant"] == name) / len(seeds)} for name, _, _ in variants]
    report["elapsed_seconds"] = round(time.monotonic() - started, 3)
    (OUT / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (OUT / "transcripts.txt").write_text("\n\n".join(f"{row['variant']} / seed {row['seed']}\n{row['text']}" for row in report["runs"]) + "\n")
    print(json.dumps({"summary": report["variant_summary"], "elapsed_seconds": report["elapsed_seconds"]}), flush=True)


if __name__ == "__main__":
    main()
