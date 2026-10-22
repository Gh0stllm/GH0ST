"""Sealed-test generation, factual checks, comparators and integer export."""
from __future__ import annotations

import argparse
from collections import Counter
import io
import json
from pathlib import Path
import random
import sys
import time

import numpy as np
import torch

from analysis_codec import CLAUSES, decode_words, encode_features, sha256, vocabulary_spec
from dataset import label
from integer_cached import CachedInteger
from train_analysis import generated, read_rows


def allowed_clauses(f):
    c, n, m, o, p, i, a, s, r, d, w, t, e, complete = f
    allowed = {"Safety and value remain unknown.", "Getter evidence is limited.",
               "This snapshot cannot establish identity, history, value, or safety."}
    allowed.add("Runtime code observed." if c else "No runtime code observed.")
    allowed.add("Native funds present." if n else "Native balance zero.")
    conditions = {
        "Paused state reported.": p == 2, "Unpaused state reported.": p == 1,
        "Pool reports zero reserves.": r == 1, "Pool reports positive reserves.": r == 2,
        "Asset and positive supply reported.": a == 2 and s == 2,
        "Implementation address reported.": i == 2, "Zero implementation reported.": i == 1,
        "NFT interfaces claimed.": bool(m & 2 and m & 4), "ERC721 interface claimed.": bool(m & 2),
        "ERC1155 interface claimed.": bool(m & 4), "Royalty interface claimed.": bool(m & 8),
        "ERC165 interface claimed.": bool(m & 1), "Interface probes inconclusive.": m == 0,
        "Owner address reported.": o == 2, "Owner getter is unverified.": o == 2,
        "Zero owner address reported.": o == 1, "Zero owner reported.": o == 1,
        "Asset address reported.": a == 2, "Zero asset reported.": a == 1,
        "Positive supply reported.": s == 2, "Zero supply reported.": s == 1,
        "Scan incomplete; detected patterns are partial.": not complete,
        "Delegate and storage patterns warrant review.": bool(d and w),
        "Implementation and delegate patterns require inspection.": d and i == 2,
        "Origin and external calls patterns warrant review.": bool(t and e),
        "Delegate execution pattern warrants review.": bool(d),
        "Storage and external calls patterns warrant review.": bool(w and e),
        "Origin pattern warrants review.": bool(t), "External calls pattern warrants review.": bool(e),
        "Storage writes pattern observed.": bool(w), "Selected scan patterns absent.": complete and not any((d, w, t, e)),
    }
    allowed.update(k for k, condition in conditions.items() if condition)
    return allowed


def assess(rows, predictions):
    counts = Counter()
    outputs = []
    for row, ids in zip(rows, predictions):
        counts["examples"] += 1
        counts["exact"] += ids == row["response_ids"]
        item = {"id": row["id"], "features": row["features"], "prompt_ids": row["prompt_ids"],
                "expected_ids": row["response_ids"], "generated_ids": ids, "expected": row["response"]}
        try:
            text = decode_words(ids)
            item["generated"] = text
            counts["format_valid"] += 1
            clauses = [part + "." for part in text[:-1].split(". ")] if text.endswith(".") else [text]
            unknown = [clause for clause in clauses if clause not in CLAUSES]
            contradiction = [clause for clause in clauses if clause in CLAUSES and clause not in allowed_clauses(row["features"])]
            counts["unrecognized_clause_examples"] += bool(unknown)
            counts["contradiction_examples"] += bool(contradiction)
            counts["factual_and_canonical_examples"] += not unknown and not contradiction
            counts["missing_uncertainty_examples"] += not any(clause in clauses for clause in (
                "Safety and value remain unknown.", "This snapshot cannot establish identity, history, value, or safety."))
            item.update(unknown_clauses=unknown, contradictory_clauses=contradiction)
        except ValueError as error:
            item["invalid"] = str(error)
        outputs.append(item)
    n = len(rows)
    report = dict(counts)
    report.update(exact_accuracy=counts["exact"] / n, format_valid_fraction=counts["format_valid"] / n,
                  factual_and_canonical_fraction=counts["factual_and_canonical_examples"] / n)
    return report, outputs


def export_integer(saved, checkpoint, output):
    from s0ul.integer import IntegerModel
    from s0ul.solidity_export import build_export, verify_export, _manifest_preimage, keccak256
    integer = IntegerModel.from_state_dict(saved["model_state_dict"], saved["config"], sha256(checkpoint.read_bytes()))
    # The original loader intentionally pins the original byte codec. Numeric
    # inference is tokenizer-independent; bind the new codec in a separate
    # identity field rather than falsely calling it the old tokenizer.
    integer_manifest = integer.save(output / "integer")
    (output / "integer" / "analysis-codec.json").write_text(json.dumps(vocabulary_spec(), indent=2, sort_keys=True) + "\n")
    manifest = build_export(integer, output / "solidity")
    manifest["tokenizerDomainSha256"] = "0x" + vocabulary_spec()["domain_sha256"]
    manifest["analysisFeatureSchemaSha256"] = "0x" + vocabulary_spec()["schema_sha256"]
    manifest["analysisCodecFormat"] = vocabulary_spec()["format"]
    manifest["manifestHash"] = keccak256(_manifest_preimage(manifest))
    manifest["constructor"]["manifestHash"] = manifest["manifestHash"]
    (output / "solidity" / "model.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    verify_export(output / "solidity")
    return integer, {"integer_payload_sha256": integer_manifest["payload"]["sha256"],
                     "solidity_payload_sha256": manifest["payload"]["sha256"], "shards": len(manifest["shards"]),
                     "manifest_hash": manifest["manifestHash"], "checkpoint_sha256": sha256(checkpoint.read_bytes())}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source-root", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, default=Path(__file__).parent / "run-v2/frozen-checkpoint.pt")
    p.add_argument("--data", type=Path, default=Path(__file__).parent / "data-v2")
    p.add_argument("--output", type=Path, default=Path(__file__).parent / "evaluation-v2")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--integer-limit", type=int, default=0, help="0 evaluates every held-out row; nonzero is explicitly reported as a subset")
    args = p.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError("evaluation output must be new or empty")
    args.output.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(args.source_root.resolve()))
    from s0ul.model import ModelConfig, S0ULModel
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    raw_checkpoint = args.checkpoint.read_bytes()
    checkpoint_hash = sha256(raw_checkpoint)
    training_report_path = args.checkpoint.parent / "training-report.json"
    training_report = json.loads(training_report_path.read_text())
    if training_report["status"] == "running" or training_report["checkpoint_sha256"] != checkpoint_hash:
        raise ValueError("training must exit and its selected checkpoint must be frozen before evaluation")
    if training_report["dataset_manifest_sha256"] != sha256((args.data / "manifest.json").read_bytes()):
        raise ValueError("evaluation dataset manifest differs from the selected training run")
    saved = torch.load(io.BytesIO(raw_checkpoint), map_location="cpu", weights_only=True)
    if saved["format"] != "s0ul-analysis-training-v1" or saved["codec"] != vocabulary_spec():
        raise ValueError("analysis checkpoint/codec identity mismatch")
    model = S0ULModel(ModelConfig(**saved["config"]))
    model.load_state_dict(saved["model_state_dict"], strict=True)
    model.eval()
    integer, exported = export_integer(saved, args.checkpoint, args.output)
    if exported["checkpoint_sha256"] != checkpoint_hash or sha256(args.checkpoint.read_bytes()) != checkpoint_hash:
        raise ValueError("checkpoint changed while loading or exporting; no test has been opened")
    # Publish the canonical local EVM fixture immediately after the selected
    # checkpoint is frozen/exported, before the longer sealed-test sweep.
    canonical_features = [0, 0, *([0] * 11), 1]
    canonical_prompt = encode_features(canonical_features)
    before_canonical = integer.saturation_count
    canonical_ids, canonical_logits = CachedInteger(integer).generate(canonical_prompt, capture=True)
    prefix = canonical_prompt.copy()
    for token, logits in zip(canonical_ids, canonical_logits):
        if not np.array_equal(integer.forward(prefix)[-1], np.asarray(logits)):
            raise RuntimeError("canonical cached/full integer logit mismatch")
        prefix.append(token)
    canonical_golden = {"format": "s0ul-analysis-evm-golden-v1", "features": canonical_features,
                        "prompt_ids": canonical_prompt, "output_ids": canonical_ids,
                        "max_new_tokens": 32, "generated_token_ids": canonical_ids,
                        "response": decode_words(canonical_ids),
                        "decisions": [{"index": index, "token_id": token, "logits": logits}
                                      for index, (token, logits) in enumerate(zip(canonical_ids, canonical_logits))],
                        "decoded": decode_words(canonical_ids), "decision_logits": canonical_logits,
                        "checkpoint_sha256": exported["checkpoint_sha256"],
                        "integer_payload_sha256": exported["integer_payload_sha256"],
                        "solidity_payload_sha256": exported["solidity_payload_sha256"],
                        "codec": vocabulary_spec(), "all_decisions_checked_against_full_reference": True}
    canonical_golden["saturation_count"] = integer.saturation_count - before_canonical
    (args.output / "canonical-integer-golden.json").write_text(json.dumps(canonical_golden, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"canonical_golden_ready": str(args.output / "canonical-integer-golden.json"),
                      "output_ids": canonical_ids, "decoded": canonical_golden["decoded"]}), flush=True)
    train = read_rows(args.data / "train.jsonl")
    majority = Counter(row["response"] for row in train).most_common(1)[0][0]
    report = {"format": "s0ul-analysis-capability-pilot-evaluation-v1", "export": exported,
              "canonical_saturation_count": canonical_golden["saturation_count"],
              "checkpoint_selected_before_test_read": True, "selection_step": saved["step"],
              "training_report_sha256": sha256(training_report_path.read_bytes()),
              "evaluator_sha256": sha256(Path(__file__).read_bytes()),
              "dataset_manifest_sha256": training_report["dataset_manifest_sha256"],
              "codec": vocabulary_spec(), "splits": {},
              "limitations": ["Finite authored-label capability pilot, not financial intelligence, real-address accuracy, a security audit or Aixbt parity.",
                              "Policy comparator authors the labels; reproducing it is an expensive neural approximation, not new factual knowledge.",
                              "Integer-reference agreement is local; EVM arithmetic parity requires separate contract execution tests."]}
    started = time.monotonic()
    for split in ("test", "combination_test"):
        dataset_manifest = json.loads((args.data / "manifest.json").read_text())
        if sha256((args.data / f"{split}.jsonl").read_bytes()) != dataset_manifest["files"][split]["sha256"]:
            raise ValueError("sealed test file hash differs from the selected dataset manifest")
        rows = read_rows(args.data / f"{split}.jsonl")
        float_predictions = generated(model, rows)
        fp, fp_outputs = assess(rows, float_predictions)
        fp["majority_exact_accuracy"] = sum(row["response"] == majority for row in rows) / len(rows)
        fp["authored_policy_exact_accuracy"] = sum(label(row["features"]) == row["response"] for row in rows) / len(rows)
        shuffled_rows = [{**row, "prompt_ids": rows[(i + 1) % len(rows)]["prompt_ids"]} for i, row in enumerate(rows)]
        shuffled_predictions = generated(model, shuffled_rows)
        fp["shuffled_features_exact_accuracy"] = sum(out == row["response_ids"] for out, row in zip(shuffled_predictions, rows)) / len(rows)
        selected = rows if args.integer_limit == 0 else rows[:args.integer_limit]
        integer_outputs, goldens = [], []
        parity_logits = parity_decisions = 0
        base_saturation = integer.saturation_count
        for index, row in enumerate(selected):
            ids, decisions = CachedInteger(integer).generate(row["prompt_ids"], capture=True)
            integer_outputs.append(ids)
            # Check every generated decision of the first two held-out examples
            # against the unchanged, independently recomputing reference.
            if index < 2:
                prefix = row["prompt_ids"].copy()
                for token, cached_logits in zip(ids, decisions):
                    full_logits = integer.forward(prefix)[-1]
                    if not np.array_equal(full_logits, np.asarray(cached_logits)):
                        raise RuntimeError("cached/full integer decision mismatch")
                    parity_logits += len(cached_logits)
                    parity_decisions += 1
                    prefix.append(token)
                goldens.append({"id": row["id"], "features": row["features"], "prompt_ids": row["prompt_ids"],
                                "output_ids": ids, "decision_logits": decisions})
            if (index + 1) % 32 == 0:
                print(json.dumps({"split": split, "integer_examples": index + 1, "elapsed_seconds": time.monotonic() - started}), flush=True)
        ip, ip_outputs = assess(selected, integer_outputs)
        ip.update(integer_subset_limit=args.integer_limit, all_heldout_examples_evaluated=len(selected) == len(rows),
                  float_integer_exact_output_agreement=sum(a == b for a, b in zip(float_predictions, integer_outputs)) / len(selected),
                  cached_full_reference_matching_decisions=parity_decisions,
                  cached_full_reference_matching_logits=parity_logits,
                  saturation_count=integer.saturation_count - base_saturation)
        report["splits"][split] = {"float": fp, "integer": ip}
        for name, value in ((f"{split}-float-outputs.json", fp_outputs),
                            (f"{split}-integer-outputs.json", ip_outputs),
                            (f"{split}-integer-golden.json", goldens)):
            (args.output / name).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
        (args.output / "evaluation-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"split": split, "results": report["splits"][split]}), flush=True)
    # Deterministic missing-data and no-code regressions are separate from heldout.
    regression_features = [[0, n, *([0] * 11), 1] for n in (0, 1)]
    regression_features += [[1, n, *([0] * 11), complete] for n in (0, 1) for complete in (0, 1)]
    regression_rows = [{"id": f"regression-{i}", "features": v, "prompt_ids": encode_features(v),
                        "response": label(v), "response_ids": __import__('analysis_codec').encode_words(label(v))}
                       for i, v in enumerate(regression_features)]
    outputs = [CachedInteger(integer).generate(row["prompt_ids"]) for row in regression_rows]
    report["missing_data_and_no_code_regression"], details = assess(regression_rows, outputs)
    report["elapsed_seconds"] = time.monotonic() - started
    # Explicit quality gate, never runtime substitution with the policy labeler.
    report["pilot_quality_gate_passed"] = all(
        values["integer"]["all_heldout_examples_evaluated"]
        and values["integer"]["exact_accuracy"] >= .95
        and values["integer"]["factual_and_canonical_fraction"] == 1
        and values["integer"]["missing_uncertainty_examples"] == 0
        and values["integer"]["saturation_count"] == 0
        for values in report["splits"].values()) and report["missing_data_and_no_code_regression"]["exact_accuracy"] == 1 and report["canonical_saturation_count"] == 0
    report["production_analyst_capability_established"] = False
    (args.output / "regression-outputs.json").write_text(json.dumps(details, indent=2, sort_keys=True) + "\n")
    (args.output / "evaluation-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
