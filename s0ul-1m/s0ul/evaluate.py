"""Greedy held-out action generation, separate from checkpoint selection."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import time

import torch

from .model import ModelConfig, S0ULModel
from .actions import is_valid_action
from .tokenizer import S0ULTokenizer
from .train import atomic_json, encode_record, measure_loss, read_records, sha256_file


def load_checkpoint(path):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("format") != "s0ul-training-v1":
        raise ValueError("unsupported checkpoint format")
    if checkpoint.get("tokenizer") != S0ULTokenizer().spec():
        raise ValueError("checkpoint tokenizer specification does not match the frozen current tokenizer")
    model = S0ULModel(ModelConfig(**checkpoint["config"]))
    model.load_state_dict(checkpoint["model_state_dict"], strict=True)
    return model.eval(), checkpoint


@torch.no_grad()
def evaluate_records(model, records, tokenizer, max_new_tokens=32, batch_size=16):
    if max_new_tokens <= 0 or batch_size <= 0:
        raise ValueError("max_new_tokens and batch_size must be positive")
    if not records:
        raise ValueError("evaluation records must not be empty")
    by_length = defaultdict(list)
    for index, record in enumerate(records):
        prefix = [tokenizer.bos_id] + tokenizer.encode(record["prompt"]) + [tokenizer.sep_id]
        if len(prefix) >= model.config.max_seq_len:
            raise ValueError(f"record {record['id']} leaves no context for output")
        by_length[len(prefix)].append((index, record, prefix))
    rows = [None] * len(records)
    for length in sorted(by_length):
        items = by_length[length]
        for start in range(0, len(items), batch_size):
            batch = items[start:start + batch_size]
            inputs = torch.tensor([item[2] for item in batch], dtype=torch.long)
            budget = min(max_new_tokens, model.config.max_seq_len - length)
            outputs = model.generate(inputs, budget, eos_id=tokenizer.eos_id)
            for (index, record, _), output in zip(batch, outputs):
                generated_ids = output[length:].tolist()
                terminated = tokenizer.eos_id in generated_ids
                if terminated:
                    generated_ids = generated_ids[:generated_ids.index(tokenizer.eos_id)]
                unexpected_special_tokens = any(token_id in (tokenizer.pad_id, tokenizer.bos_id, tokenizer.sep_id)
                                                for token_id in generated_ids)
                # Never silently erase generated controls: expose them in failure reports.
                prediction = tokenizer.decode(generated_ids, skip_special_tokens=False)
                format_valid = terminated and not unexpected_special_tokens and is_valid_action(prediction)
                expected = record["response"]
                action_expected = expected.split("|", 1)[0]
                action_prediction = prediction.split("|", 1)[0]
                rows[index] = {
                    "id": record["id"], "scenario": record.get("scenario"), "prompt": record["prompt"],
                    "expected": expected, "prediction": prediction,
                    "exact_match": format_valid and prediction == expected,
                    "action_type_match": not unexpected_special_tokens and action_prediction == action_expected,
                    "format_valid": format_valid,
                    "unexpected_special_tokens": unexpected_special_tokens,
                    "generated_token_ids": generated_ids,
                    "terminated_with_eos": terminated, "generated_tokens": len(generated_ids),
                }
    by_action = defaultdict(list)
    for row in rows:
        by_action[row["expected"].split("|", 1)[0]].append(row)
    summary = {
        "examples": len(rows),
        "exact_action_and_arguments_accuracy": sum(row["exact_match"] for row in rows) / len(rows),
        "action_type_accuracy": sum(row["action_type_match"] for row in rows) / len(rows),
        "format_valid_fraction": sum(row["format_valid"] for row in rows) / len(rows),
        "eos_termination_fraction": sum(row["terminated_with_eos"] for row in rows) / len(rows),
        "per_action": {action: {"examples": len(group), "exact_accuracy": sum(row["exact_match"] for row in group) / len(group)}
                       for action, group in sorted(by_action.items())},
    }
    return summary, rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--data", default="data")
    parser.add_argument("--split", choices=("validation", "test"), default="test")
    parser.add_argument("--output", default="runs/pilot/evaluation-report.json")
    parser.add_argument("--max-examples", type=int, default=0, help="0 evaluates the whole split; positive uses deterministic leading subset")
    parser.add_argument("--max-new-tokens", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads <= 0 or args.max_examples < 0:
        raise ValueError("threads must be positive and max-examples nonnegative")
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    model, checkpoint = load_checkpoint(args.checkpoint)
    path = Path(args.data) / f"{args.split}.jsonl"
    if not path.exists() and args.split == "validation":
        path = Path(args.data) / "val.jsonl"
    all_records = read_records(path, args.split)
    records = all_records[:args.max_examples] if args.max_examples else all_records
    tokenizer = S0ULTokenizer()
    started = time.monotonic()
    teacher_forced = measure_loss(model, [encode_record(row, tokenizer, model.config.max_seq_len) for row in records], tokenizer.pad_id, args.batch_size)
    summary, rows = evaluate_records(model, records, tokenizer, args.max_new_tokens, args.batch_size)
    report = {
        "status": "local_synthetic_held_out_evaluation", "split": args.split,
        "split_total_examples": len(all_records), "evaluated_entire_split": len(records) == len(all_records),
        "checkpoint_sha256": sha256_file(args.checkpoint), "dataset_sha256": sha256_file(path),
        "tokenizer": tokenizer.spec(),
        "selected_training_step": checkpoint["training"]["step"],
        "decoding": {"method": "greedy_argmax", "max_new_tokens": args.max_new_tokens, "batch_size": args.batch_size},
        "teacher_forced": teacher_forced, "generation": summary,
        "elapsed_seconds": time.monotonic() - started,
        "limitations": ["Narrow synthetic action benchmark; no broad language, security or trading claim",
                        "Schema-shaped output does not grant authority or execute an action",
                        "Float32 reference, not on-chain inference"],
        "predictions": rows,
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, report)
    print(json.dumps({"output": args.output, "generation": summary, "elapsed_seconds": report["elapsed_seconds"]}), flush=True)


if __name__ == "__main__":
    main()
