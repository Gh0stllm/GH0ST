import json
from pathlib import Path
import random
import unittest

from analysis_codec import BOS, EOS, FIRST_WORD, SEP, WORDS, decode_words, encode_features, encode_words, validate_features, vocabulary_spec
from dataset import label, split_of
from evaluate_analysis import allowed_clauses


class AnalysisSpecificationTests(unittest.TestCase):
    def test_fixed_offsets_and_prompt(self):
        features = [1, 1, 15, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1]
        self.assertEqual(encode_features(features), [1, 5, 7, 23, 26, 29, 32, 35, 38, 41, 43, 45, 47, 49, 51, 3])

    def test_malformed_features_reject(self):
        good = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        for bad in ([], good[:-1], good + [0], [True] + good[1:], [2] + good[1:],
                    good[:2] + [16] + good[3:], [0] + good[1:]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                encode_features(bad)

    def test_no_code_semantics(self):
        for n in (0, 1):
            values = [0, n, *([0] * 11), 1]
            self.assertEqual(len(encode_features(values)), 16)
            self.assertTrue(label(values).startswith("No runtime code observed."))
            self.assertNotIn("EOA", label(values))
            self.assertNotIn("safe.", label(values))

    def test_word_codec_roundtrip(self):
        text = "Runtime code observed. Safety and value remain unknown."
        self.assertEqual(decode_words(encode_words(text)), text)

    def test_noncanonical_words_reject(self):
        for text in ("", " Runtime", "Runtime ", "Runtime  code", "Runtime\tcode", "Runtimecode", "safe.", "€"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                encode_words(text)

    def test_reserved_or_input_outputs_reject(self):
        valid = encode_words("Runtime code observed.")
        for ids in ([], [EOS], valid[:-1], valid + [EOS], [0, EOS], [1, EOS], [3, EOS],
                    [4, EOS], [51, EOS], [52, EOS], [63, EOS], [FIRST_WORD + len(WORDS), EOS],
                    [511, EOS], [valid[0], EOS, valid[1], EOS], [valid[0], True, EOS]):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                decode_words(ids)

    def test_uncertainty_and_incomplete_scan(self):
        f = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        report = label(f)
        self.assertIn("Scan incomplete; detected patterns are partial.", report)
        self.assertNotIn("Selected scan patterns absent.", report)
        self.assertIn("Safety and value remain unknown.", report)
        self.assertNotIn("Zero owner reported.", report)

    def test_reported_getter_is_not_authority_claim(self):
        f = [1, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
        self.assertIn("Owner getter is unverified.", label(f))
        self.assertNotIn("privilege", label(f))

    def test_combination_holdout_rule(self):
        self.assertEqual(split_of([1, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 1, 0, 1]), "combination_test")

    def test_all_random_label_clauses_supported_and_bounded(self):
        rng = random.Random(107)
        for _ in range(5000):
            f = [1, rng.randrange(2), rng.randrange(16),
                 *(rng.randrange(3) for _ in range(6)), *(rng.randrange(2) for _ in range(5))]
            response = label(f)
            self.assertLessEqual(len(encode_words(response)), 32)
            clauses = [part + "." for part in response[:-1].split(". ")]
            self.assertTrue(set(clauses) <= allowed_clauses(f), (f, response))

    def test_frozen_vocabulary_matches_file(self):
        self.assertEqual(json.loads((Path(__file__).parent / "vocabulary.json").read_text()), vocabulary_spec())


if __name__ == "__main__":
    unittest.main()
