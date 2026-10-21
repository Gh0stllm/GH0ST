"""Aggregate completed training lanes; freeze validation-only selection first.

The final challenge is deliberately not opened until selection.json exists.
This module launches no training, network, financial or public-chain action.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import time

from .evaluate import evaluate_records, load_checkpoint
from .export import export_checkpoint, verify_export
from .integer import IntegerModel, evaluate_integer_records
from .tokenizer import S0ULTokenizer
from .train import atomic_json, encode_record, measure_loss, read_records


DEFAULT_CHALLENGE_SHA256 = "67624db57500eda43102c7b1d298157ce5287bc9a59a73d09219d9a9859535e8"
SELECTION_RULE = "full validation exact action/arguments descending; response cross-entropy ascending; lane name ascending"


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _number(value, name):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


def validate_lane_report(report, checkpoint, validation_sha256, minimum_duration_seconds=3600):
    """Require completed duration evidence and matching immutable inputs."""
    if report.get("status") != "duration_completed" or report.get("duration_budget_complete") is not True:
        raise ValueError("candidate lane did not complete its duration budget")
    budget = _number(report.get("duration_budget_seconds"), "duration_budget_seconds")
    elapsed = _number(report.get("elapsed_seconds"), "elapsed_seconds")
    if budget < minimum_duration_seconds or elapsed < budget:
        raise ValueError("candidate duration is shorter than its required observed budget")
    steps = report.get("completed_steps")
    if type(steps) is not int or steps <= 0:
        raise ValueError("candidate has no completed optimizer steps")
    if report.get("parameter_count") != 984192:
        raise ValueError("candidate is not the 984,192-parameter S0UL architecture")
    if report.get("test_read_or_used_for_selection") is not False:
        raise ValueError("candidate does not declare test-independent selection")
    identity = report.get("identity")
    if not isinstance(identity, dict) or identity.get("tokenizer") != S0ULTokenizer().spec():
        raise ValueError("candidate tokenizer identity mismatch")
    hashes = identity.get("dataset_sha256", {})
    if hashes.get("validation") != validation_sha256:
        raise ValueError("candidate validation dataset hash mismatch")
    config = identity.get("run_config", {})
    if _number(config.get("duration_seconds"), "identity duration_seconds") != budget:
        raise ValueError("candidate duration identity disagrees with its report")
    if not isinstance(identity.get("source_sha256"), dict) or not identity["source_sha256"]:
        raise ValueError("candidate lacks pinned source hashes")
    checkpoint_hash = file_sha256(checkpoint)
    if checkpoint_hash != report.get("checkpoint_sha256"):
        raise ValueError("candidate checkpoint hash mismatch")
    for key in ("optimizer_compute_seconds", "validation_seconds", "checkpoint_seconds"):
        timing = _number(report.get("timings", {}).get(key), key)
        if timing < 0 or timing > elapsed + 1:
            raise ValueError("candidate timing evidence is inconsistent")
    return checkpoint_hash


def discover_lanes(artifacts, validation_sha256, expected_lanes=3, minimum_duration_seconds=3600):
    root = Path(artifacts)
    if type(expected_lanes) is not int or expected_lanes <= 0:
        raise ValueError("expected_lanes must be a positive integer")
    candidates = []
    ignored = []
    for path in sorted(root.rglob("training-report.json")):
        report = json.loads(path.read_text())
        # Bootstrap evidence can be present in an artifact tree; it is never a lane.
        if "duration_budget_seconds" not in report:
            ignored.append(str(path.relative_to(root)))
            continue
        checkpoint = path.parent / "checkpoint.pt"
        if not checkpoint.is_file() or checkpoint.is_symlink():
            raise ValueError(f"missing or symbolic-link lane checkpoint: {path}")
        lane = path.parent.name
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", lane):
            raise ValueError("unsafe lane name")
        checkpoint_hash = validate_lane_report(report, checkpoint, validation_sha256, minimum_duration_seconds)
        candidates.append({"lane": lane, "checkpoint_path": checkpoint,
                           "report_path": path, "artifact_report": str(path.relative_to(root)),
                           "checkpoint_sha256": checkpoint_hash, "training_report_sha256": file_sha256(path),
                           "training": report})
    if len(candidates) != expected_lanes:
        raise ValueError(f"expected {expected_lanes} complete lanes, found {len(candidates)}")
    if len({item["lane"] for item in candidates}) != len(candidates):
        raise ValueError("duplicate candidate lane names")
    sources = [item["training"]["identity"]["source_sha256"] for item in candidates]
    datasets = [item["training"]["identity"]["dataset_sha256"] for item in candidates]
    if any(source != sources[0] for source in sources[1:]) or any(data != datasets[0] for data in datasets[1:]):
        raise ValueError("candidate lanes used different source or dataset identities")
    return candidates, ignored


def rank_candidates(candidates):
    """Use newly measured full validation metrics, never training subsets/test."""
    if not candidates:
        raise ValueError("cannot rank empty candidates")
    for candidate in candidates:
        accuracy = _number(candidate["validation"]["generation"]["exact_action_and_arguments_accuracy"], "validation accuracy")
        ce = _number(candidate["validation"]["teacher_forced"]["response_cross_entropy"], "validation cross entropy")
        if not 0 <= accuracy <= 1 or ce < 0:
            raise ValueError("invalid validation selection metrics")
    return sorted(candidates, key=lambda item: (
        -item["validation"]["generation"]["exact_action_and_arguments_accuracy"],
        item["validation"]["teacher_forced"]["response_cross_entropy"], item["lane"]))


def load_final_challenge(path, expected_sha256, selection_path, expected_examples=360):
    """The selection barrier is checked before any challenge bytes are read."""
    selection = json.loads(Path(selection_path).read_text())
    if selection.get("status") != "frozen_before_challenge_read" or selection.get("test_used_for_selection") is not False:
        raise ValueError("selection must be frozen independently before challenge access")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("challenge hash must be a lowercase SHA-256 digest")
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError("frozen final challenge hash mismatch")
    records = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    if len(records) != expected_examples or len({row["id"] for row in records}) != len(records):
        raise ValueError("final challenge count or unique IDs mismatch")
    if any(not isinstance(row.get("prompt"), str) or not isinstance(row.get("response"), str) for row in records):
        raise ValueError("invalid final challenge record")
    return records


def _float_report(model, records, checkpoint_hash, dataset_hash, max_new_tokens, batch_size):
    tokenizer = S0ULTokenizer()
    started = time.perf_counter()
    loss = measure_loss(model, [encode_record(row, tokenizer, model.config.max_seq_len) for row in records],
                        tokenizer.pad_id, batch_size)
    summary, rows = evaluate_records(model, records, tokenizer, max_new_tokens, batch_size)
    return {"checkpoint_sha256": checkpoint_hash, "dataset_sha256": dataset_hash,
            "evaluated_entire_split": True, "examples": len(records), "teacher_forced": loss,
            "generation": summary, "predictions": rows,
            "decoding": {"method": "greedy_argmax", "max_new_tokens": max_new_tokens, "batch_size": batch_size},
            "elapsed_seconds": time.perf_counter() - started}


def _compare_cached_float(integer_report, float_report):
    floating = {row["id"]: row for row in float_report["predictions"]}
    equal = matching = compared = 0
    for row in integer_report["predictions"]:
        other = floating[row["id"]]
        if "generated_token_ids" not in other:
            raise ValueError("float evaluation must retain raw generated token IDs")
        float_ids = list(other["generated_token_ids"])
        if other["terminated_with_eos"]:
            float_ids.append(S0ULTokenizer.eos_id)
        int_ids = row["generated_token_ids"]
        row_equal = float_ids == int_ids
        row_matching = sum(a == b for a, b in zip(float_ids, int_ids))
        row_compared = max(len(float_ids), len(int_ids))
        row.update(float_generated_token_ids=float_ids, float_prediction=other["prediction"],
                   float_integer_output_ids_equal=row_equal, matching_token_positions=row_matching,
                   compared_token_positions=row_compared)
        equal += row_equal
        matching += row_matching
        compared += row_compared
    return {"same_source_checkpoint": True, "comparison_uses_cached_single_float_evaluation": True,
            "examples": len(integer_report["predictions"]), "output_ids_equal_count": equal,
            "matching_token_positions": matching, "compared_token_positions": compared}


def write_summary(path, report):
    def percent(value):
        return f"{100 * value:.2f}%"
    selected = report["selected_challenge"]["generation"]
    baseline = report["baseline_challenge"]["generation"]
    integer = report["integer_challenge"]["generation"]
    label = report.get("campaign_label", "one-hour")
    budgets = sorted({lane["duration_budget_seconds"] for lane in report["selection"]["ranked_candidates"]})
    budget_text = ", ".join(f"{seconds:g} seconds" for seconds in budgets)
    rows = [f"# S0UL-1M parallel {label} campaign", "",
            f"Selected lane: **{report['selection']['selected_lane']}**.", "",
            f"Each candidate completed its observed run-walltime budget ({budget_text}), including normal validation and checkpoint work. Optimizer compute is recorded separately. Selection used the complete validation set only; the frozen final challenge was opened afterwards. No final-challenge result was used to choose a candidate or alter training.", "",
            "| Final challenge measurement | Frozen baseline | Selected float model | Selected integer model |",
            "| --- | --- | --- | --- |",
            f"| Exact action and arguments | {percent(baseline['exact_action_and_arguments_accuracy'])} | {percent(selected['exact_action_and_arguments_accuracy'])} | {percent(integer['exact_action_and_arguments_accuracy'])} |",
            f"| Action type | {percent(baseline['action_type_accuracy'])} | {percent(selected['action_type_accuracy'])} | {percent(integer['action_type_accuracy'])} |",
            f"| Valid format | {percent(baseline['format_valid_fraction'])} | {percent(selected['format_valid_fraction'])} | {percent(integer['format_valid_fraction'])} |", "",
            f"Final challenge cases: {selected['examples']}. Integer saturated values: {report['integer_challenge']['saturated_values']}.", "",
            "## Validation-only ranking", "", "| Lane | Full validation exact accuracy | Response cross-entropy | Observed duration | Optimizer steps |",
            "| --- | --- | --- | --- | --- |"]
    for lane in report["selection"]["ranked_candidates"]:
        rows.append(f"| {lane['lane']} | {percent(lane['validation']['generation']['exact_action_and_arguments_accuracy'])} | {lane['validation']['teacher_forced']['response_cross_entropy']:.6f} | {lane['elapsed_seconds']:.2f} s | {lane['completed_steps']} |")
    regression = report.get("regression_challenge")
    if regression is not None:
        old = regression["baseline"]["generation"]
        new = regression["selected"]["generation"]
        rows.extend(["", "## Historical challenge regression check", "",
                     f"The historical {new['examples']}-request challenge is a previously reported benchmark, not a fresh test. It was opened after selection and used for reporting only.", "",
                     "| Measurement | Frozen preceding checkpoint | Selected float model |",
                     "| --- | --- | --- |",
                     f"| Exact action and arguments | {percent(old['exact_action_and_arguments_accuracy'])} | {percent(new['exact_action_and_arguments_accuracy'])} |",
                     f"| Action type | {percent(old['action_type_accuracy'])} | {percent(new['action_type_accuracy'])} |",
                     f"| Valid format | {percent(old['format_valid_fraction'])} | {percent(new['format_valid_fraction'])} |",
                     "", f"Historical challenge SHA-256: `{regression['dataset_sha256']}`."])
    comparison = report["integer_challenge"]["float_comparison"]
    rows.extend(["", f"Integer/float complete token-sequence agreement: {comparison['output_ids_equal_count']}/{comparison['examples']}. This numerical agreement is separate from correctness against expected actions.", "",
                 "## Evidence boundaries", "",
                 "These are narrow synthetic benchmark results. Correct syntax, improved scores or close integer/float agreement do not establish broad reasoning, real-world robustness, financial competence, authorization or production safety.", "",
                 "Training was supervised and offline. Integer inference is a Python/NumPy reference. The mixed export retains floating-point scales/norm gains and is a separate artifact from the fully fixed-point host reference. No full Solidity inference, RH deployment, public transaction, trading action or EVM gas saving is established here.", "",
                 "The artifact contains the selected checkpoint, both export formats, per-lane validation reports, baseline/selected final-challenge predictions, raw token IDs, hashes, duration reports and this summary. CPU times are not gas estimates.", "",
                 f"Challenge SHA-256: `{report['selection']['challenge_sha256_expected']}`.",
                 f"Selected checkpoint SHA-256: `{report['selection']['selected_checkpoint_sha256']}`.", ""])
    Path(path).write_text("\n".join(rows))


def run_campaign(args):
    import torch
    if args.threads != 2 or args.batch_size <= 0 or args.max_new_tokens <= 0:
        raise ValueError("campaign uses two CPU threads and positive batch/output bounds")
    minimum_duration = getattr(args, "minimum_duration_seconds", 3600)
    if _number(minimum_duration, "minimum_duration_seconds") < 3600:
        raise ValueError("the campaign requires at least 3600 observed seconds per lane")
    campaign_label = getattr(args, "campaign_label", "one-hour")
    if not isinstance(campaign_label, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 -]{0,79}", campaign_label):
        raise ValueError("campaign-label must be a short plain-text label")
    regression_path = getattr(args, "regression_challenge", None)
    regression_hash = getattr(args, "regression_challenge_sha256", DEFAULT_CHALLENGE_SHA256)
    regression_examples = getattr(args, "expected_regression_examples", 360)
    if regression_path and (not re.fullmatch(r"[0-9a-f]{64}", regression_hash)
                            or type(regression_examples) is not int or regression_examples <= 0):
        raise ValueError("regression challenge requires a SHA-256 digest and positive expected count")
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    selection_path = output / "selection.json"
    if selection_path.exists() or (output / "campaign-report.json").exists():
        raise ValueError("campaign output already contains frozen selection/evaluation; do not rerun final challenge")
    started = time.perf_counter()
    validation_path = Path(args.validation)
    validation_hash = file_sha256(validation_path)
    validation_records = read_records(validation_path, "validation")
    candidates, ignored = discover_lanes(args.artifacts, validation_hash, args.expected_lanes, minimum_duration)
    baseline_hash = file_sha256(args.baseline)
    tokenizer = S0ULTokenizer()
    (output / "validation").mkdir(exist_ok=True)
    for item in candidates:
        warmstart = item["training"].get("initial_checkpoint_sha256")
        if warmstart is not None and warmstart != baseline_hash:
            raise ValueError("lane warm-start does not match the frozen baseline checkpoint")
        model, checkpoint = load_checkpoint(item["checkpoint_path"])
        if model.parameter_count() != 984192 or checkpoint["tokenizer"] != tokenizer.spec():
            raise ValueError("candidate checkpoint architecture/tokenizer mismatch")
        item["validation"] = _float_report(model, validation_records, item["checkpoint_sha256"], validation_hash,
                                           args.max_new_tokens, args.batch_size)
        atomic_json(output / "validation" / f"{item['lane']}.json", item["validation"])
        print(json.dumps({"event": "campaign_validation_completed", "lane": item["lane"],
                          "generation": item["validation"]["generation"]}), flush=True)
    ranked = rank_candidates(candidates)
    chosen = ranked[0]
    selected_dir = output / "selected"
    selected_dir.mkdir(exist_ok=True)
    selected_checkpoint = selected_dir / "checkpoint.pt"
    shutil.copy2(chosen["checkpoint_path"], selected_checkpoint)
    if file_sha256(selected_checkpoint) != chosen["checkpoint_sha256"]:
        raise ValueError("selected checkpoint changed during freezing")
    shutil.copy2(chosen["report_path"], selected_dir / "training-report.json")
    selection = {"status": "frozen_before_challenge_read", "created_utc": datetime.now(timezone.utc).isoformat(),
                 "campaign_label": campaign_label, "minimum_duration_seconds": minimum_duration,
                 "selection_rule": SELECTION_RULE, "test_used_for_selection": False,
                 "validation_sha256": validation_hash, "validation_examples": len(validation_records),
                 "challenge_sha256_expected": args.challenge_sha256,
                 "selected_lane": chosen["lane"], "selected_checkpoint_sha256": chosen["checkpoint_sha256"],
                 "baseline_checkpoint_sha256": baseline_hash, "ignored_bootstrap_reports": ignored,
                 "regression_challenge_sha256_expected": regression_hash if regression_path else None,
                 "ranked_candidates": [{"lane": item["lane"], "artifact_report": item["artifact_report"],
                                        "checkpoint_sha256": item["checkpoint_sha256"],
                                        "training_report_sha256": item["training_report_sha256"],
                                        "elapsed_seconds": item["training"]["elapsed_seconds"],
                                        "duration_budget_seconds": item["training"]["duration_budget_seconds"],
                                        "completed_steps": item["training"]["completed_steps"],
                                        "timings": item["training"]["timings"],
                                        "validation": {key: value for key, value in item["validation"].items() if key != "predictions"}}
                                       for item in ranked]}
    # Exclusive creation is the barrier: no challenge access exists above here.
    with selection_path.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(selection, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"event": "campaign_selection_frozen", "selected_lane": chosen["lane"],
                      "checkpoint_sha256": chosen["checkpoint_sha256"]}), flush=True)
    # Export does not inspect the final challenge or alter the selected weights.
    mixed_dir, integer_dir = output / "exports" / "mixed-int8", output / "exports" / "integer"
    mixed_manifest = export_checkpoint(selected_checkpoint, mixed_dir)
    verify_export(mixed_dir / "manifest.json")
    integer_model = IntegerModel.from_checkpoint(selected_checkpoint)
    integer_manifest = integer_model.save(integer_dir)
    integer_model = IntegerModel.load(integer_dir)
    challenge_records = load_final_challenge(args.challenge, args.challenge_sha256, selection_path,
                                             args.expected_challenge_examples)
    selected_model, _ = load_checkpoint(selected_checkpoint)
    selected_report = _float_report(selected_model, challenge_records, chosen["checkpoint_sha256"], args.challenge_sha256,
                                    args.max_new_tokens, args.batch_size)
    atomic_json(output / "selected-challenge.json", selected_report)
    baseline_model, _ = load_checkpoint(args.baseline)
    baseline_report = _float_report(baseline_model, challenge_records, baseline_hash, args.challenge_sha256,
                                    args.max_new_tokens, args.batch_size)
    atomic_json(output / "baseline-challenge.json", baseline_report)
    integer_report = evaluate_integer_records(integer_model, args.challenge, args.max_new_tokens)
    if integer_report["dataset_sha256"] != args.challenge_sha256:
        raise ValueError("final challenge bytes changed before integer evaluation")
    integer_report["float_comparison"] = _compare_cached_float(integer_report, selected_report)
    atomic_json(output / "integer-challenge.json", integer_report)
    regression_report = None
    if regression_path:
        regression_records = load_final_challenge(regression_path, regression_hash, selection_path,
                                                  regression_examples)
        regression_selected = _float_report(selected_model, regression_records, chosen["checkpoint_sha256"],
                                             regression_hash, args.max_new_tokens, args.batch_size)
        regression_baseline = _float_report(baseline_model, regression_records, baseline_hash,
                                             regression_hash, args.max_new_tokens, args.batch_size)
        if file_sha256(regression_path) != regression_hash:
            raise ValueError("historical challenge changed during regression evaluation")
        regression_report = {"dataset_sha256": regression_hash, "previously_reported_benchmark": True,
                             "used_for_selection": False, "selected": regression_selected,
                             "baseline": regression_baseline}
        atomic_json(output / "regression-challenge.json", regression_report)
    report = {"status": "completed_after_validation_only_selection", "campaign_label": campaign_label,
              "selection": selection,
              "selected_challenge": selected_report, "baseline_challenge": baseline_report,
              "integer_challenge": integer_report,
              "regression_challenge": regression_report,
              "artifacts": {"checkpoint": "selected/checkpoint.pt", "mixed_manifest": "exports/mixed-int8/manifest.json",
                            "mixed_payload_sha256": mixed_manifest["payload"]["sha256"],
                            "integer_manifest": "exports/integer/integer-manifest.json",
                            "integer_payload_sha256": integer_manifest["payload"]["sha256"]},
              "elapsed_seconds": time.perf_counter() - started,
              "limits": ["Synthetic domain benchmark; no production, trading or broad intelligence claim",
                         "Complete integer host reference is separate from mixed weight storage export",
                         "No full EVM inference, on-chain deployment or gas measurement"]}
    atomic_json(output / "campaign-report.json", report)
    write_summary(output / "SUMMARY.md", report)
    print(json.dumps({"event": "campaign_completed", "output": str(output), "selected_lane": chosen["lane"],
                      "selected_generation": selected_report["generation"], "baseline_generation": baseline_report["generation"],
                      "integer_generation": integer_report["generation"]}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True)
    parser.add_argument("--validation", default="data-v2/validation.jsonl")
    parser.add_argument("--challenge", default="tests/final_challenge_v2.jsonl")
    parser.add_argument("--challenge-sha256", default=DEFAULT_CHALLENGE_SHA256)
    parser.add_argument("--baseline", default="bootstrap/runs/ci-pilot/checkpoint.pt")
    parser.add_argument("--output", default="runs/hour-campaign")
    parser.add_argument("--expected-lanes", type=int, default=3)
    parser.add_argument("--minimum-duration-seconds", type=float, default=3600)
    parser.add_argument("--campaign-label", default="one-hour")
    parser.add_argument("--expected-challenge-examples", type=int, default=360)
    parser.add_argument("--regression-challenge", help="optional historical benchmark, evaluated only after frozen selection")
    parser.add_argument("--regression-challenge-sha256", default=DEFAULT_CHALLENGE_SHA256)
    parser.add_argument("--expected-regression-examples", type=int, default=360)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-new-tokens", type=int, default=32)
    parser.add_argument("--threads", type=int, default=2)
    run_campaign(parser.parse_args())


if __name__ == "__main__":
    main()
