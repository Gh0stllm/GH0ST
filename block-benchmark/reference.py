"""Deterministic Q16/int4 reference for LFM layer zero; no model API calls."""
import math
import numpy as np

Q = 1 << 16
S = 1 << 24
SIG = 1 << 30
EPS_Q32 = 42950
MATRICES = [('conv.in_proj', 3072, 1024, 32), ('conv.out_proj', 1024, 1024, 32),
            ('feed_forward.w1', 2560, 1024, 32), ('feed_forward.w3', 2560, 1024, 32),
            ('feed_forward.w2', 1024, 2560, 16)]


def div(a, b):
    a = np.asarray(a, dtype=object)
    return np.where(a < 0, -((-a) // b), a // b).astype(np.int64)


def checked(a):
    a = np.asarray(a, dtype=np.int64)
    if np.any(a < -(1 << 31)) or np.any(a >= (1 << 31)):
        raise OverflowError('Q16 signed int32 range exceeded')
    return a


def pack(a):
    return checked(a).astype('>i4').tobytes()


def unpack(b):
    return np.frombuffer(b, dtype='>i4').astype(np.int64)


def norm(x, gamma):
    root = math.isqrt(sum(int(v)*int(v) for v in x) // 1024 + EPS_Q32)
    return checked(div(x * gamma, root))


def project(x, matrix, scales):
    return checked(div((matrix @ x).astype(object) * scales, S))


def silu(x, lut):
    x = np.asarray(x, dtype=np.int64)
    clipped = np.clip(x, -16 * Q, 16 * Q - 1)
    shifted = clipped + 16 * Q
    index, frac = shifted // 1024, shifted % 1024
    sig = lut[index] + ((lut[index + 1] - lut[index]) * frac) // 1024
    sig = np.where(x <= -16 * Q, 0, np.where(x >= 16 * Q, SIG, sig))
    return checked(div(x * sig, SIG))


def block(x, history, matrices, gamma, conv, lut):
    n1 = norm(x, gamma[:1024])
    proj = project(n1, *matrices[0])
    b, c, v = np.split(proj, 3)
    bx = checked(div(b * v, Q))
    # The sum of three int32 products can exceed int64 even though the final
    # scaled value is valid. Solidity uses int256 for these intermediates.
    cv = div(history[0].astype(object) * conv[:, 0] + history[1].astype(object) * conv[:, 1]
             + bx.astype(object) * conv[:, 2], S)
    gated = checked(div(c.astype(object) * cv, Q))
    cp = project(gated, *matrices[1])
    residual = checked(x + cp)
    n2 = norm(residual, gamma[1024:])
    w1 = project(n2, *matrices[2])
    w3 = project(n2, *matrices[3])
    act = checked(div(silu(w1, lut) * w3, Q))
    w2 = project(act, *matrices[4])
    output = checked(residual + w2)
    return {'input':x, 'norm1':n1, 'in_projection':proj, 'bx':bx, 'convolution':gated,
            'out_projection':cp, 'residual':residual, 'norm2':n2,
            'w1':w1, 'w3':w3, 'activation':act, 'w2':w2, 'output':output}, [history[1].copy(), bx]
