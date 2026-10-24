#!/usr/bin/env python3
"""Independent packed-head gradient checks; never edits training or starts a run."""
import copy
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import torch
from torch.nn import functional as F

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'training'))
from model import BOS, G, H, UNK, V, W, VoiceModel, objective
from engine import packed_groups


def direct_objective(model, batch):
    """Compute each group's supervised rows directly, with no packing or padding."""
    hidden = model(batch['x'], batch['features'], batch['resets'], batch['domains'])
    h = hidden.reshape(-1, H)
    target = batch['y'].reshape(-1)
    mask = batch['mask'].reshape(-1)
    active = torch.nonzero(mask > 0, as_tuple=True)[0]
    labels = target[active]
    assert bool(((labels >= 0) & (labels < V)).all())
    group_logits = F.linear(h[active], model.groups.weight, model.group_bias.weight[:, 0])
    group_loss = F.cross_entropy(group_logits, labels // W, reduction='none')
    loss = (group_loss * mask[active]).sum()
    for group in torch.unique(labels // W).tolist():
        indices = active[labels // W == group]
        logits = F.linear(h[indices], model.words.weight[group*W:(group+1)*W],
                          model.word_bias.weight[group*W:(group+1)*W, 0])
        loss = loss + (F.cross_entropy(logits, target[indices] % W, reduction='none') * mask[indices]).sum()
    return loss


def case_batch(name):
    rng = np.random.default_rng(109)
    b, length = (3, 11) if name == 'mixed_groups_padding' else (2, 81)
    targets = rng.integers(0, V, size=(b, length), dtype=np.int64)
    if name == 'multiple_blocks_same_group':
        targets = rng.integers(4*W, 5*W, size=(b, length), dtype=np.int64)
    targets[:, 3] = UNK
    x = np.concatenate([np.full((b, 1), BOS, dtype=np.int64), targets[:, :-1]], axis=1)
    mask = np.ones((b, length), dtype=np.float32)
    mask[:, :2] = 0
    mask[targets == UNK] = 0
    # Nonbinary weights ensure the independent objective checks multiplication,
    # rather than accidentally relying on mask==1 everywhere.
    mask[0, -2:] = .5
    resets = np.zeros((b, length), dtype=bool)
    resets[:, 0] = True
    resets[-1, length//2] = True
    x[-1, length//2] = BOS
    domains = np.arange(b)[:, None] % 2 + np.zeros((b, length), dtype=np.int64)
    features = rng.uniform(-1, 1, size=(b, length, 6)).astype(np.float32)
    pack, valid, groups = packed_groups(targets)
    batch = dict(x=x, y=targets, mask=mask, resets=resets, domains=domains,
                 features=features, pack_indices=pack, pack_valid=valid, pack_groups=groups)
    return {k: torch.from_numpy(v) for k, v in batch.items()}


def check_case(name):
    torch.manual_seed(100)
    model = VoiceModel(np.arange(1, V + 1)).double()
    model.dropout = 0
    with torch.no_grad():
        model.domain.weight[0].normal_(std=.025)
        model.domain.weight[1].normal_(std=.025)
    comparison = copy.deepcopy(model)
    batch = case_batch(name)
    for key in ('features', 'mask', 'pack_valid'):
        batch[key] = batch[key].double()
    packed_loss, n, _ = objective(model, batch)
    direct_loss = direct_objective(comparison, batch)
    packed_loss.backward()
    direct_loss.backward()
    errors = {}
    for (param_name, actual), (ref_name, expected) in zip(model.named_parameters(), comparison.named_parameters()):
        assert param_name == ref_name
        if actual.grad is None or expected.grad is None:
            raise AssertionError(f'Missing gradient: {param_name}')
        err = float((actual.grad - expected.grad).abs().max())
        errors[param_name] = err
        torch.testing.assert_close(actual.grad, expected.grad, atol=1e-10, rtol=1e-10)
    unk_norm = float(model.embedding.weight.grad[UNK].abs().sum())
    assert unk_norm > 0, 'UNK context must affect later known targets'
    assert model.words.num_embeddings == V, 'UNK must never become an output row'
    torch.testing.assert_close(packed_loss, direct_loss, atol=1e-9, rtol=1e-12)
    return {'name': name, 'known_weight': float(n), 'packed_loss': float(packed_loss.detach()),
            'direct_loss': float(direct_loss.detach()), 'max_gradient_error': max(errors.values()),
            'gradient_errors': errors, 'unk_input_gradient_l1': unk_norm,
            'pack_blocks': len(batch['pack_groups']),
            'padding_slots': int((batch['pack_valid'] == 0).sum()), 'status': 'PASS'}


def rng_resume_check():
    torch.manual_seed(17)
    saved_numpy = np.random.default_rng(9).bit_generator.state
    before = torch.get_rng_state().clone()
    expected = F.dropout(torch.ones(128), p=.5, training=True)
    torch.manual_seed(17)  # Current train.py restart does this, then initializes model.
    _ = VoiceModel(np.ones(V))
    resumed_without_state = F.dropout(torch.ones(128), p=.5, training=True)
    torch.set_rng_state(before)
    resumed_with_state = F.dropout(torch.ones(128), p=.5, training=True)
    assert not torch.equal(expected, resumed_without_state)
    assert torch.equal(expected, resumed_with_state)
    return {'numpy_state_available': bool(saved_numpy),
            'dropout_without_torch_state_matches': False,
            'dropout_with_torch_state_matches': True,
            'mps_rng_api_present': all(hasattr(torch.mps, k) for k in ('get_rng_state', 'set_rng_state'))}


def main():
    torch.set_num_threads(2)
    report = {'status': 'PASS', 'scope': 'CPU float64 independent objective and gradients; no training or EVM execution',
              'torch_version': torch.__version__, 'source_sha256': {},
              'cases': [check_case(k) for k in ('mixed_groups_padding', 'multiple_blocks_same_group')],
              'resume_rng_reproducer': rng_resume_check()}
    for name in ('model.py', 'engine.py', 'prepare.py', 'train.py'):
        report['source_sha256'][name] = hashlib.sha256((ROOT/'training'/name).read_bytes()).hexdigest()
    path = Path(__file__).with_name('training-audit.json')
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
