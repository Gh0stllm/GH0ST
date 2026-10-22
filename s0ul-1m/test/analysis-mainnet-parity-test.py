"""No-RPC comparator regression checks; synthetic values are unit fixtures only."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

script = Path(__file__).resolve().parents[1] / 'scripts/analysis-mainnet-parity.py'
spec = importlib.util.spec_from_file_location('parity', script)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=p.ROOT / 'test')
        self.path = Path(self.temp.name) / 'unit-reference.json'
        logits = [[0] * 512 for _ in range(2)]
        logits[0][64] = 10
        logits[1][2] = 10
        self.ref = {'expectedGeneratedTokenIds': [64, 2], 'expectedDecodedText': 'unit fixture',
                    'decisions': [{'index': i, 'tokenId': token, 'logits': row}
                                  for i, (token, row) in enumerate(zip([64, 2], logits))], 'saturationCount': 0}
        self.path.write_text(json.dumps(self.ref))
        self.proof = {'result': 'PASS', 'complete': True, 'modelId': 'unit-model',
                      'promptTokenIds': [1, 3], 'promptHash': 'unit-prompt', 'factsHash': 'unit-facts',
                      'generatedTokenIds': [64, 2], 'response': 'unit fixture',
                      'decisions': [{'index': i, 'actualLogits': row,
                                     'logitsSha256': p.sha(p.dumps(row).encode())}
                                    for i, row in enumerate(logits)]}
    def tearDown(self): self.temp.cleanup()
    def compare(self): return p.compare(self.proof, b'unit snapshot', self.ref, self.path)
    def test_complete_exact_all_logits_tokens_text(self):
        r = self.compare()
        self.assertEqual(r['result'], 'PASS')
        self.assertEqual(r['matchingLogitCount'], 1024)
        self.assertTrue(r['eosVerified'])
    def test_partial_coverage_never_claims_complete(self):
        self.proof.update(result='PAUSED', complete=False)
        self.proof['decisions'] = self.proof['decisions'][:1]
        r = self.compare()
        self.assertEqual(r['result'], 'PARTIAL')
        self.assertFalse(r['complete'])
        self.assertEqual(r['comparedLogitCount'], 512)
    def test_one_numeric_logit_mismatch_fails_even_with_updated_capture_hash(self):
        row = self.proof['decisions'][0]
        row['actualLogits'] = row['actualLogits'].copy()
        row['actualLogits'][42] += 1
        row['logitsSha256'] = p.sha(p.dumps(row['actualLogits']).encode())
        r = self.compare()
        self.assertEqual(r['result'], 'FAIL')
        self.assertEqual(r['decisions'][0]['mismatchingLogitIndexes'], [42])
        self.assertEqual(r['matchingLogitCount'], 1023)
    def test_tampered_capture_hash_fails(self):
        self.proof['decisions'][0]['logitsSha256'] = 'bad'
        self.assertEqual(self.compare()['result'], 'FAIL')
    def test_final_missing_decision_fails(self):
        self.proof['decisions'].pop()
        self.assertEqual(self.compare()['result'], 'FAIL')
    def test_actual_token_or_stored_text_mismatch_fails(self):
        self.proof['generatedTokenIds'] = [65, 2]
        self.assertEqual(self.compare()['result'], 'FAIL')
        self.proof['generatedTokenIds'] = [64, 2]
        self.proof['response'] = 'edited'
        self.assertEqual(self.compare()['result'], 'FAIL')
    def test_duplicate_capture_index_rejected(self):
        self.proof['decisions'][1]['index'] = 0
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.compare()

if __name__ == '__main__': unittest.main()
