"""Exact integer sampled reference; requires NumPy and pycryptodome.

Seeds provide reproducible creative variation, not secure randomness. Explicit
seeds match Solidity generateSampled; default audit seeds are synthetic.
"""
from __future__ import annotations
import re
from pathlib import Path
import numpy as np
from Crypto.Hash import keccak
from quality_eval import IntegerModel, V, H, DEPTH

ROOT = Path(__file__).resolve().parents[1]


def hash256(value):
    return keccak.new(digest_bits=256, data=value).digest()


def seed_bytes(seed):
    if isinstance(seed, str):
        seed = bytes.fromhex(seed.removeprefix('0x'))
    if len(seed) != 32:
        raise ValueError('Seed must be exactly 32 bytes')
    return seed


class SampledIntegerModel(IntegerModel):
    def __init__(self, folder, temperature_q10=256, audit_seed=823114):
        super().__init__(folder)
        source = (ROOT/'contracts/SentenceSpeakerModel.sol').read_text()
        table = bytes.fromhex(re.search(r'SIGMOID_DELTA = hex"([0-9a-f]+)"', source).group(1))
        self.delta = np.frombuffer(table, dtype='>u2').astype(np.int64)
        assert len(self.delta) == 257
        self.temperature_q10 = temperature_q10
        self.audit_seed = audit_seed
        self.calls = 0

    def probability(self, scores):
        scores = np.asarray(scores, dtype=np.int64)
        index = np.minimum(256, (np.abs(scores)*1024//self.temperature_q10+32)//64)
        return np.where(scores >= 0, 32768+self.delta[index], 32768-self.delta[index])

    def step_sampled(self, previous, state, fs, seeds, word_index):
        hidden = self.hidden(previous, state, fs)
        entropy = [int.from_bytes(hash256(seed_bytes(seed)+int(word_index).to_bytes(32, 'big')), 'big') for seed in seeds]
        node = np.zeros(len(previous), dtype=np.int64)
        scores = []
        for depth in range(DEPTH):
            score = self.trunc((self.nodes[node]*hidden).sum(1)+self.bias[node]*1024)
            draw = np.asarray([(bits >> (16*depth)) & 65535 for bits in entropy], dtype=np.int64)
            node = node*2+1+(draw < self.probability(score))
            scores.append(score)
        return node-(V-1), hidden, np.asarray(scores).T

    def generate(self, previous, state, fs, limit=12, seeds=None):
        if seeds is None:
            seeds = [hash256(self.audit_seed.to_bytes(32, 'big')+self.calls.to_bytes(32, 'big')+j.to_bytes(32, 'big'))
                     for j in range(len(previous))]
        self.calls += 1
        ids, hidden = previous.copy(), state.copy()
        alive = np.ones(len(previous), dtype=bool)
        ended = np.zeros(len(previous), dtype=bool)
        sequences = [[] for _ in previous]
        for word_index in range(limit):
            token, next_hidden, _ = self.step_sampled(ids, hidden, fs, seeds, word_index)
            for j in np.flatnonzero(alive):
                sequences[j].append(int(token[j]))
                if self.vocabulary[token[j]].endswith(('.', '!', '?')):
                    ended[j] = True
            ids[alive], hidden[alive] = token[alive], next_hidden[alive]
            alive &= ~ended
            if not alive.any():
                break
        return ids, hidden, [{'tokens': row,
            'text': ' '.join(self.vocabulary[i] for i in row)+('' if ended[j] else '.'),
            'ended_naturally': bool(ended[j])} for j, row in enumerate(sequences)]
