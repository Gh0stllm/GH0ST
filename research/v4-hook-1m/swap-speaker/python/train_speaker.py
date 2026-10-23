#!/usr/bin/env python3
"""Train a word-level recurrent model; each inference step emits one whole word.

Training uses a small disclosed synthetic grammar, not a pretrained general LLM.
The Solidity runtime will contain weights and vocabulary, not sentence templates.
"""
from __future__ import annotations
import copy
import hashlib
import json
import random
import struct
import sys
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from safetensors.torch import save_file

ROOT = Path(__file__).resolve().parents[1]
SCALE, HIDDEN, EMBED, FEATURES = 1024, 24, 12, 6
ADJECTIVES = [
    'calm quiet gentle steady measured patient settled smooth balanced peaceful soft relaxed'.split(),
    'active changing uneven restless uncertain shifting mixed lively brisk unsettled irregular watchful'.split(),
    'sharp rapid intense volatile turbulent forceful sudden strong abrupt wild noisy urgent'.split(),
]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def corpus():
    records = []
    for regime, adjectives in enumerate(ADJECTIVES):
        for adjective in adjectives:
            for noun in ['flow', 'movement', 'activity', 'rhythm']:
                for sentence in [f'I see {adjective} {noun}.', f'The {noun} looks {adjective}.',
                                 f'I am watching {adjective} {noun}.', f'Another swap brings {adjective} {noun}.',
                                 f'The pool feels {adjective} after this trade.']:
                    records.append({'sentence': sentence, 'regime': regime})
    # Remove repeated sentences from templates that do not depend on noun.
    return list({row['sentence']: row for row in records}.values())


def make_features(regime, rng):
    low, high = [(0, 40), (50, 180), (200, 900)][regime]
    move, ewma, previous = rng.integers(low, high + 1, 3)
    return [int(move * 4), int(ewma * 4), int(abs(move - previous) * 4),
            int(rng.integers(0, 301) * SCALE // 300),
            int(rng.choice([-SCALE, SCALE])), int(rng.choice([-SCALE, SCALE]))]


class Speaker(nn.Module):
    def __init__(self, vocab_size):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size + 1, EMBED)
        self.input_weight = nn.Parameter(torch.empty(HIDDEN, EMBED))
        self.recurrent_weight = nn.Parameter(torch.empty(HIDDEN, HIDDEN))
        self.feature_weight = nn.Parameter(torch.empty(HIDDEN, FEATURES))
        self.hidden_bias = nn.Parameter(torch.zeros(HIDDEN))
        self.output_weight = nn.Parameter(torch.empty(vocab_size, HIDDEN))
        self.output_bias = nn.Parameter(torch.zeros(vocab_size))
        for weight in [self.input_weight, self.recurrent_weight, self.feature_weight, self.output_weight]:
            nn.init.xavier_uniform_(weight)

    def step(self, previous, hidden, features):
        hidden = torch.clamp(F.linear(self.embedding(previous), self.input_weight)
                             + F.linear(hidden, self.recurrent_weight)
                             + F.linear(features, self.feature_weight) + self.hidden_bias, 0, 8)
        return F.linear(hidden, self.output_weight, self.output_bias), hidden

    def forward(self, tokens, features):
        hidden = torch.zeros(len(tokens), HIDDEN)
        outputs = []
        for index in range(tokens.shape[1]):
            logits, hidden = self.step(tokens[:, index], hidden, features)
            outputs.append(logits)
        return torch.stack(outputs, dim=1)


def tensors(records, vocab, seed):
    index = {word: i for i, word in enumerate(vocab)}
    longest = max(len(row['sentence'].split()) for row in records)
    tokens = torch.full((len(records), longest), len(vocab), dtype=torch.long)
    targets = torch.full_like(tokens, -100)
    features, rng = [], np.random.default_rng(seed)
    for i, row in enumerate(records):
        words = [index[word] for word in row['sentence'].split()]
        tokens[i, :len(words)] = torch.tensor([len(vocab)] + words[:-1])
        targets[i, :len(words)] = torch.tensor(words)
        features.append(make_features(row['regime'], rng))
    return tokens, targets, torch.tensor(features, dtype=torch.float32) / SCALE


def trunc(value):
    return value // SCALE if value >= 0 else -((-value) // SCALE)


def integer_step(previous, hidden, features, arrays):
    embedding = arrays['embedding.weight'][previous]
    state = []
    for row in range(HIDDEN):
        total = arrays['hidden_bias'][row] * SCALE
        total += sum(a * b for a, b in zip(embedding, arrays['input_weight'][row]))
        total += sum(a * b for a, b in zip(hidden, arrays['recurrent_weight'][row]))
        total += sum(a * b for a, b in zip(features, arrays['feature_weight'][row]))
        state.append(max(0, min(8192, trunc(total))))
    logits = [trunc(arrays['output_bias'][row] * SCALE
                    + sum(a * b for a, b in zip(state, arrays['output_weight'][row])))
              for row in range(len(arrays['output_bias']))]
    return max(range(len(logits)), key=lambda i: logits[i]), state, logits


def main():
    torch.set_num_threads(2)
    torch.manual_seed(466330)
    torch.use_deterministic_algorithms(True)
    records = corpus()
    random.Random(466330).shuffle(records)
    train_end, validation_end = int(len(records) * 0.75), int(len(records) * 0.875)
    splits = {'train': records[:train_end], 'validation': records[train_end:validation_end], 'test': records[validation_end:]}
    vocab = sorted({word for row in records for word in row['sentence'].split()})
    assert all(' ' not in word and len(word.encode()) <= 32 for word in vocab)
    assert set(vocab) <= {word for row in splits['train'] for word in row['sentence'].split()}
    data = {name: tensors(rows, vocab, 466331 + i) for i, (name, rows) in enumerate(splits.items())}
    model, optimizer = Speaker(len(vocab)), None
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.004, weight_decay=0.0001)
    best_loss, best_epoch, best_state, history = float('inf'), 0, None, []
    generator = torch.Generator().manual_seed(466330)
    for epoch in range(1, 241):
        model.train()
        tokens, targets, features = data['train']
        for selected in torch.randperm(len(tokens), generator=generator).split(128):
            optimizer.zero_grad(set_to_none=True)
            logits = model(tokens[selected], features[selected])
            loss = F.cross_entropy(logits.flatten(0, 1), targets[selected].flatten(), ignore_index=-100)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5)
            optimizer.step()
        model.eval()
        with torch.inference_mode():
            vx, vy, vf = data['validation']
            validation_loss = float(F.cross_entropy(model(vx, vf).flatten(0, 1), vy.flatten(), ignore_index=-100))
        history.append({'epoch': epoch, 'validation_loss': validation_loss})
        if validation_loss < best_loss - 1e-5:
            best_loss, best_epoch, best_state = validation_loss, epoch, copy.deepcopy(model.state_dict())
        if epoch - best_epoch >= 40: break
    model.load_state_dict(best_state)
    state_order = ['embedding.weight', 'input_weight', 'recurrent_weight', 'feature_weight', 'hidden_bias', 'output_weight', 'output_bias']
    arrays, flat, layout = {}, [], {}
    for name in state_order:
        q = torch.round(model.state_dict()[name] * SCALE).to(torch.int64)
        assert int(q.abs().max()) <= 32767
        arrays[name] = q.tolist()
        layout[name] = {'offset_elements': len(flat), 'shape': list(q.shape)}
        flat.extend(q.flatten().tolist())
    payload = b''.join(struct.pack('>h', value) for value in flat)
    packed_vocab = b''.join(word.encode().ljust(32, b'\0') for word in vocab)
    export = {'schema_version': 1, 'vocabulary': vocab, 'vocabulary_size': len(vocab), 'bos_token': len(vocab),
              'hidden_size': HIDDEN, 'embedding_size': EMBED, 'features': FEATURES, 'scale': SCALE,
              'parameters': len(flat), 'linear_multiply_accumulates_per_word': HIDDEN * (EMBED + HIDDEN + FEATURES) + len(vocab) * HIDDEN,
              'weights_hex': payload.hex(), 'vocabulary_hex': packed_vocab.hex(), 'layout': layout,
              'arithmetic': 'Q1024 int16 weights; signed truncation toward zero; hidden state clamped to [0,8192]; first argmax wins ties',
              'terminal_rule': 'word ends in a period; reset hidden state and previous token before the next swap',
              'weights_sha256': hashlib.sha256(payload).hexdigest(), 'vocabulary_sha256': hashlib.sha256(packed_vocab).hexdigest()}
    write_json(ROOT / 'model/integer-speaker.json', export)
    save_file({name: value.detach().contiguous() for name, value in model.state_dict().items()}, str(ROOT / 'model/speaker.safetensors'))
    write_json(ROOT / 'model/corpus.json', splits)
    generated, fixtures = [], []
    valid_sentences = {row['sentence'] for row in records}
    for regime in range(3):
        for sample in range(8):
            features = make_features(regime, np.random.default_rng(466340 + regime * 100 + sample))
            previous, hidden, words, complete = len(vocab), [0] * HIDDEN, [], False
            for position in range(16):
                token, updated, logits = integer_step(previous, hidden, features, arrays)
                word = vocab[token]
                if len(fixtures) < 80:
                    fixtures.append({'previous_token': previous, 'state': hidden, 'features': features, 'token': token,
                                     'word': word, 'terminal': word.endswith('.'), 'next_state': updated, 'logits': logits})
                words.append(word)
                previous, hidden = token, updated
                if word.endswith('.'):
                    complete = True
                    break
            sentence = ' '.join(words)
            generated.append({'regime': regime, 'features': features, 'words': words, 'sentence': sentence,
                              'completed_within_16_words': complete, 'matches_disclosed_training_grammar': sentence in valid_sentences})
    with torch.inference_mode():
        tx, ty, tf = data['test']
        test_logits = model(tx, tf)
        test_loss = float(F.cross_entropy(test_logits.flatten(0, 1), ty.flatten(), ignore_index=-100))
        active = ty != -100
        accuracy = float((test_logits.argmax(-1)[active] == ty[active]).float().mean())
    write_json(ROOT / 'reports/integer-fixtures.json', fixtures)
    write_json(ROOT / 'reports/generated-sentences.json', generated)
    report = {'schema_version': 1, 'vocabulary_size': len(vocab), 'parameters': len(flat),
              'linear_multiply_accumulates_per_word': export['linear_multiply_accumulates_per_word'],
              'training': {'epochs': epoch, 'best_epoch': best_epoch, 'validation_loss': best_loss},
              'split_sentences': {name: len(rows) for name, rows in splits.items()},
              'heldout_teacher_forced_word_accuracy': accuracy, 'heldout_cross_entropy': test_loss,
              'integer_greedy_generation': {'samples': len(generated), 'complete_sentences': sum(row['completed_within_16_words'] for row in generated),
                                             'matches_disclosed_grammar': sum(row['matches_disclosed_training_grammar'] for row in generated)},
              'fixtures': len(fixtures), 'weights_sha256': export['weights_sha256'],
              'scope': 'Research word-level recurrent language model trained on a small synthetic grammar; not a general-purpose LLM.',
              'limitations': ['Word predictions are visible output, not evidence of subjective thought or hidden reasoning.',
                             'Generation can repeat, lose coherence or disagree with market conditions.',
                             'Real pool data, financial usefulness and full-swap gas have not been validated.',
                             'Corpus-level holdout measures combinations within a disclosed grammar, not open-domain language skill.']}
    write_json(ROOT / 'reports/model-training.json', report)
    print(json.dumps(report, indent=2))
    print(json.dumps([row['sentence'] for row in generated[::8]], indent=2))


if __name__ == '__main__': main()
