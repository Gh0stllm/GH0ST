from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from s0ul.actions import is_valid_action, parse_action
from s0ul.data import ACTION_KINDS, CLARIFICATIONS, PREFERENCE_VALUES, REFUSALS, TASK_IDS, TASK_TITLES, TEMPLATES, build_splits, write_dataset
from s0ul.tokenizer import S0ULTokenizer


class TokenizerTests(unittest.TestCase):
    def setUp(self):
        self.tokenizer = S0ULTokenizer()

    def test_utf8_and_literal_control_text_round_trip(self):
        for text in ("", "GH0ST S0UL-1M", "தமிழ் हिन्दी 中文 🧪", "<BOS><EOS><SEP><PAD>", "a\x00b\n\t", "MEM_SET|theme|dark"):
            ids = self.tokenizer.encode(text)
            self.assertEqual(self.tokenizer.decode(ids, errors="strict"), text)
            self.assertTrue(all(4 <= value < 512 for value in ids))

    def test_every_byte_and_reserved_predictions(self):
        raw = bytes(range(256)).decode("latin1")
        self.assertEqual(self.tokenizer.decode(self.tokenizer.encode(raw)), raw)
        spec = self.tokenizer.spec()
        self.assertLessEqual(len(spec["domain_pieces"]), 252)
        self.assertEqual(len(spec["domain_sha256"]), 64)
        if spec["unused_slots"]:
            self.assertEqual(self.tokenizer.decode([511]), "<UNUSED_511>")
        with self.assertRaises(ValueError):
            self.tokenizer.decode([512])

    def test_fixed_vocab_determinism_and_domain_compression(self):
        text = "caller=SELF; block=10000; Check my ETH balance."
        self.assertEqual(self.tokenizer.encode(text), S0ULTokenizer().encode(text))
        self.assertLess(len(self.tokenizer.encode(text)), len(text.encode("utf-8")))
        self.assertEqual(self.tokenizer.spec(), S0ULTokenizer().spec())


class ActionTests(unittest.TestCase):
    def test_valid_canonical_actions(self):
        for value in ("BALANCE|SELF|ETH", "BALANCE|SELF|GH0ST", "MEM_SET|theme|dark", "MEM_GET|language", "TASK_ADD|audit_2", "TASK_LIST|SELF", "TASK_DONE|9999", "WAIT", "CLARIFY|asset", "REFUSE|unauthorized"):
            self.assertEqual(parse_action(value).encode(), value)

    def test_extra_arguments_addresses_ownership_and_noncanonical_numbers_rejected(self):
        for value in ("", "WAIT|", " WAIT", "WAIT\n", "BALANCE|Alice|ETH", "BALANCE|SELF|BTC", "BALANCE|0x123|ETH", "MEM_SET|owner|bob", "MEM_SET|theme|a|b", "MEM_SET|theme|" + "x" * 25, "MEM_SET|theme|தமிழ்", "TASK_DONE|0", "TASK_DONE|01", "TASK_DONE|10000", "TASK_DONE|-1", "CALL|0x123", "TRANSFER|SELF|ETH|1", "TASK_LIST", "REFUSE|anything"):
            self.assertFalse(is_valid_action(value), value)


class DatasetTests(unittest.TestCase):
    def test_splits_schema_bounds_templates_values_and_negative_labels(self):
        splits = build_splits(seed=7)
        tokenizer = S0ULTokenizer()
        self.assertEqual(splits, build_splits(seed=7))
        previous_templates: set[str] = set()
        previous_template_texts: set[str] = set()
        previous_prompts: set[str] = set()
        for split, records in splits.items():
            self.assertEqual(len(records), 1440 if split == "train" else 270)
            self.assertEqual({row["action"] for row in records}, set(ACTION_KINDS))
            templates = {row["template_id"] for row in records}
            self.assertFalse(previous_templates.intersection(templates))
            previous_templates.update(templates)
            template_texts = {text for values in TEMPLATES[split].values() for text in values}
            template_texts.update(text for text, _ in CLARIFICATIONS[split])
            template_texts.update(text for text, _ in REFUSALS[split])
            self.assertFalse(previous_template_texts.intersection(template_texts))
            previous_template_texts.update(template_texts)
            for row in records:
                self.assertEqual(row["split"], split)
                self.assertNotIn(row["prompt"], previous_prompts)
                previous_prompts.add(row["prompt"])
                action = parse_action(row["response"])
                self.assertEqual(action.kind, row["action"])
                self.assertLessEqual(3 + len(tokenizer.encode(row["prompt"])) + len(tokenizer.encode(row["response"])), 128)
                if any(negative in row["prompt"] for negative in ("Do not ", "Don't ", "Never ")):
                    self.assertEqual(row["response"], "WAIT")
        for split_a, split_b in (("train", "validation"), ("train", "test"), ("validation", "test")):
            self.assertFalse(set(TASK_TITLES[split_a]) & set(TASK_TITLES[split_b]))
            self.assertFalse(set(TASK_IDS[split_a]) & set(TASK_IDS[split_b]))
            values_a = {v for values in PREFERENCE_VALUES[split_a].values() for v in values}
            values_b = {v for values in PREFERENCE_VALUES[split_b].values() for v in values}
            self.assertFalse(values_a & values_b)

    def test_manifest_hashes_and_identical_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first"
            second = Path(directory) / "second"
            manifest = write_dataset(first, seed=3, train_per_action=2, eval_per_action=2)
            write_dataset(second, seed=3, train_per_action=2, eval_per_action=2)
            for filename, info in manifest["files"].items():
                payload = (first / filename).read_bytes()
                self.assertEqual(payload, (second / filename).read_bytes())
                self.assertEqual(hashlib.sha256(payload).hexdigest(), info["sha256"])
                self.assertEqual(len(payload), info["size_bytes"])
                self.assertEqual(len(payload.splitlines()), info["records"])
                self.assertEqual(info["records"], sum(info["action_counts"].values()))
            self.assertEqual((first / "manifest.json").read_bytes(), (second / "manifest.json").read_bytes())
            self.assertIn("no teacher", manifest["label_source"])
            self.assertEqual(json.loads((first / "manifest.json").read_text()), manifest)


if __name__ == "__main__":
    unittest.main()
