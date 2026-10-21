"""Four-bit integer weights with shared Q24 scale units; offline only.

Formats are newly quantized weights, not lossless versions of the six-bit model.
Each matrix has a 16-byte header, packed scale/zero records, then nibble codes.
Within each eight-code block, the first logical code occupies the low nibble.
"""
import hashlib
import json
from pathlib import Path
import numpy as np

Q = 1 << 24
PIN = '199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578'
CONFIGS = {
    'sym32_s8': (32, 8, False),
    'sym64_s12': (64, 12, False),
    'affine64_s12z4': (64, 12, True),
    'affine128_s12z4': (128, 12, True),
}


def pack(v, bits):
    a = np.asarray(v, dtype=np.uint64).reshape(-1)
    assert np.all(a < 1 << bits)
    expanded = (a[:, None] >> np.arange(bits-1, -1, -1, dtype=np.uint64)) & 1
    return np.packbits(expanded.astype(np.uint8).reshape(-1), bitorder='big').tobytes()


def unpack(data, bits, n):
    b = np.unpackbits(np.frombuffer(data, dtype=np.uint8), bitorder='big')[:bits*n]
    return (b.reshape(n, bits).astype(np.uint64) * (1 << np.arange(bits-1, -1, -1, dtype=np.uint64))).sum(1)


def encode(codes, scales, zeros, group, scale_bits, affine, unit):
    codes = np.asarray(codes, dtype=np.uint8).reshape(-1, group)
    scales = np.asarray(scales, dtype=np.uint64).reshape(-1)
    zeros = np.asarray(zeros, dtype=np.uint64).reshape(-1)
    assert len(codes) == len(scales) == len(zeros) and np.all(codes < 16)
    assert np.all((scales > 0) & (scales < 1 << scale_bits))
    assert np.all(zeros < 16) and (affine or np.all(zeros == 8))
    assert 0 < unit < 1 << 24 and group in (32, 64, 128)
    meta = (scales << 4) | zeros if affine else scales
    header = b'G4Q1' + len(scales).to_bytes(4, 'big') + bytes([group, scale_bits, int(affine), 0]) + unit.to_bytes(4, 'big')
    return header + pack(meta, scale_bits + 4*affine) + pack(codes.reshape(-1, 8)[:, ::-1], 4)


def decode(blob):
    assert blob[:4] == b'G4Q1'
    n = int.from_bytes(blob[4:8], 'big')
    group, bits, affine, reserved = blob[8:12]
    unit = int.from_bytes(blob[12:16], 'big')
    assert group in (32, 64, 128) and bits in (8, 12) and affine in (0, 1) and reserved == 0
    width = bits + 4*affine
    end = 16 + (n*width+7)//8
    assert len(blob) == end + n*group//2 and 0 < unit < 1 << 24
    meta = unpack(blob[16:end], width, n).astype(np.int64)
    scales = meta >> 4 if affine else meta
    zeros = meta & 15 if affine else np.full(n, 8, dtype=np.int64)
    assert np.all(scales > 0)
    codes = unpack(blob[end:], 4, n*group).reshape(-1, 8)[:, ::-1].reshape(n, group).astype(np.int64)
    return codes, scales, zeros, unit


def quantize(weight, importance, variant):
    """Activation-diagonal weighted clipping search. Not AWQ or GPTQ.

    Select integer scale/zero records directly in the deployed format. Search
    uses calibration activations only, never evaluation prompts or outputs.
    """
    group, bits, affine = CONFIGS[variant]
    shape = weight.shape
    assert len(shape) == 2 and shape[1] % group == 0
    x = np.asarray(weight, dtype=np.float32).reshape(-1, group)
    importance = np.maximum(np.asarray(importance, dtype=np.float32), 1e-12)
    importance /= importance.mean()
    # A bounded floor avoids ignoring low-activation channels altogether.
    importance = np.clip(importance, .01, 100.)
    importance = np.tile(importance.reshape(-1, group), (shape[0], 1))
    xmin, xmax = np.minimum(x.min(1), 0), np.maximum(x.max(1), 0)
    base = np.maximum((xmax-xmin)/15 if affine else np.maximum(xmax/7, -xmin/8), 1/Q)
    unit = max(1, int(np.ceil(float(base.max()) * Q / ((1 << bits)-1))))
    unit_float = unit / Q
    best_error = np.full(len(x), np.inf, dtype=np.float64)
    best_s = np.ones(len(x), dtype=np.int64)
    best_z = np.full(len(x), 8, dtype=np.int64)
    best_c = np.zeros_like(x, dtype=np.uint8)
    for ratio in np.linspace(.65, 1.05, 17):
        si = np.clip(np.rint(base*ratio/unit_float), 1, (1 << bits)-1).astype(np.int64)
        scale = (si*unit_float).astype(np.float32)
        center = np.clip(np.rint(-xmin/scale), 0, 15).astype(np.int64) if affine else np.full(len(x), 8)
        for dz in ([-1, 0, 1] if affine else [0]):
            z = np.clip(center+dz, 0, 15)
            c = np.clip(np.rint(x/scale[:, None])+z[:, None], 0, 15).astype(np.uint8)
            restored = (c.astype(np.float32)-z[:, None])*scale[:, None]
            error = np.sum((restored-x)**2 * importance, axis=1)
            improve = error < best_error
            best_error[improve] = error[improve]
            best_s[improve], best_z[improve], best_c[improve] = si[improve], z[improve], c[improve]
    blob = encode(best_c, best_s, best_z, group, bits, affine, unit)
    c, s, z, u = decode(blob)
    assert np.array_equal(c, best_c) and np.array_equal(s, best_s) and np.array_equal(z, best_z) and u == unit
    restored = ((c-z[:, None])*(s*unit)[:, None]).astype(np.float32).reshape(shape)/Q
    return blob, restored, {'group': group, 'scale_bits': bits, 'affine_zero': affine,
                           'scale_unit_q24': unit, 'weighted_mse': float(best_error.sum()/importance.sum())}


def export(model, originals, moments, variant, folder):
    import torch
    folder = Path(folder)/variant
    folder.mkdir(parents=True, exist_ok=True)
    entries, parts = [], []
    cursor = 16 + 32*len(originals)
    error, norm = 0., 0.
    with torch.no_grad():
        for name, parameter in model.named_parameters():
            original = originals[name]
            if original.ndim == 2:
                blob, decoded, info = quantize(original.numpy(), moments[name], variant)
                diff = decoded.astype(np.float64)-original.numpy()
                error += float(np.square(diff).sum())
                norm += float(np.square(original.numpy().astype(np.float64)).sum())
                parameter.copy_(torch.from_numpy(decoded))
            else:
                blob = original.to(torch.bfloat16).view(torch.uint16).numpy().astype('<u2').tobytes()
                decoded = torch.from_numpy(np.frombuffer(blob, dtype='<u2').copy()).view(torch.bfloat16).float().reshape(original.shape)
                assert torch.equal(decoded, original)
                parameter.copy_(decoded)
                info = {}
            entries.append({'name': name, 'shape': list(original.shape), 'matrix': original.ndim == 2,
                            'offset': cursor, 'byte_count': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(), **info})
            parts.append(blob)
            cursor += len(blob)
    descriptors = b''
    for e in entries:
        dims = e['shape'] + [0]*(4-len(e['shape']))
        descriptors += e['offset'].to_bytes(4, 'big') + e['byte_count'].to_bytes(4, 'big') + b''.join(d.to_bytes(4, 'big') for d in dims) + bytes([int(e['matrix']), len(e['shape'])]) + bytes(6)
    raw = b'GH0ST4Q1' + len(entries).to_bytes(4, 'big') + bytes(4) + descriptors + b''.join(parts)
    assert len(raw) == cursor
    manifest = {'variant': variant, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                'source_checkpoint_sha256': PIN, 'four_bit_matrix_weights': True, 'original_bf16_nonmatrix': True,
                'relative_matrix_weight_squared_error': error/norm, 'tensors': entries}
    (folder/'weights.bin').write_bytes(raw)
    (folder/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    return manifest


def load_into_model(model, folder):
    import torch
    folder = Path(folder)
    manifest = json.loads((folder/'manifest.json').read_text())
    raw = (folder/'weights.bin').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == manifest['sha256']
    tensors = {t['name']: t for t in manifest['tensors']}
    with torch.no_grad():
        for name, parameter in model.named_parameters():
            t = tensors[name]
            blob = raw[t['offset']:t['offset']+t['byte_count']]
            assert hashlib.sha256(blob).hexdigest() == t['sha256']
            if t['matrix']:
                c, s, z, u = decode(blob)
                decoded = torch.from_numpy(((c-z[:, None])*(s*u)[:, None]).astype(np.float32)/Q).reshape(t['shape'])
            else:
                decoded = torch.from_numpy(np.frombuffer(blob, dtype='<u2').copy()).view(torch.bfloat16).float().reshape(t['shape'])
            parameter.copy_(decoded)
    return manifest
