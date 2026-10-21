import copy
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import torch

from s0ul.evaluate import evaluate_records, load_checkpoint
from s0ul.model import ModelConfig, S0ULModel
from s0ul.tokenizer import S0ULTokenizer


class FakeGenerator:
    config = SimpleNamespace(max_seq_len=128)

    def __init__(self, generated):
        self.generated = generated

    def generate(self, input_ids, max_new_tokens, eos_id=2):
        tail = torch.tensor(self.generated[:max_new_tokens], dtype=torch.long)
        return torch.cat((input_ids, tail[None].expand(input_ids.size(0), -1)), dim=1)


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.tokenizer = S0ULTokenizer()

    def evaluate(self, text, expected="MEM_SET|theme|dark", controls=(), eos=True):
        ids = list(controls) + self.tokenizer.encode(text)
        if eos:
            ids.append(self.tokenizer.eos_id)
        _, rows = evaluate_records(FakeGenerator(ids), [
            {"id": "held-out-1", "prompt": "Save my theme as dark", "response": expected, "scenario": "memory"}
        ], self.tokenizer)
        return rows[0]

    def test_exact_canonical_action_passes(self):
        row = self.evaluate("MEM_SET|theme|dark")
        self.assertTrue(row["format_valid"])
        self.assertTrue(row["exact_match"])

    def test_unknown_key_and_unsafe_slug_fail_strict_schema(self):
        for action in ("MEM_SET|unknown|dark", "MEM_SET|theme|1dark", "MEM_SET|theme|" + "a" * 25,
                       "TASK_ADD|_unsafe", "MEM_GET|password"):
            with self.subTest(action=action):
                row = self.evaluate(action)
                self.assertFalse(row["format_valid"])
                self.assertFalse(row["exact_match"])

    def test_generated_controls_are_visible_failures(self):
        for control, label in ((0, "PAD"), (1, "BOS"), (3, "SEP")):
            with self.subTest(control=control):
                row = self.evaluate("MEM_SET|theme|dark", controls=(control,))
                self.assertTrue(row["unexpected_special_tokens"])
                self.assertIn(f"<{label}>", row["prediction"])
                self.assertFalse(row["format_valid"])
                self.assertFalse(row["exact_match"])

    def test_matching_text_without_eos_is_incomplete(self):
        row = self.evaluate("MEM_SET|theme|dark", eos=False)
        self.assertFalse(row["format_valid"])
        self.assertFalse(row["exact_match"])

    def test_checkpoint_requires_frozen_tokenizer_spec(self):
        model = S0ULModel(ModelConfig(dim=32, n_layers=1, n_heads=2, hidden_dim=64))
        checkpoint = {"format": "s0ul-training-v1", "config": model.config.to_dict(),
                      "model_state_dict": model.state_dict(), "tokenizer": self.tokenizer.spec()}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.pt"
            torch.save(checkpoint, path)
            loaded, _ = load_checkpoint(path)
            self.assertEqual(loaded.config, model.config)
            changed = copy.deepcopy(checkpoint)
            changed["tokenizer"]["domain_pieces"][0] = "different"
            torch.save(changed, path)
            with self.assertRaisesRegex(ValueError, "tokenizer specification"):
                load_checkpoint(path)
            changed = copy.deepcopy(checkpoint)
            changed["tokenizer"]["domain_sha256"] = "0" * 64
            torch.save(changed, path)
            with self.assertRaisesRegex(ValueError, "tokenizer specification"):
                load_checkpoint(path)


if __name__ == "__main__":
    unittest.main()
