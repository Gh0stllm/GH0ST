"""Reproducible supervised CPU pilot; no external teacher or chain calls."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import random
import time

import torch
from torch.nn import functional as F

from .model import ModelConfig, S0ULModel
from .tokenizer import S0ULTokenizer


def read_records(path, expected_split=None):
    path = Path(path)
    records = []
    with path.open(encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            if not isinstance(record.get("prompt"), str) or not isinstance(record.get("response"), str):
                raise ValueError(f"{path}:{line_no}: prompt and response must be strings")
            if expected_split is not None and record.get("split") != expected_split:
                # Validation is sometimes written as 'val'; permit only this alias.
                if not (expected_split == "validation" and record.get("split") == "val"):
                    raise ValueError(f"{path}:{line_no}: unexpected split {record.get('split')!r}")
            records.append(record)
    if not records:
        raise ValueError(f"empty dataset: {path}")
    if len({record["id"] for record in records}) != len(records):
        raise ValueError(f"duplicate record IDs in {path}")
    return records


def encode_record(record, tokenizer, max_seq_len):
    prefix = [tokenizer.bos_id] + tokenizer.encode(record["prompt"]) + [tokenizer.sep_id]
    target = tokenizer.encode(record["response"]) + [tokenizer.eos_id]
    sequence = prefix + target
    if len(sequence) > max_seq_len + 1:
        raise ValueError(f"record {record['id']} requires {len(sequence)-1} input tokens, context={max_seq_len}; not truncated")
    if not target or not prefix:
        raise ValueError("empty encoded record")
    return sequence[:-1], [-100] * (len(prefix) - 1) + target


def make_batch(encoded, indices, pad_id):
    length = max(len(encoded[index][0]) for index in indices)
    x = torch.full((len(indices), length), pad_id, dtype=torch.long)
    y = torch.full((len(indices), length), -100, dtype=torch.long)
    for row, index in enumerate(indices):
        inputs, targets = encoded[index]
        x[row, :len(inputs)] = torch.tensor(inputs)
        y[row, :len(targets)] = torch.tensor(targets)
    return x, y


@torch.no_grad()
def measure_loss(model, encoded, pad_id=0, batch_size=32):
    was_training = model.training
    model.eval()
    total_loss, tokens, correct = 0.0, 0, 0
    try:
        for start in range(0, len(encoded), batch_size):
            x, y = make_batch(encoded, list(range(start, min(start + batch_size, len(encoded)))), pad_id)
            logits = model(x)
            valid = y.ne(-100)
            total_loss += F.cross_entropy(logits.flatten(0, 1), y.flatten(), ignore_index=-100, reduction="sum").item()
            tokens += int(valid.sum())
            correct += int((logits.argmax(-1).eq(y) & valid).sum())
        return {"response_cross_entropy": total_loss / tokens, "response_tokens": tokens,
                "teacher_forced_token_accuracy": correct / tokens}
    finally:
        model.train(was_training)


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def train(args):
    if args.steps <= 0 or args.batch_size <= 0 or args.threads <= 0 or args.eval_every <= 0:
        raise ValueError("steps, batch size, threads and eval interval must be positive")
    if not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        raise ValueError("learning rate must be positive and finite")
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    data_path, output = Path(args.data), Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    if (output / "checkpoint.pt").exists() and not args.overwrite:
        raise ValueError("output already has checkpoint.pt; choose another output or pass --overwrite")
    train_path = data_path / "train.jsonl"
    validation_path = data_path / "validation.jsonl"
    if not validation_path.exists():
        validation_path = data_path / "val.jsonl"
    training = read_records(train_path, "train")
    validation = read_records(validation_path, "validation")
    if {item["id"] for item in training} & {item["id"] for item in validation}:
        raise ValueError("training and validation IDs overlap")
    if {item["prompt"] for item in training} & {item["prompt"] for item in validation}:
        raise ValueError("training and validation prompts overlap")
    config = ModelConfig()
    tokenizer = S0ULTokenizer()
    train_encoded = [encode_record(record, tokenizer, config.max_seq_len) for record in training]
    val_encoded = [encode_record(record, tokenizer, config.max_seq_len) for record in validation]
    model = S0ULModel(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
    started = time.monotonic()
    baseline = measure_loss(model, val_encoded, tokenizer.pad_id, args.batch_size)
    history = []
    best_loss = math.inf
    best_step = 0
    best_metrics = None
    metadata = {
        "status": "local_supervised_pilot", "model": "GH0ST S0UL-1M",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed, "requested_steps": args.steps, "batch_size": args.batch_size,
        "threads": args.threads, "learning_rate": args.learning_rate,
        "train_examples": len(training), "validation_examples": len(validation),
        "parameter_count": model.parameter_count(), "config": config.to_dict(),
        "tokenizer": tokenizer.spec(),
        "training_data_sha256": sha256_file(train_path),
        "validation_data_sha256": sha256_file(validation_path),
        "torch_version": str(torch.__version__), "device": "cpu",
        "objective": "response-token supervised cross entropy; no teacher distillation",
        "baseline_validation": baseline, "test_used_for_selection": False,
        "limitations": ["Synthetic constrained action dataset, not broad language or agent validation",
                        "Floating-point CPU training, not fixed-point/EVM inference", "No public-chain deployment"],
    }
    print(json.dumps({"event": "started", "parameters": model.parameter_count(), "baseline_validation": baseline}), flush=True)
    log_path = output / "training-log.jsonl"
    with log_path.open("w", encoding="utf-8") as log:
        for step in range(1, args.steps + 1):
            model.train()
            indices = [rng.randrange(len(train_encoded)) for _ in range(args.batch_size)]
            x, y = make_batch(train_encoded, indices, tokenizer.pad_id)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = F.cross_entropy(logits.flatten(0, 1), y.flatten(), ignore_index=-100)
            if not bool(torch.isfinite(loss)):
                raise RuntimeError(f"non-finite training loss at step {step}")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            if step % args.eval_every == 0 or step == args.steps:
                metrics = measure_loss(model, val_encoded, tokenizer.pad_id, args.batch_size)
                entry = {"step": step, "train_batch_loss": loss.item(), "validation": metrics,
                         "elapsed_seconds": time.monotonic() - started}
                history.append(entry)
                line = json.dumps(entry)
                log.write(line + "\n")
                log.flush()
                print(line, flush=True)
                if metrics["response_cross_entropy"] < best_loss:
                    best_loss, best_step, best_metrics = metrics["response_cross_entropy"], step, metrics
                    checkpoint = {
                        "format": "s0ul-training-v1", "config": config.to_dict(),
                        "model_state_dict": {name: value.detach().cpu().clone() for name, value in model.state_dict().items()},
                        "training": {"step": step, "seed": args.seed, "validation": metrics,
                                     "training_data_sha256": metadata["training_data_sha256"],
                                     "validation_data_sha256": metadata["validation_data_sha256"]},
                        "tokenizer": tokenizer.spec(),
                    }
                    temporary = output / "checkpoint.pt.tmp"
                    torch.save(checkpoint, temporary)
                    temporary.replace(output / "checkpoint.pt")
                atomic_json(output / "progress.json", {**metadata, "completed_steps": step, "best_step": best_step,
                            "best_validation": best_metrics, "history": history})
    report = {**metadata, "completed_steps": args.steps, "best_step": best_step,
              "best_validation": best_metrics, "history": history,
              "elapsed_seconds": time.monotonic() - started,
              "checkpoint_sha256": sha256_file(output / "checkpoint.pt")}
    atomic_json(output / "training-report.json", report)
    print(json.dumps({"event": "complete", "best_step": best_step, "checkpoint": str(output / "checkpoint.pt"),
                      "elapsed_seconds": report["elapsed_seconds"]}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="data")
    parser.add_argument("--output", default="runs/pilot")
    parser.add_argument("--steps", type=int, default=500)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--eval-every", type=int, default=100)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--overwrite", action="store_true")
    train(parser.parse_args())


if __name__ == "__main__":
    main()
