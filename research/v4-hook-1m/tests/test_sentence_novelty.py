"""Checks that audit diagnostics distinguish copying, slot recombination, and broken novelty."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "scripts/audit-sentence-novelty.py"
spec = importlib.util.spec_from_file_location("sentence_novelty", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NoveltyAuditTests(unittest.TestCase):
    def test_repetition_holdout_and_incoherence_are_distinguished(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            corpus = root / "corpus.json"
            corpus.write_text(json.dumps({"train": [{"sentence": "the quiet pool moves."}],
                                          "test": [{"sentence": "the calm pool moves."}]}))
            outputs = root / "outputs.json"
            def output(text, grammar=True):
                return {"text": text, "ended_naturally": True, "controlled_grammar": grammar,
                        "regime_consistent": True, "repeated_bigram": False}
            outputs.write_text(json.dumps({"outputs": [output("the quiet pool moves."),
                output("THE QUIET POOL MOVES."), output("the calm pool moves."),
                output("the gentle pool moves."), output("pool quiet in follows voice.", False)]}))
            report = module.audit(outputs, [corpus])
            metrics = report["metrics"]
            self.assertEqual(metrics["samples"], 5)
            self.assertEqual(metrics["distinct_outputs"], 4)
            self.assertEqual(metrics["exact_known_train_outputs"], 2)
            self.assertEqual(metrics["exact_any_known_split_outputs"], 3)
            self.assertEqual(metrics["known_voice_skeleton_outputs"], 4)
            self.assertEqual(metrics["nonexact_outputs"], 3)
            self.assertEqual(metrics["nonexact_outputs_passing_reported_narrow_checks"], 2)
            self.assertTrue(any("absent" in report["coverage"] for _ in [0]))
            broken = next(row for row in report["nonexact_samples"] if row["text"].startswith("pool"))
            self.assertFalse(broken["controlled_grammar"])
            self.assertGreater(broken["word_edit_distance"], 1)

    def test_word_edits_do_not_reward_case_or_punctuation(self):
        self.assertEqual(module.distance(module.tokens("A calm pool."), module.tokens("a calm pool?")), 0)
        self.assertEqual(module.distance(module.tokens("a calm pool"), module.tokens("a quiet pool")), 1)
        self.assertEqual(module.distance(module.tokens("one two"), module.tokens("one three four")), 2)

    def test_batched_nearest_matches_exhaustive_distance(self):
        rows = [module.tokens(text) for text in ["a calm pool", "a quiet pool", "the pool moves slowly",
                                               "new tokens make a longer phrase", "the pool"]]
        nearest = module.NearestSentences(rows)
        for phrase in ["a calm pool", "one unseen word", "the pool moves", "a steady pool", "", "the pool moves slowly today"]:
            query = module.tokens(phrase)
            expected = min((module.distance(query, row), i) for i, row in enumerate(rows))
            self.assertEqual(nearest.find(query), expected)


if __name__ == "__main__":
    unittest.main()
