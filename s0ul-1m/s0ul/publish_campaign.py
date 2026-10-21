"""Publish completed campaign evidence without committing binary weights."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import shutil


def publish(result, run_id, run_url, *, project_root=None, publication_prefix="hour"):
    if not re.fullmatch(r"[0-9]{1,24}", run_id):
        raise ValueError("run-id must be a numeric GitHub run identifier")
    expected_url = f"https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/{run_id}"
    if run_url != expected_url:
        raise ValueError("run URL does not identify this repository and run")
    if not isinstance(publication_prefix, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,39}", publication_prefix):
        raise ValueError("publication-prefix must be a short lowercase directory prefix")
    result = Path(result).resolve()
    root = Path(project_root).resolve() if project_root else Path(__file__).resolve().parents[1]
    report = json.loads((result / "campaign-report.json").read_text())
    if report.get("status") != "completed_after_validation_only_selection":
        raise ValueError("campaign has not completed selection and final evaluation")
    selection = report["selection"]
    if selection.get("test_used_for_selection") is not False:
        raise ValueError("campaign selection must exclude the final challenge")
    campaign_label = report.get("campaign_label", "one-hour")
    if not isinstance(campaign_label, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 -]{0,79}", campaign_label):
        raise ValueError("invalid plain-text campaign label")
    metrics = []
    examples = None
    for field in ("selected_challenge", "baseline_challenge", "integer_challenge"):
        measurement = report[field]["generation"]
        count = measurement["examples"]
        score = measurement["exact_action_and_arguments_accuracy"]
        if type(count) is not int or count <= 0:
            raise ValueError("invalid final challenge size")
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("invalid exact accuracy")
        if examples is not None and count != examples:
            raise ValueError("candidate and baseline challenge counts differ")
        examples = count
        metrics.append(score)
    destination = root / "reports" / f"{publication_prefix}-{run_id}"
    if destination.exists():
        raise ValueError("historical campaign directory already exists")
    candidates = sorted(p for p in result.rglob("*") if p.is_file() and p.suffix in (".json", ".md"))
    if not (result / "SUMMARY.md").is_file():
        raise ValueError("campaign summary is missing")
    if any(p.is_symlink() or result not in p.resolve().parents for p in candidates):
        raise ValueError("campaign evidence cannot follow symbolic links outside the result directory")
    for source in candidates:
        target = destination / source.relative_to(result)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    metadata = {"run_id": run_id, "run_url": run_url, "campaign_label": campaign_label,
                "publication_prefix": publication_prefix,
                "selected_lane": selection["selected_lane"], "selected_checkpoint_sha256": selection["selected_checkpoint_sha256"],
                "binary_weights": "Download the selected workflow artifact; binaries are excluded from this Git directory."}
    (destination / "workflow.json").write_text(json.dumps(metadata, indent=2) + "\n")
    (destination / "README.md").write_text(
        f"# {campaign_label.capitalize()} campaign {run_id}\n\n[Workflow and checkpoint artifacts]({run_url}) · [Measured results](SUMMARY.md).\n\n"
        "This directory contains JSON and Markdown evidence. Binary weights, optimizer states and exports are saved in the workflow artifacts.\n"
    )
    selected, baseline, integer = metrics
    status = root / "BUILD-STATUS.md"
    ranked = selection.get("ranked_candidates", [])
    lane_description = f"{len(ranked)} parallel lanes completed" if ranked else "Parallel lanes completed"
    budgets = sorted({lane["duration_budget_seconds"] for lane in ranked})
    if budgets:
        lane_description += " with observed run-walltime budgets of " + ", ".join(f"{value:g} seconds" for value in budgets)
        lane_description += " (including normal validation and checkpoint work)"
    entry = (
        f"\n## {campaign_label.capitalize()} campaign {run_id} — completed\n\n"
        f"{lane_description}. Selected **{selection['selected_lane']}** using full validation results before opening the frozen final challenge.\n\n"
        f"On the same {examples}-request final challenge: selected float **{selected:.2%}**, frozen reference baseline **{baseline:.2%}**, selected integer **{integer:.2%}** exact action-and-argument correctness.\n\n"
        f"[Detailed evidence](reports/{publication_prefix}-{run_id}/SUMMARY.md) · [Workflow and trained checkpoint artifacts]({run_url}). "
        "These are synthetic-domain measurements; full Solidity inference and Robinhood Chain deployment remain separate work.\n"
    )
    status.write_text(status.read_text() + entry)
    return {"published": str(destination), **metadata}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--publication-prefix", default="hour")
    args = parser.parse_args()
    print(json.dumps(publish(args.result, args.run_id, args.run_url, publication_prefix=args.publication_prefix)))


if __name__ == "__main__":
    main()
