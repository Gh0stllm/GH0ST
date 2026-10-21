"""Campaign gates use temporary fake artifacts; never the real challenge."""
from argparse import Namespace
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from s0ul.campaign import (discover_lanes, load_final_challenge, rank_candidates,
                          run_campaign, validate_lane_report)
from s0ul.tokenizer import S0ULTokenizer


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def fake_report(checkpoint, validation_sha):
    return {"status": "duration_completed", "duration_budget_complete": True,
            "duration_budget_seconds": 3600, "elapsed_seconds": 3601.5,
            "completed_steps": 20, "parameter_count": 984192,
            "test_read_or_used_for_selection": False,
            "checkpoint_sha256": digest(checkpoint.read_bytes()),
            "identity": {"tokenizer": S0ULTokenizer().spec(),
                         "dataset_sha256": {"train": "fake-train", "validation": validation_sha},
                         "source_sha256": {"fake-source.py": "a" * 64},
                         "run_config": {"duration_seconds": 3600}},
            "timings": {"optimizer_compute_seconds": 3400.0, "validation_seconds": 190.0,
                        "checkpoint_seconds": 10.0}}


class CampaignTests(unittest.TestCase):
    def test_incomplete_duration_nonfinite_and_hash_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "checkpoint.pt"
            checkpoint.write_bytes(b"fake checkpoint; no torch objects")
            report = fake_report(checkpoint, "v")
            validate_lane_report(report, checkpoint, "v")
            for changes in ({"duration_budget_complete": False}, {"elapsed_seconds": 3599.9},
                            {"elapsed_seconds": float("nan")}, {"checkpoint_sha256": "wrong"},
                            {"test_read_or_used_for_selection": True}):
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    validate_lane_report(dict(report, **changes), checkpoint, "v")

    def test_lane_count_and_input_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("lane-a", "lane-b"):
                lane = root / "artifact" / "runs" / name
                lane.mkdir(parents=True)
                checkpoint = lane / "checkpoint.pt"
                checkpoint.write_bytes(name.encode())
                (lane / "training-report.json").write_text(json.dumps(fake_report(checkpoint, "validation")))
            candidates, ignored = discover_lanes(root, "validation", expected_lanes=2)
            self.assertEqual(len(candidates), 2)
            self.assertEqual(ignored, [])
            with self.assertRaisesRegex(ValueError, "expected 3"):
                discover_lanes(root, "validation")
            path = root / "artifact/runs/lane-b/training-report.json"
            report = json.loads(path.read_text())
            report["identity"]["source_sha256"]["fake-source.py"] = "b" * 64
            path.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, "different source"):
                discover_lanes(root, "validation", expected_lanes=2)

    def test_two_hour_campaign_rejects_one_hour_lane(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "checkpoint.pt"
            checkpoint.write_bytes(b"fake checkpoint")
            report = fake_report(checkpoint, "v")
            with self.assertRaisesRegex(ValueError, "shorter"):
                validate_lane_report(report, checkpoint, "v", minimum_duration_seconds=7200)
            report.update(duration_budget_seconds=7200, elapsed_seconds=7201.0)
            report["identity"]["run_config"]["duration_seconds"] = 7200
            validate_lane_report(report, checkpoint, "v", minimum_duration_seconds=7200)

    def test_full_validation_ranking_exact_then_ce_then_name(self):
        def candidate(name, accuracy, ce):
            return {"lane": name, "validation": {"generation": {"exact_action_and_arguments_accuracy": accuracy},
                                                 "teacher_forced": {"response_cross_entropy": ce}}}
        rows = [candidate("lane-d", 0.9, 0.1), candidate("lane-c", 1.0, 0.2),
                candidate("lane-b", 1.0, 0.1), candidate("lane-a", 1.0, 0.1)]
        self.assertEqual([x["lane"] for x in rank_candidates(rows)], ["lane-a", "lane-b", "lane-c", "lane-d"])
        invalid = candidate("bad", 1.0, float("nan"))
        with self.assertRaises(ValueError):
            rank_candidates([invalid])

    def test_challenge_access_requires_frozen_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selection = root / "selection.json"
            # The challenge does not exist; the missing selection must fail first.
            with self.assertRaises(FileNotFoundError) as caught:
                load_final_challenge(root / "challenge.jsonl", "a" * 64, selection, 1)
            self.assertIn("selection.json", str(caught.exception))
            selection.write_text(json.dumps({"status": "frozen_before_challenge_read", "test_used_for_selection": False}))
            challenge = root / "challenge.jsonl"
            raw = (json.dumps({"id": "fake-1", "prompt": "Wait.", "response": "WAIT"}) + "\n").encode()
            challenge.write_bytes(raw)
            self.assertEqual(len(load_final_challenge(challenge, digest(raw), selection, 1)), 1)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_final_challenge(challenge, "0" * 64, selection, 1)
            with self.assertRaisesRegex(ValueError, "count"):
                load_final_challenge(challenge, digest(raw), selection, 2)

    def test_aggregate_orchestration_uses_fake_challenge_after_selection(self):
        self._aggregate_orchestration()

    def test_two_hour_regression_is_evaluated_after_selection(self):
        self._aggregate_orchestration(regression=True, duration=7200)

    def _aggregate_orchestration(self, regression=False, duration=3600):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifacts, output = root / "artifacts", root / "result"
            validation = root / "validation.jsonl"
            val_rows = [{"id": "validation-fake-1", "split": "validation", "prompt": "Wait.", "response": "WAIT"}]
            validation.write_text("\n".join(json.dumps(row) for row in val_rows) + "\n")
            validation_hash = digest(validation.read_bytes())
            baseline = root / "baseline.pt"
            baseline.write_bytes(b"baseline")
            challenge = root / "fake-challenge.jsonl"
            challenge_rows = [{"id": "challenge-fake-1", "prompt": "Do nothing.", "response": "WAIT"}]
            challenge.write_text("\n".join(json.dumps(row) for row in challenge_rows) + "\n")
            challenge_hash = digest(challenge.read_bytes())
            regression_path = root / "historical.jsonl"
            regression_path.write_text(json.dumps({"id": "historical-1", "prompt": "Keep waiting.", "response": "WAIT"}) + "\n")
            regression_hash = digest(regression_path.read_bytes())
            for name, payload in (("lane-a", b"A"), ("lane-b", b"B")):
                lane = artifacts / name / "runs" / name
                lane.mkdir(parents=True)
                checkpoint = lane / "checkpoint.pt"
                checkpoint.write_bytes(payload)
                report = fake_report(checkpoint, validation_hash)
                report.update(duration_budget_seconds=duration, elapsed_seconds=duration + 1.5)
                report["identity"]["run_config"]["duration_seconds"] = duration
                report["initial_checkpoint_sha256"] = digest(baseline.read_bytes())
                (lane / "training-report.json").write_text(json.dumps(report))
            args = Namespace(artifacts=str(artifacts), validation=str(validation), challenge=str(challenge),
                             challenge_sha256=challenge_hash, baseline=str(baseline), output=str(output),
                             expected_lanes=2, expected_challenge_examples=1, minimum_duration_seconds=duration,
                             threads=2, batch_size=2, max_new_tokens=8)
            if regression:
                args.campaign_label = "two-hour hard"
                args.regression_challenge = str(regression_path)
                args.regression_challenge_sha256 = regression_hash
                args.expected_regression_examples = 1
            events = []
            tokenizer = S0ULTokenizer()

            def fake_model(path):
                model = SimpleNamespace(tag=Path(path).read_bytes().decode(), parameter_count=lambda: 984192)
                return model, {"tokenizer": tokenizer.spec()}

            def evaluation(model, records, checkpoint_hash, dataset_hash, maximum, batch):
                event = "validation" if records[0]["id"].startswith("validation") else (
                    "challenge" if records[0]["id"].startswith("challenge") else "regression")
                final = event != "validation"
                events.append((event, (output / "selection.json").exists()))
                accuracy = 1.0 if model.tag == "B" and not final else 0.0
                generation = {"examples": len(records), "exact_action_and_arguments_accuracy": accuracy,
                              "action_type_accuracy": accuracy, "format_valid_fraction": 1.0}
                rows = [{"id": row["id"], "prediction": "WAIT", "generated_token_ids": tokenizer.encode("WAIT"),
                         "terminated_with_eos": True} for row in records]
                return {"generation": generation, "teacher_forced": {"response_cross_entropy": 1.0},
                        "predictions": rows, "checkpoint_sha256": checkpoint_hash, "dataset_sha256": dataset_hash}

            class FakeInteger:
                def save(self, path):
                    Path(path).mkdir(parents=True)
                    return {"payload": {"sha256": "2" * 64}}

            def integer_evaluation(model, path, maximum):
                self.assertTrue((output / "selection.json").is_file())
                rows = [{"id": "challenge-fake-1", "generated_token_ids": tokenizer.encode("WAIT") + [2]}]
                return {"dataset_sha256": challenge_hash, "predictions": rows, "saturated_values": 0,
                        "generation": {"examples": 1, "exact_action_and_arguments_accuracy": 0.0,
                                       "action_type_accuracy": 0.0, "format_valid_fraction": 1.0}}

            with patch("s0ul.campaign.load_checkpoint", side_effect=fake_model), \
                 patch("s0ul.campaign._float_report", side_effect=evaluation), \
                 patch("s0ul.campaign.export_checkpoint", return_value={"payload": {"sha256": "1" * 64}}), \
                 patch("s0ul.campaign.verify_export"), \
                 patch("s0ul.campaign.IntegerModel.from_checkpoint", return_value=FakeInteger()), \
                 patch("s0ul.campaign.IntegerModel.load", return_value=FakeInteger()), \
                 patch("s0ul.campaign.evaluate_integer_records", side_effect=integer_evaluation), \
                 patch("builtins.print"):
                report = run_campaign(args)
                self.assertEqual(report["selection"]["selected_lane"], "lane-b")
                expected_events = [("validation", False), ("validation", False), ("challenge", True), ("challenge", True)]
                if regression:
                    expected_events += [("regression", True), ("regression", True)]
                    self.assertFalse(report["regression_challenge"]["used_for_selection"])
                    self.assertEqual(report["regression_challenge"]["dataset_sha256"], regression_hash)
                    self.assertTrue((output / "regression-challenge.json").is_file())
                    summary = (output / "SUMMARY.md").read_text()
                    self.assertIn("7200 seconds", summary)
                    self.assertNotIn("one-hour", summary)
                    self.assertIn("previously reported benchmark", summary)
                self.assertEqual(events, expected_events)
                self.assertTrue((output / "SUMMARY.md").is_file())
                self.assertEqual(report["integer_challenge"]["float_comparison"]["output_ids_equal_count"], 1)
                with self.assertRaisesRegex(ValueError, "already contains frozen"):
                    run_campaign(args)


if __name__ == "__main__":
    unittest.main()
