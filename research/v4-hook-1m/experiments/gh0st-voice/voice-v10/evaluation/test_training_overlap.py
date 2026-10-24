"""Independent small-case checks of overlap boundaries and denominator semantics."""
import json
from pathlib import Path
import tempfile
import unittest

from training_overlap import audit_stream, load_training


class TrainingOverlapTest(unittest.TestCase):
    def run_audit(self, rows, tokens, punct=None, threshold=8):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'train.jsonl'
            path.write_text(''.join(json.dumps(row)+'\n' for row in rows))
            documents, positions, grams, sentences = load_training(path)
        vocabulary = [f'w{i}' for i in range(8192)]
        punct = punct or [0]*(len(tokens)-1)+[2]
        stream = {'id': 'test', 'words': [
            {'token': t, 'punct': p, 'text': vocabulary[t]+['', ',', '.', '!', '?'][p]}
            for t, p in zip(tokens, punct)]}
        return audit_stream(stream, documents, positions, grams, sentences, threshold, vocabulary)

    def test_document_boundaries_cannot_make_false_long_match(self):
        rows = [{'id':'a', 'token_ids':list(range(10)), 'punctuation':[0]*9+[2]},
                {'id':'b', 'token_ids':list(range(10,20)), 'punctuation':[0]*9+[2]}]
        result = self.run_audit(rows, list(range(20)))
        self.assertEqual(result['longest_contiguous_word_match']['words'], 10)
        self.assertEqual(result['matching_8gram_occurrences'], 6)
        self.assertEqual(result['total_output_8gram_occurrences'], 13)
        self.assertAlmostEqual(result['matching_8gram_fraction'], 6/13)

    def test_punctuation_ignored_for_words_but_required_for_sentences(self):
        rows = [{'id':'a', 'token_ids':list(range(12)), 'punctuation':[0]*11+[3]}]
        result = self.run_audit(rows, list(range(12)))
        self.assertEqual(result['longest_contiguous_word_match']['words'], 12)
        self.assertEqual(result['exact_sentence_overlap_count'], 0)
        exact = self.run_audit(rows, list(range(12)), [0]*11+[3])
        self.assertEqual(exact['exact_sentence_overlap_count'], 1)

    def test_duplicate_training_rows_do_not_inflate_fraction(self):
        rows = [{'id':str(i), 'token_ids':list(range(12)), 'punctuation':[0]*11+[2]} for i in range(3)]
        result = self.run_audit(rows, list(range(12)))
        self.assertEqual(result['matching_8gram_occurrences'], 5)
        self.assertEqual(result['matching_8gram_fraction'], 1)
        self.assertEqual(result['exact_sentence_overlap_count'], 1)
        self.assertEqual(len(result['exact_sentence_overlaps'][0]['training_matches']), 3)

    def test_unknown_and_prefix_cannot_cross_match(self):
        rows = [{'id':'a', 'token_ids':[0,1,8193,3,4,5,6,7,8], 'punctuation':[0]*8+[2]}]
        result = self.run_audit(rows, list(range(9)))
        self.assertEqual(result['longest_contiguous_word_match']['words'], 6)
        self.assertEqual(result['matching_8gram_occurrences'], 0)


if __name__ == '__main__':
    unittest.main()
