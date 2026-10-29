"""CPU fine-tuning from an explicitly dequantized S0UL baseline.

This owns a new model/tokenizer task. It never modifies the baseline export.
Test splits are intentionally not opened during model selection.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import random
import sys
import time

import numpy as np
import torch
from torch.nn import functional as F

from analysis_codec import BOS, EOS, FIELDS, FIRST_WORD, OFFSETS, PAD, SEP, WORDS, canonical_json, decode_words, sha256, vocabulary_spec


BASELINE_CHECKPOINT = "44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692"


def read_rows(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line]


def tensors(rows):
    length = max(len(row["prompt_ids"]) + len(row["response_ids"]) for row in rows)
    inputs = torch.zeros((len(rows), length - 1), dtype=torch.long)
    targets = torch.full_like(inputs, -100)
    for i, row in enumerate(rows):
        full = row["prompt_ids"] + row["response_ids"]
        inputs[i, :len(full) - 1] = torch.tensor(full[:-1])
        targets[i, len(row["prompt_ids"]) - 1:len(full) - 1] = torch.tensor(full[len(row["prompt_ids"]):])
    return inputs, targets


@torch.no_grad()
def generated(model, rows, batch_size=64):
    was_training = model.training
    model.eval()
    outputs = []
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        prefix = torch.tensor([row["prompt_ids"] for row in batch])
        ids = model.generate(prefix, 32, EOS)[:, prefix.size(1):].tolist()
        for output in ids:
            if EOS in output:
                output = output[:output.index(EOS) + 1]
            outputs.append(output)
    model.train(was_training)
    return outputs


@torch.no_grad()
def validation(model, rows, xy, selection_rows):
    model.eval()
    x, y = xy
    loss_sum = count = 0
    for start in range(0, len(rows), 64):
        labels = y[start:start + 64]
        loss_sum += F.cross_entropy(model(x[start:start + 64]).flatten(0, 1), labels.flatten(),
                                    reduction="sum", ignore_index=-100).item()
        count += labels.ne(-100).sum().item()
    predictions = generated(model, selection_rows)
    exact = sum(pred == row["response_ids"] for row, pred in zip(selection_rows, predictions))
    valid = 0
    for pred in predictions:
        try:
            decode_words(pred)
            valid += 1
        except ValueError:
            pass
    return {"validation_response_ce": loss_sum / count, "selection_exact_count": exact,
            "selection_examples": len(selection_rows), "selection_exact_accuracy": exact / len(selection_rows),
            "selection_format_valid_fraction": valid / len(selection_rows)}


def reconstruct_baseline(source_root, bundle):
    sys.path.insert(0, str(Path(source_root).resolve()))
    from s0ul.integer import IntegerModel
    from s0ul.model import ModelConfig, S0ULModel
    from s0ul.tokenizer import S0ULTokenizer
    integer = IntegerModel.load(bundle)
    if integer.source_checkpoint_sha256 != BASELINE_CHECKPOINT:
        raise ValueError("integer baseline checkpoint provenance mismatch")
    config = ModelConfig(**integer.config)
    if config.expected_parameters() != 984192:
        raise ValueError("the approved baseline architecture must have 984192 parameters")
    model = S0ULModel(config)
    state = {}
    for name, expected in model.state_dict().items():
        if expected.ndim == 2:
            value = integer.arrays[name + ".q"].astype(np.float64) * integer.arrays[name + ".scale_q24"][:, None] / (1 << 24)
        else:
            value = integer.arrays[name + ".q14"].astype(np.float64) / (1 << 14)
        state[name] = torch.from_numpy(value.astype(np.float32))
    model.load_state_dict(state, strict=True)
    reconstructed = IntegerModel.from_state_dict(state, integer.config)
    matched = all(np.array_equal(integer.arrays[key], reconstructed.arrays[key]) for key in integer.arrays)
    if not matched:
        raise ValueError("dequantized baseline did not round-trip to its original integer arrays")
    old = S0ULTokenizer()
    original_embeddings = state["token_embedding.weight"].clone()
    # Preserve transformer layers/norms; initialize new token meanings from the
    # old embeddings of their literal descriptions. This is an explicit remap,
    # not an assertion that old token IDs already understood the new schema.
    with torch.no_grad():
        for index, (name, values) in enumerate(FIELDS):
            for value, description in enumerate(values):
                pieces = old.encode(name + " " + description)
                model.token_embedding.weight[OFFSETS[index] + value] = original_embeddings[pieces].mean(0)
        for index, word in enumerate(WORDS):
            model.token_embedding.weight[FIRST_WORD + index] = original_embeddings[old.encode(word)].mean(0)
    manifest = json.loads((Path(bundle) / "integer-manifest.json").read_text())
    provenance = {
        "original_float_checkpoint_sha256": BASELINE_CHECKPOINT,
        "original_float_checkpoint_available": False,
        "baseline_integer_manifest_sha256": sha256((Path(bundle) / "integer-manifest.json").read_bytes()),
        "baseline_integer_payload_sha256": manifest["payload"]["sha256"],
        "baseline_integer_array_roundtrip_exact": matched,
        "initialization": "Q24 row-scale INT8 weights and Q14 gains dequantized to float32; transformer retained; new word/feature embeddings averaged from original literal-description token embeddings",
        "architecture_parameter_count": model.parameter_count(),
        "baseline_source_root": str(Path(source_root).resolve()),
        "source_sha256": {p: sha256((Path(source_root) / "s0ul" / p).read_bytes()) for p in ("model.py", "integer.py", "tokenizer.py")},
    }
    return model, provenance


def save_checkpoint(path, model, provenance, step, selection):
    torch.save({"format": "s0ul-analysis-training-v1", "config": model.config.to_dict(),
                "model_state_dict": {k: v.detach().clone() for k, v in model.state_dict().items()},
                "codec": vocabulary_spec(), "baseline_provenance": provenance,
                "step": step, "selection": selection}, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--baseline-bundle", type=Path, required=True)
    parser.add_argument("--data", type=Path, default=Path(__file__).parent / "data-v2")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "run-v2")
    parser.add_argument("--steps", type=int, default=3000)
    parser.add_argument("--seconds", type=float, default=900)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--eval-every", type=int, default=250)
    parser.add_argument("--learning-rate", type=float, default=.001)
    parser.add_argument("--seed", type=int, default=20261022)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--edge-examples-per-batch", type=int, default=8,
                        help="explicit sampler weight for the two known no-code training/regression states")
    args = parser.parse_args()
    if not 1 <= args.threads <= 4:
        raise ValueError("training is bounded to at most four CPU threads")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    if (args.output / "checkpoint.pt").exists() and not args.resume:
        raise ValueError("existing run requires explicit resume or a fresh output directory")
    model, provenance = reconstruct_baseline(args.source_root, args.baseline_bundle)
    if args.resume:
        saved = torch.load(args.resume, map_location="cpu", weights_only=True)
        if saved["codec"] != vocabulary_spec():
            raise ValueError("resume codec mismatch")
        model.load_state_dict(saved["model_state_dict"], strict=True)
        provenance["continuation_checkpoint_sha256"] = sha256(args.resume.read_bytes())
        provenance["continuation_checkpoint_step"] = saved["step"]
        provenance["continuation_optimizer"] = "fresh AdamW; optimizer-state continuation is not claimed"
    (args.output / "baseline-provenance.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    train = read_rows(args.data / "train.jsonl")
    val = read_rows(args.data / "validation.jsonl")
    train_x, train_y = tensors(train)
    val_xy = tensors(val)
    selection = random.Random(args.seed ^ 71).sample(val, 128)
    no_code_indices = [i for i, row in enumerate(train) if row["features"][0] == 0]
    if args.edge_examples_per_batch:
        if not 1 <= args.edge_examples_per_batch < args.batch_size or len(no_code_indices) != 2:
            raise ValueError("explicit edge weighting requires exactly two no-code training states and a remaining ordinary batch")
        selection += [train[i] for i in no_code_indices]
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, betas=(.9, .95), weight_decay=.01)
    best, history = None, []
    started = time.monotonic()
    for step in range(1, args.steps + 1):
        model.train()
        elapsed = time.monotonic() - started
        progress = min(1.0, elapsed / args.seconds) if args.seconds else step / args.steps
        warmup = min(1.0, step / 100)
        lr = args.learning_rate * warmup * (.1 + .9 * (1 + math.cos(math.pi * progress)) / 2)
        for group in optimizer.param_groups:
            group["lr"] = lr
        idx = torch.randint(len(train), (args.batch_size - args.edge_examples_per_batch,))
        if args.edge_examples_per_batch:
            edge = torch.tensor([no_code_indices[(step + i) % 2] for i in range(args.edge_examples_per_batch)])
            idx = torch.cat((idx, edge))
        optimizer.zero_grad(set_to_none=True)
        loss = F.cross_entropy(model(train_x[idx]).flatten(0, 1), train_y[idx].flatten(), ignore_index=-100)
        if not torch.isfinite(loss):
            raise RuntimeError("non-finite training loss")
        loss.backward()
        norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        expired = args.seconds > 0 and time.monotonic() - started >= args.seconds
        if step == 1 or step % 100 == 0:
            print(json.dumps({"step": step, "train_ce": loss.item(), "elapsed_seconds": time.monotonic() - started}), flush=True)
        if step % args.eval_every == 0 or expired or step == args.steps:
            metric = validation(model, val, val_xy, selection)
            metric.update(step=step, elapsed_seconds=time.monotonic() - started, train_ce=loss.item(), learning_rate=lr,
                          gradient_norm_before_clip=float(norm))
            score = (metric["selection_exact_count"], -metric["validation_response_ce"])
            improved = best is None or score > (best["selection_exact_count"], -best["validation_response_ce"])
            if improved:
                best = metric.copy()
                save_checkpoint(args.output / "checkpoint.pt", model, provenance, step, metric)
            metric["improved"] = improved
            history.append(metric)
            save_checkpoint(args.output / "last-checkpoint.pt", model, provenance, step, metric)
            report = {"format": "s0ul-analysis-training-report-v1", "status": "running",
                      "completed_steps": step, "observed_elapsed_seconds": time.monotonic() - started,
                      "maximum_steps": args.steps, "duration_cap_seconds": args.seconds,
                      "parameter_count": model.parameter_count(), "threads": args.threads,
                      "train_examples": len(train), "validation_examples": len(val),
                      "known_training_regression_selection_examples": 2 if args.edge_examples_per_batch else 0,
                      "validation_selection_examples": 128,
                      "no_code_training_examples_per_batch": args.edge_examples_per_batch,
                      "test_read_for_training_or_selection": False, "selection_ids": [row["id"] for row in selection],
                      "baseline_provenance": provenance, "codec": vocabulary_spec(), "best": best, "history": history,
                      "objective": "response-token supervised cross entropy on authored finite observation labels; no teacher",
                      "trainer_sha256": sha256(Path(__file__).read_bytes()),
                      "dataset_manifest_sha256": sha256((args.data / "manifest.json").read_bytes()),
                      "checkpoint_sha256": sha256((args.output / "checkpoint.pt").read_bytes()),
                      "limitations": ["Synthetic authored task; no empirical analyst, trading or security capability claim.",
                                      "Integer export and held-out evaluation must pass before use."]}
            (args.output / "training-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
            with (args.output / "training-log.jsonl").open("a") as handle:
                handle.write(json.dumps(metric, sort_keys=True) + "\n")
            print(json.dumps(metric), flush=True)
        if expired:
            break
    report["status"] = "duration_cap_reached" if expired else "step_limit_reached"
    report["observed_elapsed_seconds"] = time.monotonic() - started
    (args.output / "training-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
