"""Validation-selected supervised training with a resumable CPU optimizer.

The public CLI keeps the frozen 984,192-parameter architecture and tokenizer.
No test split, pretrained teacher or public-chain service is read or called.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import heapq
import math
from pathlib import Path
import random
import time

import torch
from torch.nn import functional as F

from .actions import is_valid_action
from .evaluate import evaluate_records, load_checkpoint
from .model import ModelConfig, S0ULModel
from .tokenizer import S0ULTokenizer
from .train import atomic_json, encode_record, make_batch, measure_loss, read_records, sha256_file


STATE_FORMAT = "s0ul-advanced-training-state-v1"
SELECTION_RULE = "validation greedy exact action+arguments count; lower full-validation response CE breaks ties"


def learning_rate_for_step(step, total_steps, warmup_steps, peak_lr, min_lr_ratio):
    """One-indexed schedule; warmup and final minimum are explicit."""
    if not 1 <= step <= total_steps:
        raise ValueError("schedule step outside 1..total_steps")
    if warmup_steps and step <= warmup_steps:
        return peak_lr * step / warmup_steps
    progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
    return peak_lr * (min_lr_ratio + (1 - min_lr_ratio) * 0.5 * (1 + math.cos(math.pi * progress)))


def learning_rate_for_elapsed(elapsed_seconds, duration_seconds, warmup_seconds, peak_lr, min_lr_ratio):
    """Cosine schedule over observed run walltime, including validation time."""
    elapsed_seconds = max(0.0, min(elapsed_seconds, duration_seconds))
    if warmup_seconds and elapsed_seconds < warmup_seconds:
        return peak_lr * elapsed_seconds / warmup_seconds
    progress = (elapsed_seconds - warmup_seconds) / max(1e-12, duration_seconds - warmup_seconds)
    return peak_lr * (min_lr_ratio + (1 - min_lr_ratio) * 0.5 * (1 + math.cos(math.pi * progress)))


def balanced_selection(records, requested, seed):
    """Freeze a reproducible, approximately class-balanced validation subset."""
    groups = {}
    for record in records:
        groups.setdefault(record["response"].split("|", 1)[0], []).append(record)
    if requested and requested < len(groups):
        raise ValueError("selection-examples must cover every validation action class")
    rng = random.Random(seed)
    for action in sorted(groups):
        rng.shuffle(groups[action])
    maximum = min(requested or len(records), len(records))
    selected, indices = [], {action: 0 for action in groups}
    while len(selected) < maximum:
        for action in sorted(groups):
            if indices[action] < len(groups[action]) and len(selected) < maximum:
                selected.append(groups[action][indices[action]])
                indices[action] += 1
    return selected


def make_optimizer(model, learning_rate, weight_decay):
    """Do not decay learned normalization gains (or any one-dimensional tensor)."""
    decay, no_decay = [], []
    for parameter in model.parameters():
        (decay if parameter.ndim >= 2 else no_decay).append(parameter)
    return torch.optim.AdamW([
        {"params": decay, "weight_decay": weight_decay},
        {"params": no_decay, "weight_decay": 0.0},
    ], lr=learning_rate, betas=(0.9, 0.95), eps=1e-8)



class HardReplay:
    """Bounded replay of difficult *training* examples with uniform coverage.

    Scores are EMA per-response-token unsmoothed cross entropy from examples
    already visited by the optimizer. The ranked pool refreshes at evaluation
    boundaries, but never reads validation predictions or labels. At most half
    of every batch comes from this pool; all remaining draws are uniform.
    """
    def __init__(self, count, fraction=0.0, size=2048):
        self.count, self.fraction, self.size = count, fraction, size
        self.scores = [None] * count
        self.pool = []

    def sample(self, rng, batch_size):
        hard_count = min(batch_size // 2, int(batch_size * self.fraction)) if self.pool else 0
        return ([rng.randrange(self.count) for _ in range(batch_size - hard_count)] +
                [self.pool[rng.randrange(len(self.pool))] for _ in range(hard_count)])

    def observe(self, indices, losses):
        for index, loss in zip(indices, losses):
            loss = float(loss)
            if not math.isfinite(loss) or loss < 0:
                raise ValueError("hard replay scores must be finite nonnegative training losses")
            previous = self.scores[index]
            self.scores[index] = loss if previous is None else 0.9 * previous + 0.1 * loss

    def refresh(self):
        # Stable index tie-breaks make ordering reproducible across resumes.
        seen = (index for index, score in enumerate(self.scores) if score is not None)
        self.pool = heapq.nlargest(min(self.size, self.count), seen,
                                 key=lambda index: (self.scores[index], -index))

    def state_dict(self):
        return {"scores": self.scores, "pool": self.pool}

    def load_state_dict(self, state):
        if len(state["scores"]) != self.count:
            raise ValueError("hard replay state size differs from training data")
        self.scores, self.pool = state["scores"], state["pool"]


def response_losses(logits, targets):
    """Unsmoothed CE per example, excluding all prompt and padding positions."""
    token_losses = F.cross_entropy(logits.detach().flatten(0, 1), targets.flatten(),
                                   ignore_index=-100, reduction="none").reshape_as(targets)
    counts = targets.ne(-100).sum(dim=1)
    if bool(counts.eq(0).any()):
        raise ValueError("every training example must have a supervised response")
    return token_losses.sum(dim=1) / counts


def _source_hashes():
    root = Path(__file__).parent
    return {name: sha256_file(root / name) for name in (
        "train_advanced.py", "train.py", "model.py", "tokenizer.py", "actions.py", "evaluate.py"
    )}


def _save_torch(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(value, temporary)
    temporary.replace(path)


def _clone_state(model):
    return {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}


def _validate_args(args):
    for name in ("steps", "batch_size", "threads", "eval_every"):
        if type(getattr(args, name)) is not int or getattr(args, name) <= 0:
            raise ValueError(f"{name} must be a positive integer")
    for name in ("seed", "warmup_steps", "selection_examples", "patience"):
        if type(getattr(args, name)) is not int or getattr(args, name) < 0:
            raise ValueError(f"{name} must be a nonnegative integer")
    if args.warmup_steps >= args.steps:
        raise ValueError("warmup-steps must be smaller than total steps")
    if not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        raise ValueError("learning-rate must be positive and finite")
    if not math.isfinite(args.min_lr_ratio) or not 0 <= args.min_lr_ratio <= 1:
        raise ValueError("min-lr-ratio must lie in [0,1]")
    if not math.isfinite(args.weight_decay) or args.weight_decay < 0:
        raise ValueError("weight-decay must be nonnegative and finite")
    if not math.isfinite(args.label_smoothing) or not 0 <= args.label_smoothing < 1:
        raise ValueError("label-smoothing must lie in [0,1)")
    if not math.isfinite(args.hard_replay_fraction) or not 0 <= args.hard_replay_fraction <= 0.5:
        raise ValueError("hard-replay-fraction must lie in [0,0.5]")
    if type(args.hard_replay_size) is not int or args.hard_replay_size <= 0:
        raise ValueError("hard-replay-size must be a positive integer")
    if args.init_checkpoint and args.resume:
        raise ValueError("init-checkpoint and resume are mutually exclusive")
    if type(args.max_run_steps) is not int or args.max_run_steps < 0:
        raise ValueError("max-run-steps must be a nonnegative integer")
    if not math.isfinite(args.duration_seconds) or args.duration_seconds < 0:
        raise ValueError("duration-seconds must be nonnegative and finite")
    if not math.isfinite(args.warmup_seconds) or args.warmup_seconds < 0:
        raise ValueError("warmup-seconds must be nonnegative and finite")
    if args.duration_seconds and args.warmup_seconds >= args.duration_seconds:
        raise ValueError("warmup-seconds must be smaller than the duration budget")
    if args.duration_seconds and args.patience:
        raise ValueError("duration training requires --patience 0 to prevent early budget termination")


def run_training(args, *, model_config=None, stop_after=None):
    """Train with validation-only selection.

    ``model_config`` and ``stop_after`` are programmatic test hooks. The CLI
    exposes neither architecture changes nor an alternate parameter budget.
    A clean test interruption saves the same optimizer state as an evaluation
    boundary; normal process interruption resumes from the last durable file.
    """
    _validate_args(args)
    if stop_after is not None and (type(stop_after) is not int or stop_after <= 0):
        raise ValueError("stop_after must be a positive integer")
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    sampler = random.Random(args.seed)
    tokenizer = S0ULTokenizer()
    config = model_config or ModelConfig()
    if config.vocab_size != tokenizer.vocab_size:
        raise ValueError("model vocabulary must match the frozen tokenizer")
    output, data = Path(args.output), Path(args.data)
    output.mkdir(parents=True, exist_ok=True)
    if not args.resume and any((output / name).exists() for name in (
            "checkpoint.pt", "last-training-state.pt", "training-report.json")):
        raise ValueError("output already contains a run; use a new output or --resume")
    train_path = data / "train.jsonl"
    validation_path = data / "validation.jsonl"
    if not validation_path.exists():
        validation_path = data / "val.jsonl"
    hashes = {"train": sha256_file(train_path), "validation": sha256_file(validation_path)}
    training = read_records(train_path, "train")
    validation = read_records(validation_path, "validation")
    if hashes != {"train": sha256_file(train_path), "validation": sha256_file(validation_path)}:
        raise ValueError("dataset changed while being read")
    if {row["id"] for row in training} & {row["id"] for row in validation}:
        raise ValueError("training and validation IDs overlap")
    if {row["prompt"] for row in training} & {row["prompt"] for row in validation}:
        raise ValueError("training and validation prompts overlap")
    if any(not is_valid_action(row["response"]) for row in training + validation):
        raise ValueError("training or validation label violates the frozen action grammar")
    encoded = [encode_record(row, tokenizer, config.max_seq_len) for row in training]
    val_encoded = [encode_record(row, tokenizer, config.max_seq_len) for row in validation]
    selection = balanced_selection(validation, args.selection_examples, args.seed + 1009)
    run_config = {name: getattr(args, name) for name in (
        "steps", "batch_size", "threads", "seed", "eval_every", "learning_rate",
        "min_lr_ratio", "warmup_steps", "weight_decay", "selection_examples", "patience",
        "duration_seconds", "warmup_seconds", "label_smoothing",
        "hard_replay_fraction", "hard_replay_size"
    )}
    run_config.update(gradient_clip_norm=1.0, adam_betas=[0.9, 0.95], adam_epsilon=1e-8,
                      selection_max_new_tokens=32)
    identity = {"config": config.to_dict(), "tokenizer": tokenizer.spec(),
                "dataset_sha256": hashes, "run_config": run_config,
                "selection_ids": [row["id"] for row in selection], "source_sha256": _source_hashes(),
                "torch_version": str(torch.__version__)}
    model = S0ULModel(config)
    init_hash = None
    if args.init_checkpoint:
        initialized, _ = load_checkpoint(args.init_checkpoint)
        if initialized.config != config:
            raise ValueError("initial checkpoint architecture differs from this run")
        model.load_state_dict(initialized.state_dict(), strict=True)
        init_hash = sha256_file(args.init_checkpoint)
    optimizer = make_optimizer(model, args.learning_rate, args.weight_decay)
    replay = HardReplay(len(encoded), args.hard_replay_fraction, args.hard_replay_size)
    counters = {"completed_steps": 0, "examples_seen": 0, "input_tokens_seen": 0,
                "response_tokens_seen": 0, "evaluations_without_improvement": 0}
    window = {"loss_sum": 0.0, "response_tokens": 0}
    timings = {"optimizer_compute_seconds": 0.0, "validation_seconds": 0.0, "checkpoint_seconds": 0.0}
    history, best_checkpoint, best = [], None, None
    metadata = {"model": "GH0ST S0UL-1M", "created_utc": datetime.now(timezone.utc).isoformat(),
                "parameter_count": model.parameter_count(), "train_examples": len(training),
                "validation_examples": len(validation), "selection_examples": len(selection),
                "initial_checkpoint_sha256": init_hash,
                "objective": "response-token supervised cross entropy; no distillation",
                "label_smoothing": args.label_smoothing,
                "sampling": {"hard_replay_fraction": args.hard_replay_fraction,
                             "hard_replay_size": args.hard_replay_size,
                             "score": "observed training response CE, EMA 0.9",
                             "refresh_steps": args.eval_every,
                             "uniform_fraction_lower_bound": 1 - args.hard_replay_fraction},
                "schedule_basis": "observed_run_walltime" if args.duration_seconds else "optimizer_steps",
                "selection_rule": SELECTION_RULE, "test_read_or_used_for_selection": False,
                "device": "cpu", "identity": identity,
                "limitations": ["Synthetic domain training, not broad intelligence or deployment evidence",
                                "Validation is repeatedly used for selection; final test must remain independent"]}
    elapsed_before = 0.0
    if args.resume:
        saved = torch.load(args.resume, map_location="cpu", weights_only=True)
        if saved.get("format") != STATE_FORMAT or saved.get("identity") != identity:
            raise ValueError("resume state identity mismatch: dataset, tokenizer, source, schedule or runtime changed")
        model.load_state_dict(saved["model_state_dict"], strict=True)
        optimizer.load_state_dict(saved["optimizer_state_dict"])
        counters, history, best, best_checkpoint = saved["counters"], saved["history"], saved["best"], saved["best_checkpoint"]
        window = saved["window"]
        replay.load_state_dict(saved["hard_replay"])
        timings = saved["timings"]
        metadata, elapsed_before = saved["metadata"], saved["elapsed_seconds"]
        sampler.setstate(saved["rng_state"]["python_sampler"])
        random.setstate(saved["rng_state"]["python_global"])
        torch.set_rng_state(saved["rng_state"]["torch"])
        if not 0 <= counters["completed_steps"] <= args.steps:
            raise ValueError("resume step outside the configured schedule")
        if best_checkpoint is not None:
            _save_torch(output / "checkpoint.pt", best_checkpoint)
    started = time.monotonic()

    def elapsed():
        return elapsed_before + time.monotonic() - started

    def save_progress(status):
        save_started = time.monotonic()
        state = {"format": STATE_FORMAT, "identity": identity, "metadata": metadata,
                 "model_state_dict": _clone_state(model), "optimizer_state_dict": optimizer.state_dict(),
                 "counters": counters, "window": window, "history": history, "best": best, "best_checkpoint": best_checkpoint,
                 "timings": timings, "hard_replay": replay.state_dict(),
                 "elapsed_seconds": elapsed(),
                 "rng_state": {"torch": torch.get_rng_state(), "python_sampler": sampler.getstate(),
                               "python_global": random.getstate()}}
        _save_torch(output / "last-training-state.pt", state)
        timings["checkpoint_seconds"] += time.monotonic() - save_started
        report = {**metadata, "status": status, **counters, "best": best, "history": history,
                  "planned_steps": args.steps, "planned_schedule_complete": counters["completed_steps"] == args.steps,
                  "duration_budget_seconds": args.duration_seconds,
                  "duration_budget_complete": bool(args.duration_seconds and elapsed() >= args.duration_seconds),
                  "max_run_steps_this_invocation": args.max_run_steps,
                  "elapsed_seconds": elapsed(), "timings": dict(timings), "last_state": "last-training-state.pt",
                  "hard_replay_pool_examples": len(replay.pool),
                  "hard_replay_observed_examples": sum(score is not None for score in replay.scores),
                  "checkpoint_sha256": sha256_file(output / "checkpoint.pt") if best_checkpoint is not None else None}
        atomic_json(output / "progress.json", report)
        atomic_json(output / "training-report.json", report)
        return report

    def validate(step, train_info):
        nonlocal best, best_checkpoint
        validation_started = time.monotonic()
        ce = measure_loss(model, val_encoded, tokenizer.pad_id, args.batch_size)
        generation, _ = evaluate_records(model, selection, tokenizer, max_new_tokens=32, batch_size=args.batch_size)
        timings["validation_seconds"] += time.monotonic() - validation_started
        correct = round(generation["exact_action_and_arguments_accuracy"] * len(selection))
        improved = best is None or correct > best["selection_exact_count"] or (
            correct == best["selection_exact_count"] and ce["response_cross_entropy"] < best["full_validation"]["response_cross_entropy"])
        entry = {"step": step, "full_validation": ce, "selection_generation": generation,
                 "selection_exact_count": correct, "selection_examples": len(selection),
                 "improved": improved, "elapsed_seconds": elapsed(), **train_info}
        history.append(entry)
        if improved:
            best = {"step": step, "selection_exact_count": correct, "selection_examples": len(selection),
                    "selection_exact_accuracy": correct / len(selection), "full_validation": ce,
                    "selection_generation": generation}
            best_checkpoint = {"format": "s0ul-training-v1", "config": config.to_dict(),
                               "model_state_dict": _clone_state(model), "tokenizer": tokenizer.spec(),
                               "training": {"step": step, "seed": args.seed, "validation": ce,
                                            "validation_generation": generation, "selection_rule": SELECTION_RULE,
                                            "training_data_sha256": hashes["train"],
                                            "validation_data_sha256": hashes["validation"],
                                            "initial_checkpoint_sha256": metadata["initial_checkpoint_sha256"]}}
            _save_torch(output / "checkpoint.pt", best_checkpoint)
            counters["evaluations_without_improvement"] = 0
        elif step > 0:
            counters["evaluations_without_improvement"] += 1
        print(json.dumps({"event": "validation", **entry}), flush=True)
        return entry

    if not history:
        validate(0, {"learning_rate": 0.0, "train_batch_loss": None, "gradient_norm_before_clip": None})
        save_progress("running")
    print(json.dumps({"event": "started" if not args.resume else "resumed", "parameters": model.parameter_count(),
                      "completed_steps": counters["completed_steps"], "target_steps": args.steps}), flush=True)
    log_path = output / "training-log.jsonl"
    log_path.write_text("".join(json.dumps(row) + "\n" for row in history), encoding="utf-8")
    status = "completed" if counters["completed_steps"] == args.steps else "running"
    invocation_start_step = counters["completed_steps"]
    with log_path.open("a", encoding="utf-8") as log:
        for step in range(counters["completed_steps"] + 1, args.steps + 1):
            if args.duration_seconds and elapsed() >= args.duration_seconds:
                status = "duration_completed"
                break
            compute_started = time.monotonic()
            model.train()
            indices = replay.sample(sampler, args.batch_size)
            x, y = make_batch(encoded, indices, tokenizer.pad_id)
            if args.duration_seconds:
                lr = learning_rate_for_elapsed(elapsed(), args.duration_seconds, args.warmup_seconds,
                                               args.learning_rate, args.min_lr_ratio)
            else:
                lr = learning_rate_for_step(step, args.steps, args.warmup_steps, args.learning_rate, args.min_lr_ratio)
            for group in optimizer.param_groups:
                group["lr"] = lr
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = F.cross_entropy(logits.flatten(0, 1), y.flatten(), ignore_index=-100,
                                   label_smoothing=args.label_smoothing)
            # Difficulty scores and reported response CE always use ordinary CE.
            # Reuse this same forward pass; no validation data enters sampling.
            if args.hard_replay_fraction or args.label_smoothing:
                per_example_ce = response_losses(logits, y)
                token_counts = y.ne(-100).sum(dim=1)
                batch_ce = float((per_example_ce * token_counts).sum() / token_counts.sum())
                if args.hard_replay_fraction:
                    replay.observe(indices, per_example_ce.tolist())
            else:
                batch_ce = loss.item()
            if not bool(torch.isfinite(loss)):
                raise RuntimeError(f"non-finite loss at step {step}")
            loss.backward()
            gradient_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            optimizer.step()
            timings["optimizer_compute_seconds"] += time.monotonic() - compute_started
            tokens = int(y.ne(-100).sum())
            counters["completed_steps"] = step
            counters["examples_seen"] += len(indices)
            counters["input_tokens_seen"] += sum(len(encoded[index][0]) for index in indices)
            counters["response_tokens_seen"] += tokens
            window["loss_sum"] += batch_ce * tokens
            window["response_tokens"] += tokens
            duration_due = bool(args.duration_seconds and elapsed() >= args.duration_seconds)
            due = step % args.eval_every == 0 or step == args.steps or duration_due
            if due:
                if args.hard_replay_fraction:
                    replay.refresh()
                entry = validate(step, {"learning_rate": lr, "train_batch_loss": loss.item(),
                                       "window_response_cross_entropy": window["loss_sum"] / window["response_tokens"],
                                       "gradient_norm_before_clip": gradient_norm.item(),
                                       "examples_seen": counters["examples_seen"],
                                       "input_tokens_seen": counters["input_tokens_seen"],
                                       "response_tokens_seen": counters["response_tokens_seen"]})
                window["loss_sum"], window["response_tokens"] = 0.0, 0
                log.write(json.dumps(entry) + "\n")
                log.flush()
                status = "completed" if step == args.steps else "running"
                if args.duration_seconds:
                    status = "duration_completed" if elapsed() >= args.duration_seconds else (
                        "step_limit_reached" if step == args.steps else "running")
                if args.patience and counters["evaluations_without_improvement"] >= args.patience:
                    status = "early_stopped"
                save_progress(status)
                if status in ("early_stopped", "duration_completed"):
                    break
            if stop_after is not None and step >= stop_after and step < args.steps:
                status = "interrupted"
                break
            if args.max_run_steps and step - invocation_start_step >= args.max_run_steps and step < args.steps:
                status = "interrupted"
                break
    # Walltime can expire between two loop checks rather than inside the last
    # optimizer call. Still assess the actual final weights before selecting.
    if status == "duration_completed" and history[-1]["step"] != counters["completed_steps"]:
        entry = validate(counters["completed_steps"], {
            "learning_rate": optimizer.param_groups[0]["lr"],
            "train_batch_loss": None, "gradient_norm_before_clip": None,
            "window_response_cross_entropy": window["loss_sum"] / window["response_tokens"] if window["response_tokens"] else None,
            "examples_seen": counters["examples_seen"],
            "input_tokens_seen": counters["input_tokens_seen"],
            "response_tokens_seen": counters["response_tokens_seen"],
        })
        window["loss_sum"], window["response_tokens"] = 0.0, 0
        with log_path.open("a", encoding="utf-8") as log:
            log.write(json.dumps(entry) + "\n")
    report = save_progress(status)
    print(json.dumps({"event": status, "completed_steps": counters["completed_steps"], "best": best,
                      "elapsed_seconds": report["elapsed_seconds"]}), flush=True)
    return report


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default="data-v2")
    parser.add_argument("--output", default="runs/advanced-001")
    parser.add_argument("--steps", type=int, default=6000)
    parser.add_argument("--max-run-steps", type=int, default=0,
                        help="stop this invocation after N updates while retaining the full --steps schedule; 0 is unlimited")
    parser.add_argument("--duration-seconds", type=float, default=0,
                        help="observed run-walltime budget; enables elapsed-time cosine schedule; 0 uses a step schedule")
    parser.add_argument("--warmup-seconds", type=float, default=60,
                        help="elapsed-time warmup for duration mode; ignored in step mode")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--eval-every", type=int, default=250)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--min-lr-ratio", type=float, default=0.1)
    parser.add_argument("--warmup-steps", type=int, default=200)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--label-smoothing", type=float, default=0.0,
                        help="response CE smoothing in [0,1); validation and replay use unsmoothed CE")
    parser.add_argument("--hard-replay-fraction", type=float, default=0.0,
                        help="fraction of each batch replayed from difficult observed training examples; [0,0.5]")
    parser.add_argument("--hard-replay-size", type=int, default=2048,
                        help="maximum difficult-example pool size, refreshed every --eval-every steps")
    parser.add_argument("--selection-examples", type=int, default=180, help="0 selects the entire validation split")
    parser.add_argument("--patience", type=int, default=0, help="validation intervals without improvement; 0 disables; required for duration mode")
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument("--init-checkpoint", help="verified standard S0UL checkpoint; fresh optimizer and schedule")
    sources.add_argument("--resume", help="last-training-state.pt with the same total-step schedule and pinned inputs")
    return parser


def main():
    run_training(build_parser().parse_args())


if __name__ == "__main__":
    main()
