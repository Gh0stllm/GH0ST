"""Lossless format change of the pinned, already quantized 6-bit model.

No training, no new quantization, no network or public deployment. Reconstructs
the ENTIRE previous export byte for byte, including its float32-derived scales.
Model binaries are written outside the distributable source archive.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
import zstandard as zstd

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'research-quality'))
from costs import layout

PIN = 'a0e3121e433f8fc000219ec629c0ab361749d9190f903118e7a96a7c4c29cead'


def pack(values, width):
    a = np.asarray(values, dtype=np.uint64).reshape(-1)
    assert width > 0 and np.all(a < (1 << width))
    bits = ((a[:, None] >> np.arange(width - 1, -1, -1, dtype=np.uint64)) & 1).astype(np.uint8)
    return np.packbits(bits.reshape(-1), bitorder='big').tobytes()


def unpack(data, width, count):
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8), bitorder='big')[:count * width]
    return (bits.reshape(count, width).astype(np.uint64) * (1 << np.arange(width - 1, -1, -1, dtype=np.uint64))).sum(1)


def bf16(x):
    u = np.asarray(x, dtype=np.float32).view(np.uint32)
    return ((u + 0x7fff + ((u >> 16) & 1)) >> 16).astype(np.uint16)


def bf16_q24(u):
    u = np.asarray(u, dtype=np.int64)
    exponent = (u >> 7) & 255
    # This pinned model's extrema are normal and exactly representable in Q24.
    assert np.all(((exponent >= 108) | (u == 0)) & (exponent < 138))
    magnitude = (128 + (u & 127)) << np.maximum(exponent - 110, 0)
    magnitude >>= np.minimum(np.maximum(110 - exponent, 0), 63)
    return np.where((u & 32768) != 0, -magnitude, magnitude)


def exact_scale(delta):
    """Match float32 division by 63 then round-to-nearest-even, in this range.

    Delta is itself exactly representable as float32 for ALL exported groups.
    The only difference from integer nearest rounding is float32 landing on
    n+1/2 near a threshold. For quotient below 2**21, these are the ranges below.
    """
    d = np.asarray(delta, dtype=np.int64)
    assert np.all((d > 0) & (d < 63 * (1 << 21)))
    q, r = d // 63, d % 63
    radius = np.where(q >= (1 << 20), 4, np.where(q >= (1 << 19), 2, np.where(q >= (1 << 18), 1, 0)))
    tie = (r >= 32 - radius) & (r <= 31 + radius)
    return np.maximum(1, np.where(tie, q + (q & 1), (d + 31) // 63))


def old_codes(blob, groups):
    bits = np.unpackbits(np.frombuffer(blob[8 * groups:], dtype=np.uint8), bitorder='little')
    return (bits.reshape(-1, 6) * (1 << np.arange(6))).sum(1).astype(np.uint8)


def encode_matrix(blob, groups):
    o = np.frombuffer(blob[:4 * groups], dtype='<i4').astype(np.int64)
    s = np.frombuffer(blob[4 * groups:8 * groups], dtype='<u4').astype(np.int64)
    lo = bf16(o.astype(np.float32) / (1 << 24))
    hi = bf16((o + s * 63).astype(np.float32) / (1 << 24))
    offsets, maxima = bf16_q24(lo), bf16_q24(hi)
    delta = maxima - offsets
    assert np.array_equal(offsets, o)
    assert np.array_equal(delta.astype(np.float32).astype(np.int64), delta)
    assert np.array_equal(exact_scale(delta), s)
    lb, hb = int(lo.min()), int(hi.min())
    lw, hw = max(1,int(lo.max() - lb).bit_length()), max(1,int(hi.max() - hb).bit_length())
    meta = ((lo.astype(np.uint64) - lb) << hw) | (hi.astype(np.uint64) - hb)
    header = b'F6B1' + groups.to_bytes(4, 'big') + lb.to_bytes(2, 'big') + hb.to_bytes(2, 'big') + bytes([lw, hw, 0, 0])
    codes = old_codes(blob, groups)
    # Each 8-code block is reversed before MSB-first packing. Its first logical
    # code is in the LOW 6 bits of a 48-bit word, ideal for the EVM widening kernel.
    packed = pack(codes.reshape(-1, 8)[:, ::-1].reshape(-1), 6)
    result = header + pack(meta, lw + hw) + packed
    return result, {'lo_bits': lw, 'hi_bits': hw, 'groups': groups,
                    'old_metadata_bytes': 8 * groups, 'new_metadata_and_header_bytes': len(result) - len(packed),
                    'float32_halfway_corrections': int((exact_scale(delta) != (delta + 31) // 63).sum())}


def decode_matrix(blob):
    assert blob[:4] == b'F6B1'
    g = int.from_bytes(blob[4:8], 'big')
    lb, hb = int.from_bytes(blob[8:10], 'big'), int.from_bytes(blob[10:12], 'big')
    lw, hw = blob[12], blob[13]
    n = (g * (lw + hw) + 7) // 8
    meta = unpack(blob[16:16 + n], lw + hw, g)
    lo, hi = lb + (meta >> hw), hb + (meta & ((1 << hw) - 1))
    offsets, maxima = bf16_q24(lo), bf16_q24(hi)
    scales = exact_scale(maxima - offsets)
    codes = unpack(blob[16 + n:], 6, g * 64).reshape(-1, 8)[:, ::-1].reshape(-1).astype(np.uint8)
    bits = ((codes[:, None] >> np.arange(6, dtype=np.uint8)) & 1).reshape(-1)
    return offsets.astype('<i4').tobytes() + scales.astype('<u4').tobytes() + np.packbits(bits, bitorder='little').tobytes()


def main():
    p = argparse.ArgumentParser();p.add_argument('--source', type=Path, required=True);p.add_argument('--output', type=Path, required=True);a = p.parse_args()
    src = (a.source / 'weights.bin').read_bytes();assert hashlib.sha256(src).hexdigest() == PIN
    manifest = json.loads((a.source / 'manifest.json').read_text());a.output.mkdir(parents=True, exist_ok=True)
    parts, entries, checks = [], [], []
    # 16-byte file header and 32-byte on-chain tensor descriptors, all counted.
    start = 16 + 32 * len(manifest['tensors'])
    for i, t in enumerate(manifest['tensors']):
        original = src[t['offset']:t['offset'] + t['byte_count']]
        if 'group_count' in t:
            encoded, stats = encode_matrix(original, t['group_count'])
            reconstructed = decode_matrix(encoded)
            check = {'name': t['name'], **stats}
        else:
            encoded = reconstructed = original;check = {'name': t['name'], 'original_bf16': True}
        assert reconstructed == original, t['name']
        check['exact_old_bytes_verified'] = True;checks.append(check)
        entries.append({**t, 'source_offset': t['offset'], 'source_byte_count': t['byte_count'], 'offset': start,
                        'byte_count': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest(),
                        'format': 'bf16_bounds_exact_q24_sixbit' if 'group_count' in t else 'original_bf16'})
        if 'group_count' in t:
            entries[-1].update(source_metadata_bytes=t['metadata_bytes'],tensor_header_bytes=16,
                               metadata_bytes=len(encoded)-16-t['group_count']*48)
        parts.append(encoded);start += len(encoded)
    descriptors = b''
    for e in entries:
        shape = e['shape'];rows = shape[0];cols = shape[1] if len(shape) > 1 else 0
        tail = b''.join((shape[j] if len(shape)>j else 0).to_bytes(4,'big') for j in [2,3])
        assert len(shape) <= 4
        descriptors += e['offset'].to_bytes(4, 'big') + e['byte_count'].to_bytes(4, 'big') + rows.to_bytes(4, 'big') + cols.to_bytes(4, 'big') + bytes([int('group_count' in e), len(shape)]) + tail + bytes(6)
    header = b'FC6BIT02' + len(entries).to_bytes(4, 'big') + bytes(4)
    assert len(header) == 16 and len(descriptors) == 32 * len(entries)
    data = header + descriptors + b''.join(parts);assert len(data) == start
    # Complete original-file recovery, including its header, in source order.
    restored = src[:manifest['tensors'][0]['offset']] + b''.join(decode_matrix(p) if 'group_count' in e else p for p,e in zip(parts,entries))
    assert restored == src
    (a.output / 'weights.bin').write_bytes(data)
    compressed = zstd.ZstdCompressor(level=19, threads=4).compress(data)
    assert zstd.ZstdDecompressor().decompress(compressed) == data
    (a.output / 'weights.zstd').write_bytes(compressed)
    output = {**{k:v for k,v in manifest.items() if k != 'tensors'}, 'variant': 'int6_exact_compact_v2',
              'source_sha256': PIN, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'tensors': entries,
              'lossless_zstd19_bytes': len(compressed), 'compressed_sha256': hashlib.sha256(compressed).hexdigest(),
              'code_deposit_gas_only': len(data)*200, 'compressed_code_deposit_gas_only': len(compressed)*200,
              'full_source_export_roundtrip_verified': True, 'training_performed': False}
    (a.output / 'manifest.json').write_text(json.dumps(output, indent=2)+'\n')
    report = {'status':'completed', 'source_sha256':PIN,'source_bytes':len(src), 'optimized_bytes':len(data),
              'optimized_sha256':output['sha256'],'bytes_saved':len(src)-len(data), 'storage_reduction_percent':100*(1-len(data)/len(src)),
              'tensor_count':len(entries),'groups':sum(t.get('group_count',0) for t in entries),
              'full_source_export_roundtrip_verified':True, 'additional_quantization':False, 'checks':checks,
              'layouts':{'previous':layout(src,61439),'compact':layout(data,61439)},
              'further_zstd_bytes':len(compressed),'zstd_warning':'Size experiment only; no on-chain Zstd decoder. Not the deployment choice.',
              'cost_scope':'Standard Cancun modeled creation gas; not live RH fee. Excludes engine/tokenizer, shard-address index, controller, L1 fees.',
              'exactness_scope':'Same codes, Q24 scales/offsets, BF16 nonmatrix values. Integer kernels are not float32 inference.'}
    (ROOT / 'format-results.json').write_text(json.dumps(report,indent=2)+'\n')
    (ROOT / 'weight-manifest.json').write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='checks'},indent=2))


if __name__ == '__main__': main()
