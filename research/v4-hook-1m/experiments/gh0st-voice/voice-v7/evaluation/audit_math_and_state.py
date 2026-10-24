#!/usr/bin/env python3
"""Independent dense-loss, recurrence, punctuation and lane tests for V7."""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import torch
from torch.nn import functional as F

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent/'training'))
from model import VoiceModel, objective, V, H, BOS, UNK
from engine import tensor_batch, Stream
from prepare import parse


def cell(x, h, wx, wh, bias):
    incoming = x @ wx.T + bias
    recur = h @ wh.T
    reset = torch.sigmoid(incoming[:, :H] + recur[:, :H])
    update = torch.sigmoid(incoming[:, H:2*H] + recur[:, H:2*H])
    proposal = torch.tanh(incoming[:, 2*H:] + reset*recur[:, 2*H:])
    return update*h + (1-update)*proposal


def independent_forward(m, batch, initial=None):
    b, width = batch['x'].shape
    one, two = (m.wx1.new_zeros((b, H)), m.wx1.new_zeros((b, H))) if initial is None else initial
    outputs = []
    for t in range(width):
        keep = (~batch['resets'][:, t]).to(m.wx1.dtype)[:, None]
        one, two = one*keep, two*keep
        embed = m.embedding.weight[batch['x'][:, t]] + m.punct_embedding.weight[batch['prev_punct'][:, t]]
        one = cell(embed, one, m.wx1, m.wh1, m.bh1+m.domain.weight[batch['domains'][:, t]])
        two = cell(one, two, m.wx2, m.wh2, m.bh2)
        outputs.append(two)
    return torch.stack(outputs, 1), (one, two)


def independent_loss(m, batch):
    hidden, final = independent_forward(m, batch)
    h = hidden.reshape(-1, H)
    target = batch['y'].reshape(-1)
    safe = target.clamp_max(V-1)
    group = safe//64
    gl = h@m.groups.weight.T + m.group_bias.weight[:, 0]
    group_nll = torch.logsumexp(gl, 1)-gl[torch.arange(len(h)), group]
    # Evaluate all8192 word logits, then select the independently normalized class.
    wl = (h@m.words.weight.T+m.word_bias.weight[:, 0]).reshape(-1, 128, 64)
    within = wl[torch.arange(len(h)), group]
    word_nll = torch.logsumexp(within, 1)-within[torch.arange(len(h)), safe%64]
    word_mask = batch['word_mask'].reshape(-1)
    word_mean = ((group_nll+word_nll)*word_mask).sum()/word_mask.sum()
    pl = h@m.punct_head.weight.T+m.punct_bias
    pl = pl + (target<V)[:, None]*m.word_punct_bias.weight[safe]
    ptarget = batch['punct'].reshape(-1)
    punct_nll = torch.logsumexp(pl, 1)-pl[torch.arange(len(h)), ptarget]
    valid = batch['valid'].reshape(-1)
    return word_mean+(punct_nll*valid).sum()/valid.sum(), hidden, final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists()
    torch.set_num_threads(2)
    torch.manual_seed(714)
    m = VoiceModel(np.ones(V)).double().eval()
    m.dropout = 0.
    y = np.array([[5, UNK, 9, 12, UNK, 100], [300, 301, 302, UNK, 400, UNK]], dtype=np.int64)
    punct = np.array([[0, 1, 2, 3, 4, 0], [0, 2, 0, 1, 4, 3]], dtype=np.int64)
    x = np.concatenate([np.full((2, 1), BOS), y[:, :-1]], axis=1)
    pp = np.concatenate([np.zeros((2, 1), dtype=np.int64), punct[:, :-1]], axis=1)
    reset = np.zeros_like(y, dtype=bool)
    reset[:, 0] = True
    reset[1, 4] = True
    x[1, 4], pp[1, 4] = BOS, 0
    valid = np.ones_like(y, dtype=np.float64)
    valid[1, -1] = 0
    arrays = {'x': x, 'y': y, 'prev_punct': pp, 'punct': punct, 'resets': reset,
              'domains': np.zeros_like(y), 'valid': valid, 'word_mask': valid*(y<V)}
    batch = tensor_batch(arrays, 'cpu')
    other = copy.deepcopy(m)
    packed, counts, _, hidden = objective(m, batch)
    direct, expected_h, expected_state = independent_loss(other, batch)
    packed.backward()
    direct.backward()
    grad_errors = {name: float((p.grad-dict(other.named_parameters())[name].grad).abs().max())
                   for name, p in m.named_parameters() if p.grad is not None}
    max_gradient_error = max(grad_errors.values())
    with torch.no_grad():
        full, full_state = m(batch['x'], batch['prev_punct'], batch['resets'], batch['domains'])
        first, first_state = m(batch['x'][:, :3], batch['prev_punct'][:, :3], batch['resets'][:, :3], batch['domains'][:, :3])
        second, second_state = m(batch['x'][:, 3:], batch['prev_punct'][:, 3:], batch['resets'][:, 3:], batch['domains'][:, 3:], first_state)
        chunk_error = max(float((full-torch.cat([first, second], 1)).abs().max()), *(float((a-b).abs().max())for a,b in zip(full_state,second_state)))
        step_states = (torch.zeros(2, H, dtype=torch.float64), torch.zeros(2, H, dtype=torch.float64))
        step_outputs = []
        for t in range(y.shape[1]):
            keep = (~batch['resets'][:,t])[:,None]
            step_states = tuple(h*keep for h in step_states)
            step_states = m.step(batch['x'][:,t],batch['prev_punct'][:,t],step_states)
            step_outputs.append(step_states[1])
        step_error = float((full-torch.stack(step_outputs,1)).abs().max())
    # Unknown targets still train punctuation while contributing no lexical loss.
    unk_model = copy.deepcopy(m)
    unk_model.zero_grad(set_to_none=True)
    ph = torch.randn(1,H,dtype=torch.float64,requires_grad=True)
    F.cross_entropy(unk_model.punctuation_logits(ph,torch.tensor([UNK])),torch.tensor([4])).backward()
    unknown_punct_grad = float(unk_model.punct_head.weight.grad.abs().sum())
    unknown_word_bias_grad = float(unk_model.word_punct_bias.weight.grad.abs().sum())
    # A single coherent document crosses three chunks; only its true beginning resets.
    doc = {'id':'independent-toy','words':np.arange(10,17,dtype=np.int64),'punct':np.array([0,2,0,1,0,3,4]),'domain':0}
    stream = Stream(SimpleNamespace(rows={'train':{'original':[doc]}}),np.random.default_rng(11),1,3,{'original':1.})
    batches = [stream.next('cpu')[0] for _ in range(3)]
    stream_y = torch.cat([b['y'][0] for b in batches]).tolist()
    stream_x = torch.cat([b['x'][0] for b in batches]).tolist()
    stream_p = torch.cat([b['prev_punct'][0] for b in batches]).tolist()
    stream_r = torch.cat([b['resets'][0] for b in batches]).tolist()
    checks = {
        'dense_packed_loss': abs(float(packed-direct))<1e-10,
        'dense_packed_all_gradients':max_gradient_error<1e-10,
        'independent_recurrence':float((hidden-expected_h).abs().max())<1e-10,
        'chunked_state_matches_whole':chunk_error<1e-10,
        'single_step_matches_whole':step_error<1e-10,
        'unknown_target_punctuation_gradient_nonzero':unknown_punct_grad>0,
        'unknown_word_specific_punctuation_bias_gradient_zero':unknown_word_bias_grad==0,
        'unknown_embedding_context_gradient_nonzero':float(m.embedding.weight.grad[UNK].abs().sum())>0,
        'lane_word_targets':stream_y==[10,11,12,13,14,15,16,10,11],
        'lane_previous_words':stream_x==[BOS,10,11,12,13,14,15,BOS,10],
        'lane_previous_punctuation':stream_p==[0,0,2,0,1,0,3,0,0],
        'lane_resets_only_true_boundaries':stream_r==[True,False,False,False,False,False,False,True,False],
        'parser_basic_shift':parse('i wait. you go!')==(['i','wait','you','go'],[0,2,0,3]),
        'parser_unknown_keeps_punctuation':parse('i wait, strangeunseenword!')==(['i','wait','strangeunseenword'],[0,1,3]),
    }
    report = {'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,
              'loss_absolute_error':abs(float(packed-direct)),'max_parameter_gradient_error':max_gradient_error,
              'chunk_state_max_error':chunk_error,'step_state_max_error':step_error,
              'lexical_loss_positions':float(counts['word_count']),'punctuation_loss_positions':float(counts['punct_count']),
              'unknown_punctuation_gradient_l1':unknown_punct_grad,
              'parser_decimal_probe':parse('i paid 3.14 coins.'),
              'source_sha256':{name:hashlib.sha256((HERE.parent/'training'/name).read_bytes()).hexdigest() for name in ['model.py','engine.py','prepare.py','train.py']},
              'limitations':'Fixed float64 toy cases with dropout disabled; proves checked objective/state identities, not stochastic training quality or integer-EVM parity.'}
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':
    main()
