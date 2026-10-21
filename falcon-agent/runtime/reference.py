"""Independent sequential Falcon-H1 reference for the pinned deployed export.

History-form Mamba is algebraically equivalent to its scalar-decay recurrence.
Q32 arithmetic and adaptive int16 matrix inputs are an additional numerical
approximation; agreement with the float32 quantized-weight model must be tested.
"""
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent
STUDY = ROOT.parent / 'fourbit-study'
sys.path.insert(0, str(STUDY))
from codec import decode

ONE = 1 << 32
Q24 = 1 << 24
LN2 = round(math.log(2) * ONE)
PI = round(math.pi * ONE)
TAU = round(2 * math.pi * ONE)
PIN = '9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9'


def div(a, b):
    return (abs(int(a)) // abs(int(b))) * (-1 if (a < 0) != (b < 0) else 1)


def mul(a, b):
    return div(int(a) * int(b), ONE)


def exp(x):
    if x <= -32 * ONE:
        return 0
    if x > 20 * ONE:
        raise ValueError('Q32 exponential outside validated range')
    n = x // LN2
    r = x - n * LN2
    total = term = ONE
    for k in range(1, 14):
        term = div(mul(term, r), k)
        total += term
    return total << n if n >= 0 else total >> -n


def log(x):
    assert x > 0
    n = 0
    while x >= 2 * ONE:
        x >>= 1
        n += 1
    while x < ONE:
        x <<= 1
        n -= 1
    y = div((x - ONE) * ONE, x + ONE)
    y2 = mul(y, y)
    term = total = y
    for k in range(3, 28, 2):
        term = mul(term, y2)
        total += div(term, k)
    return 2 * total + n * LN2


def silu(x):
    if x >= 20 * ONE:
        return x
    if x <= -32 * ONE:
        return 0
    # Stable form avoids exp(-x) overflowing for a large negative input.
    if x < 0:
        e = exp(x)
        return div(x * e, ONE + e)
    return div(x * ONE, ONE + exp(-x))


def softplus(x):
    return x if x >= 20 * ONE else log(ONE + exp(x))


def sincos(x):
    x %= TAU
    if x > PI:
        x -= TAU
    s = ts = x
    c = tc = ONE
    for k in range(1, 15):
        ts = -div(mul(mul(ts, x), x), (2 * k) * (2 * k + 1))
        tc = -div(mul(mul(tc, x), x), (2 * k - 1) * (2 * k))
        s += ts
        c += tc
    return s, c


def bf16_q32(raw):
    out = []
    for b in np.frombuffer(raw, dtype='<u2'):
        b = int(b)
        e = (b >> 7) & 255
        assert e != 255
        m = (b & 127) + (128 if e else 0)
        shift = e - 102 if e else -101
        v = m << shift if shift >= 0 else m >> -shift
        out.append(-v if b & 32768 else v)
    return out


class Model:
    def __init__(self, weights):
        raw = Path(weights).read_bytes()
        assert len(raw) == 48626528 and hashlib.sha256(raw).hexdigest() == PIN
        self.manifest = json.loads((STUDY / 'selected-manifest.json').read_text())
        self.w = {}
        self.w_float = {}
        self.tensors = self.manifest['tensors']
        for i, t in enumerate(self.tensors):
            blob = raw[t['offset']:t['offset'] + t['byte_count']]
            assert hashlib.sha256(blob).hexdigest() == t['sha256']
            if t['matrix']:
                c, s, z, u = decode(blob)
                v = ((c - z[:, None]) * (s * u)[:, None]).reshape(t['shape'])
                self.w[i] = torch.from_numpy(v.astype(np.float64))
                self.w_float[i] = self.w[i] / Q24
            else:
                self.w[i] = bf16_q32(blob)
                self.w_float[i] = np.asarray(self.w[i], dtype=np.float64).reshape(t['shape']) / ONE
        self.freq = [round(1e11 ** (-i / 32) * (1 << 64)) for i in range(32)]
        self.reset()

    def reset(self):
        self.history = [[] for _ in range(24)]
        self.conv = [[] for _ in range(24)]
        self.kv = [[] for _ in range(24)]
        self.position = 0
        self.traces = []

    def matrix(self, tensor, x, raw=False):
        maximum = max(map(abs, x)) or 1
        q = [(1 if v >= 0 else -1) * ((abs(v) * 32767 + maximum // 2) // maximum) for v in x]
        a = self.w[tensor].mv(torch.tensor(q, dtype=torch.float64)).tolist()
        # All integer dot products are <2**53, so float64 sums are exact here.
        if raw:
            return [int(v) for v in a]
        return [div(int(v) * maximum, 32767 * Q24) for v in a]

    def norm(self, x, tensor):
        variance = sum(v * v for v in x) // len(x) + 184467440737095
        root = math.isqrt(variance)
        return [mul(div(v * ONE, root), w) for v, w in zip(x, self.w[tensor])]

    def rope(self, x):
        out = list(x)
        for i in range(32):
            s, c = sincos((self.position * self.freq[i]) >> 32)
            for h in range(len(x) // 64):
                a, b = x[h * 64 + i], x[h * 64 + i + 32]
                out[h * 64 + i] = mul(a, c) - mul(b, s)
                out[h * 64 + i + 32] = mul(b, c) + mul(a, s)
        return out

    def step(self, token):
        assert 0 <= token < 32768 and self.position < 64
        h = [div(int(v) * 227, 8) for v in self.w[0][token].tolist()]
        layers = []
        for layer in range(24):
            b = 16 * layer
            n = self.norm(h, b + 15)
            p = self.matrix(b + 9, n)
            raw = p[768:1664]
            cvw = self.w[b + 7]
            cv = []
            for i in range(896):
                val = self.w[b + 8][i]
                for j in range(4):
                    lag = 3 - j
                    v = raw[i] if lag == 0 else self.conv[layer][-lag][i] if lag <= len(self.conv[layer]) else 0
                    val += mul(v, cvw[i * 4 + j])
                cv.append(silu(val))
            self.conv[layer].append(raw)
            self.conv[layer] = self.conv[layer][-3:]
            dt = [softplus(p[1664 + j] + self.w[b + 4][j]) for j in range(24)]
            a = [exp(v) for v in self.w[b + 5]]
            previous = self.history[layer][-1][2] if self.history[layer] else [0] * 24
            prefix = [v + t for v, t in zip(previous, dt)]
            u = [mul(cv[i], dt[i // 32]) for i in range(768)]
            self.history[layer].append((u, cv[768:832], prefix))
            dots = [div(sum(x * y for x, y in zip(old_b, cv[832:896])), ONE)
                    for _, old_b, _ in self.history[layer]]
            m = []
            for head in range(24):
                coeffs = [mul(exp(-mul(a[head], prefix[head] - old_prefix[head])), dot)
                          for (_, _, old_prefix), dot in zip(self.history[layer], dots)]
                for d in range(32):
                    i = head * 32 + d
                    y = sum(mul(k, old_u[i]) for (old_u, _, _), k in zip(self.history[layer], coeffs))
                    y += mul(cv[i], self.w[b + 6][head])
                    m.append(mul(y, silu(p[i])))
            mo = self.matrix(b + 10, m)
            q = self.rope(self.matrix(b + 11, n))
            k = self.rope(self.matrix(b + 12, n))
            v = self.matrix(b + 13, n)
            self.kv[layer].append((k, v))
            att = []
            for head in range(8):
                kh = head // 4
                scores = [div(sum(q[head * 64 + d] * oldk[kh * 64 + d] for d in range(64)), 8 * ONE)
                          for oldk, _ in self.kv[layer]]
                maximum = max(scores)
                probs = [exp(s - maximum) for s in scores]
                denominator = sum(probs)
                for d in range(64):
                    att.append(div(sum(p * oldv[kh * 64 + d] for p, (_, oldv) in zip(probs, self.kv[layer])), denominator))
            ao = self.matrix(b + 14, att)
            h = [x + y + z for x, y, z in zip(h, mo, ao)]
            n = self.norm(h, b + 16)
            g = self.matrix(b + 1, n)
            up = self.matrix(b + 2, n)
            f = [mul(silu(x), y) for x, y in zip(g, up)]
            down = self.matrix(b + 3, f)
            h = [x + y for x, y in zip(h, down)]
            layers.append(h.copy())
        final = self.norm(h, 385)
        logits = self.matrix(0, final, raw=True)
        best = max(range(32768), key=lambda i: logits[i])
        self.position += 1
        self.traces.append({'token': token, 'layers': layers, 'final': final, 'best': best})
        return best, logits
