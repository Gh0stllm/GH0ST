"""Dataset integrity, semantic controls, and independent split provenance."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from s0ul.actions import parse_action
from s0ul.data import ACTION_KINDS
from s0ul.data_v3 import (IDLE, ID_RANGES, MISSING, NEGATE, REFUSALS, SUPPORTED,
                         SPLITS, build_records, write_dataset)
from s0ul.tokenizer import S0ULTokenizer


def all_templates(split):
    texts = set(IDLE[split]) | set(NEGATE[split])
    for table in (SUPPORTED, MISSING, REFUSALS):
        texts.update(text for group in table[split].values() for text in group)
    return texts


class HardDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.splits, cls.details = build_records(seed=71, train_per_action=50,
                                                validation_per_action=40,
                                                challenge_per_action=40)

    def test_actual_phrase_families_and_slots_are_disjoint(self):
        seen_templates, seen_values = set(), set()
        for split in SPLITS:
            templates = all_templates(split)
            self.assertFalse(templates & seen_templates)
            seen_templates.update(templates)
            values = set(self.details["copy_pools"][split])
            self.assertFalse(values & seen_values)
            seen_values.update(values)

    def test_unique_requests_labels_bounds_and_copy_provenance(self):
        tokenizer, seen_requests, seen_ids = S0ULTokenizer(), {}, set()
        for split, rows in self.splits.items():
            expected = 50 if split == "train" else 40
            self.assertEqual(Counter(row["source_kind"] for row in rows),
                             {kind: expected for kind in ACTION_KINDS})
            for row in rows:
                self.assertNotIn(row["request"], seen_requests)
                seen_requests[row["request"]] = row["response"]
                self.assertNotIn(row["id"], seen_ids)
                seen_ids.add(row["id"])
                action = parse_action(row["response"])
                self.assertEqual(row["action"], action.kind)
                self.assertEqual(row["split"], split)
                total = 3 + len(tokenizer.encode(row["prompt"])) + len(tokenizer.encode(row["response"]))
                self.assertEqual(row["sequence_tokens"], total)
                self.assertLessEqual(total, 128)
                self.assertLessEqual(len(tokenizer.encode(row["response"])) + 1, 32)
                if action.kind in ("MEM_SET", "TASK_ADD"):
                    self.assertIn(action.args[-1], self.details["copy_pools"][split])
                    self.assertIn(action.args[-1], row["core_request"])
                if action.kind == "TASK_DONE":
                    low, high = ID_RANGES[split]
                    self.assertTrue(low <= int(action.args[0]) <= high)

    def test_hard_compositions_follow_explicit_execution_policy(self):
        seen = set()
        for rows in self.splits.values():
            for row in rows:
                seen.add(row["composition"])
                if row["composition"] == "multiple_operations":
                    self.assertEqual(row["response"], "CLARIFY|request")
                    self.assertEqual(row["scenario"], "clarify_multiple_operations")
                elif row["composition"] in ("quoted_distractor", "negated_alternative", "corrected_copy_argument"):
                    self.assertEqual(row["action"], row["source_kind"])
                    self.assertEqual(row["difficulty"], 2)
                if row["scenario"].startswith("wait_"):
                    self.assertEqual(row["response"], "WAIT")
                if row["scenario"].startswith("clarify_missing_"):
                    field = row["scenario"].removeprefix("clarify_missing_")
                    self.assertEqual(row["response"], "CLARIFY|" + field)
                if row["scenario"] in ("refuse_other_owner", "refuse_injection_owner"):
                    self.assertEqual(row["response"], "REFUSE|unauthorized")
                if row["scenario"] == "refuse_private_key":
                    self.assertEqual(row["response"], "REFUSE|unsafe")
        self.assertTrue({"ordinary", "quoted_distractor", "negated_alternative",
                         "corrected_copy_argument", "multiple_operations"} <= seen)

    def test_challenge_size_cannot_change_training_or_validation(self):
        first, _ = build_records(seed=84, train_per_action=8, validation_per_action=5,
                                 challenge_per_action=2)
        second, _ = build_records(seed=84, train_per_action=8, validation_per_action=5,
                                  challenge_per_action=9)
        self.assertEqual(first["train"], second["train"])
        self.assertEqual(first["validation"], second["validation"])

    def test_manifest_freezes_exact_artifacts_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp) / "a", Path(temp) / "b"
            manifest = write_dataset(first, seed=95, train_per_action=5,
                                     validation_per_action=3, challenge_per_action=2)
            write_dataset(second, seed=95, train_per_action=5,
                          validation_per_action=3, challenge_per_action=2)
            self.assertEqual(set(manifest["files"]),
                             {"train.jsonl", "validation.jsonl", "challenge.jsonl"})
            self.assertEqual(manifest["tokenizer"], S0ULTokenizer().spec())
            for filename, info in manifest["files"].items():
                payload = (first / filename).read_bytes()
                self.assertEqual(payload, (second / filename).read_bytes())
                self.assertEqual(hashlib.sha256(payload).hexdigest(), info["sha256"])
                self.assertEqual(len(payload), info["size_bytes"])
                self.assertEqual(len(payload.splitlines()), info["records"])
            before = (first / "manifest.json").read_bytes()
            self.assertEqual(before, (second / "manifest.json").read_bytes())
            with self.assertRaisesRegex(ValueError, "not empty"):
                write_dataset(first)
            self.assertEqual(before, (first / "manifest.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
