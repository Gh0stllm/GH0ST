"""Meaningful curriculum invariants; no model-quality claims."""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from s0ul.actions import parse_action
from s0ul.data_v2 import (ACTION_KINDS, COMMON_VALUES, MISSING, NEGATION_FRAMES,
                          REFUSAL_TEMPLATES, TEMPLATES, WAIT_IDLE, _slot_pools,
                          build_splits, write_dataset)
from s0ul.tokenizer import S0ULTokenizer


class CompositionalDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.splits, cls.details = build_splits(seed=123, train_per_action=25, validation_per_action=10)

    def test_request_uniqueness_action_balance_and_context_bounds(self):
        tokenizer = S0ULTokenizer()
        seen_requests = set()
        seen_ids = set()
        for split, records in self.splits.items():
            expected_count = 25 if split == "train" else 10
            self.assertEqual(Counter(row["action"] for row in records), {kind: expected_count for kind in ACTION_KINDS})
            self.assertEqual({row["prefix_style"] for row in records}, {"plain", "caller", "block", "chain_tasks", "memory_observation"})
            for row in records:
                self.assertNotIn(row["request"], seen_requests)
                seen_requests.add(row["request"])
                self.assertNotIn(row["id"], seen_ids)
                seen_ids.add(row["id"])
                self.assertEqual(row["split"], split)
                self.assertEqual(parse_action(row["response"]).kind, row["action"])
                length = 3 + len(tokenizer.encode(row["prompt"])) + len(tokenizer.encode(row["response"]))
                self.assertEqual(length, row["sequence_tokens"])
                self.assertLessEqual(length, 128)
                if row["prefix_style"] == "plain":
                    self.assertEqual(row["prompt"], row["request"])
                else:
                    self.assertTrue(row["prompt"].endswith(row["request"]))

    def test_core_phrase_families_and_copied_values_are_disjoint(self):
        seen_templates = set()
        for split in ("train", "validation"):
            texts = {text for group in TEMPLATES[split].values() for text in group}
            texts.update(WAIT_IDLE[split])
            texts.update(NEGATION_FRAMES[split])
            texts.update(text for group in MISSING[split].values() for text in group)
            texts.update(text for group in REFUSAL_TEMPLATES[split].values() for text in group)
            self.assertFalse(texts & seen_templates)
            seen_templates.update(texts)
        pools = _slot_pools(123)
        self.assertTrue(set(COMMON_VALUES) <= set(pools["train"]))
        self.assertFalse(set(pools["train"]) & set(pools["validation"]))
        for split, records in self.splits.items():
            for row in records:
                action = parse_action(row["response"])
                if action.kind in ("MEM_SET", "TASK_ADD"):
                    self.assertIn(action.args[-1], pools[split])
                if action.kind == "TASK_DONE":
                    task_id = int(action.args[0])
                    self.assertTrue(1 <= task_id <= 8500 if split == "train" else 8501 <= task_id <= 9999)

    def test_scenario_labels_are_consistent_with_policy(self):
        observed_scenarios = set()
        for records in self.splits.values():
            for row in records:
                action = parse_action(row["response"])
                scenario = row["scenario"]
                observed_scenarios.add(scenario)
                if scenario.startswith("wait_"):
                    self.assertEqual(action.encode(), "WAIT")
                if scenario.startswith("clarify_missing_"):
                    self.assertEqual(action.args, (scenario.removeprefix("clarify_missing_"),))
                if scenario == "clarify_multiple_operations":
                    self.assertEqual(action.encode(), "CLARIFY|request")
                if scenario in ("refuse_other_owner", "refuse_injection_owner"):
                    self.assertEqual(action.encode(), "REFUSE|unauthorized")
                if scenario == "refuse_private_key":
                    self.assertEqual(action.encode(), "REFUSE|unsafe")
                if scenario in ("refuse_unknown_asset", "refuse_unknown_key", "refuse_financial", "refuse_price", "refuse_injection_financial"):
                    self.assertEqual(action.encode(), "REFUSE|unsupported")
        self.assertTrue(any(item.startswith("wait_negated_") for item in observed_scenarios))
        self.assertIn("clarify_multiple_operations", observed_scenarios)

    def test_determinism_manifest_hashes_and_no_final_test(self):
        with tempfile.TemporaryDirectory() as directory:
            first, second = Path(directory) / "a", Path(directory) / "b"
            manifest = write_dataset(first, seed=77, train_per_action=3, validation_per_action=2)
            write_dataset(second, seed=77, train_per_action=3, validation_per_action=2)
            self.assertEqual(set(manifest["files"]), {"train.jsonl", "validation.jsonl"})
            self.assertTrue(manifest["no_final_test_generated"])
            self.assertFalse((first / "test.jsonl").exists())
            self.assertIn("no teacher", manifest["label_source"])
            self.assertEqual(manifest["tokenizer"], S0ULTokenizer().spec())
            for filename, metadata in manifest["files"].items():
                payload = (first / filename).read_bytes()
                self.assertEqual(payload, (second / filename).read_bytes())
                self.assertEqual(hashlib.sha256(payload).hexdigest(), metadata["sha256"])
                self.assertEqual(len(payload), metadata["size_bytes"])
                self.assertEqual(metadata["records"], metadata["unique_unprefixed_requests"])
            self.assertEqual((first / "manifest.json").read_bytes(), (second / "manifest.json").read_bytes())
            (first / "test.jsonl").write_text("must not change")
            with self.assertRaisesRegex(ValueError, "test.jsonl"):
                write_dataset(first)
            self.assertEqual((first / "test.jsonl").read_text(), "must not change")


if __name__ == "__main__":
    unittest.main()
