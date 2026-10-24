import json
from pathlib import Path
from types import SimpleNamespace
import unittest

import torch
import torch.nn.functional as F

from common import RESEARCH, loss_for, validate
from unlikelihood import repeated_candidates, unlikelihood_sum, training_loss_for, exempt_token_mask


def exemption(size=100):
    mask = torch.zeros(size, dtype=torch.bool)
    mask[:32] = True
    mask[70] = True
    return mask


class FixedModel(torch.nn.Module):
    def __init__(self, logits):
        super().__init__()
        self.logits = torch.nn.Parameter(logits)

    def forward(self, **kwargs):
        return SimpleNamespace(logits=self.logits)


class ObjectiveChecks(unittest.TestCase):
    def test_research_root(self):
        self.assertTrue((RESEARCH / 'experiments/simplestories-v2/model-cache/config.json').is_file())

    def test_explicit_word_mask_exempts_the_but_not_machine(self):
        vocabulary = {f'reserved-{i}': i for i in range(32)}
        vocabulary.update({'the': 32, 'machine': 33, 'it': 34})
        tokenizer = SimpleNamespace(
            backend_tokenizer=SimpleNamespace(to_str=lambda: json.dumps({'model': {'type': 'WordLevel'}})),
            get_vocab=lambda: vocabulary)
        mask = exempt_token_mask(tokenizer)
        self.assertTrue(bool(mask[:32].all()))
        self.assertTrue(bool(mask[32]))
        self.assertFalse(bool(mask[33]))
        self.assertTrue(bool(mask[34]))

    def test_gold_is_never_negative(self):
        ids = torch.tensor([[40, 40]])
        _, valid = repeated_candidates(ids, torch.tensor([[41, 40]]), exemption(), 32)
        self.assertFalse(bool(valid.any()))

    def test_function_word_and_reserved_tokens_exempt(self):
        for token in (0, 1, 15, 31, 70):
            _, valid = repeated_candidates(torch.tensor([[token, token]]), torch.tensor([[42, 42]]), exemption(), 32)
            self.assertFalse(bool(valid.any()))

    def test_one_occurrence_insufficient_and_duplicates_deduplicated(self):
        _, valid = repeated_candidates(torch.tensor([[40, 41, 42]]), torch.tensor([[45, 45, 45]]), exemption(), 32)
        self.assertFalse(bool(valid.any()))
        candidates, valid = repeated_candidates(torch.tensor([[40, 40, 40]]), torch.tensor([[45, 45, 45]]), exemption(), 32)
        self.assertEqual(candidates[0, -1][valid[0, -1]].tolist(), [40])

    def test_zero_loss_without_eligible_negatives(self):
        scores = torch.randn(1, 3, 100, requires_grad=True)
        value, details = unlikelihood_sum(scores, torch.tensor([[40, 41, 42]]), torch.tensor([[45, 45, 45]]), exemption())
        self.assertEqual(float(value.detach()), 0.0)
        self.assertEqual(details['negative_candidates'], 0)
        value.backward()
        self.assertEqual(float(scores.grad.abs().sum()), 0.0)

    def test_no_future_tokens_and_old_tokens_expire(self):
        ids = torch.tensor([[40, 40, 41, 42, 43]])
        candidates, valid = repeated_candidates(ids, torch.full_like(ids, 45), exemption(), 3)
        self.assertFalse(bool(valid[0, 0].any()))
        self.assertEqual(candidates[0, 1][valid[0, 1]].tolist(), [40])
        self.assertFalse(bool(valid[0, 4].any()))

    def test_ignored_positions_have_no_penalty(self):
        _, valid = repeated_candidates(torch.tensor([[40, 40, 40]]), torch.tensor([[45, -100, -100]]), exemption(), 32)
        self.assertFalse(bool(valid.any()))

    def test_scalar_reference_candidates(self):
        generator = torch.Generator().manual_seed(81)
        ids = torch.randint(38, 45, (3, 12), generator=generator)
        targets = torch.randint(38, 45, ids.shape, generator=generator)
        targets[0, 6] = -100
        blocked = exemption()
        candidates, valid = repeated_candidates(ids, targets, blocked, 5)
        for b in range(3):
            for t in range(12):
                context = ids[b, max(0, t-4):t+1].tolist()
                gold = int(targets[b, t])
                expected = sorted({x for x in context if context.count(x)>=2 and not blocked[x] and x!=gold}) if gold!=-100 else []
                self.assertEqual(candidates[b,t][valid[b,t]].tolist(), expected)

    def test_unlikelihood_matches_scalar_and_has_finite_gradient(self):
        scores = torch.zeros(1, 3, 100, requires_grad=True)
        value, details = unlikelihood_sum(scores, torch.tensor([[40, 40, 40]]), torch.tensor([[45, 45, 45]]), exemption())
        expected = -2 * torch.log(torch.tensor(1 - 1/100))
        self.assertTrue(torch.allclose(value, expected, atol=1e-6))
        self.assertEqual(details['negative_candidates'], 2)
        value.backward()
        self.assertTrue(bool(torch.isfinite(scores.grad).all()))
        self.assertGreater(float(scores.grad[0, -1, 40]), 0)

    def test_zero_alpha_matches_plain_ce_and_validation_stays_ce(self):
        model = FixedModel(torch.randn(1, 4, 4019, generator=torch.Generator().manual_seed(17)))
        ids = torch.tensor([[40, 40, 40, 45]])
        labels = ids.clone(); labels[:, 0] = -100
        batch = (ids, labels)
        plain, count = loss_for(model, batch, None)
        total, n, details = training_loss_for(model, batch, None, torch.zeros(4019,dtype=torch.bool), 0)
        self.assertEqual(n, count)
        self.assertTrue(torch.equal(total, plain))
        self.assertEqual(details['unlikelihood_sum'], 0)
        result = validate(model, [batch], None)
        self.assertAlmostEqual(result['loss'], float(plain.detach())/count)
        with_ul, _, parts = training_loss_for(model, batch, None, torch.zeros(4019,dtype=torch.bool), .2)
        self.assertGreater(float(with_ul.detach()), float(plain.detach()))
        self.assertGreater(parts['unlikelihood_sum'], 0)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ObjectiveChecks))
    Path(__file__).with_name('unit-checks.json').write_text(json.dumps({
        'status': 'PASS' if result.wasSuccessful() else 'FAIL',
        'checks': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
        'scope': 'Small deterministic objective checks only; no optimizer step or training run.'}, indent=2)+'\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
