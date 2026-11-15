#!/usr/bin/env python3
"""Extract exact dense-stack and feature-row fixtures from the pinned SF19 net.

The large NNUE file and all binary fixtures stay ignored. No network requests,
wallet, public chain, or deployment is used.
"""
from pathlib import Path
import hashlib
import json
import struct

ROOT = Path(__file__).resolve().parent
CHESS = ROOT.parent
NET = CHESS / 'engine/.cache/Stockfish/src/nn-1a298aa575a0.nnue'
CACHE = ROOT / '.cache'
CACHE.mkdir(exist_ok=True)
raw = NET.read_bytes()
expected = '1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2'
assert hashlib.sha256(raw).hexdigest() == expected
offset = 0
blocks = []
raw_zero_bytes = 0
def take(n):
    global offset
    out = raw[offset:offset+n]
    assert len(out) == n
    offset += n
    return out
def u32(): return struct.unpack('<I', take(4))[0]
def leb(expected_count, prefix=0, width=2):
    global raw_zero_bytes
    start = offset
    assert take(17) == b'COMPRESSED_LEB128'
    n = u32()
    data = take(n)
    # A byte below128 terminates one signed LEB integer. Validate the full count
    # in C-backed byte operations without allocating tens of millions of ints.
    term = data.translate(bytes(0 if i < 128 else 1 for i in range(256))).count(0)
    assert term == expected_count, (term, expected_count)
    values = []
    value = shift = 0
    zero_bytes = 0
    minimum = 2**31
    maximum = -2**31
    for byte in data:
        value |= (byte & 127) << shift
        shift += 7
        if byte < 128:
            if byte & 64: value -= 1 << shift
            if len(values) < prefix: values.append(value)
            zero_bytes += sum(((value >> (8*j)) & 255) == 0 for j in range(width))
            minimum = min(minimum,value); maximum = max(maximum,value)
            value = shift = 0
    assert len(values) == prefix
    raw_zero_bytes += zero_bytes
    blocks.append({'offset': start, 'encodedBytes': n+21, 'decodedValues': expected_count, 'decodedWidth':width,'zeroBytes':zero_bytes,'minimum':minimum,'maximum':maximum})
    return values

version, network_hash, description_size = u32(), u32(), u32()
assert version == 0x6A448AFA
description = take(description_size).decode()
transformer_hash = u32()
biases = leb(1024, 1024)
threat_start = offset
raw_zero_bytes += take(59808 * 1024).count(0)
leb(59808 * 8, width=4)
pair_start = offset
raw_zero_bytes += take(4560 * 1024).count(0)
leb(4560 * 8, width=4)
psq_rows = leb(22528 * 1024, 4 * 1024)
leb(22528 * 8, width=4)

stacks = []
for bucket in range(8):
    header = u32()
    start = offset
    canonical = bytearray()
    layers = []
    for n_in, n_out in [(1024, 32), (64, 32), (128, 1)]:
        b = list(struct.unpack('<'+'i'*n_out, take(4*n_out)))
        w = list(struct.unpack('<'+'b'*(n_in*n_out), take(n_in*n_out)))
        layers.append({'inputs': n_in, 'outputs': n_out, 'biases': b, 'weights': w})
        canonical += b''.join(struct.pack('>i', x) for x in b)
        canonical += bytes(x & 255 for x in w)
    original = raw[start:offset]
    raw_zero_bytes += original.count(0)
    assert len(original) == 35204
    (CACHE/f'stack-{bucket}-native.bin').write_bytes(original)
    (CACHE/f'stack-{bucket}-scalar.bin').write_bytes(canonical)
    packed = bytearray()
    for layer in layers:
        n_in, n_out = layer['inputs'], layer['outputs']
        packed += b''.join(struct.pack('>i', x) for x in layer['biases'])
        for group in range((n_in+11)//12):
            for row in range(n_out):
                word = 0
                for lane in range(12):
                    idx = group*12+lane
                    weight = layer['weights'][row*n_in+idx] if idx < n_in else 0
                    word |= (weight+128) << (20*(11-lane))
                packed += word.to_bytes(32, 'big')
    (CACHE/f'stack-{bucket}-packed.bin').write_bytes(packed)
    (CACHE/f'stack-{bucket}.json').write_text(json.dumps(layers)+'\n')
    stacks.append({'bucket': bucket, 'header': hex(header), 'fileOffset': start,
        'rawBytes':len(original), 'packedBytes':len(packed),
        'scalarSha256':hashlib.sha256(canonical).hexdigest(),
        'packedSha256':hashlib.sha256(packed).hexdigest()})
assert offset == len(raw), (offset, len(raw))

features = b''.join(struct.pack('>h', x) for x in biases)
for row in range(4):
    features += b''.join(struct.pack('>h', x) for x in psq_rows[row*1024:(row+1)*1024])
features += raw[threat_start:threat_start+4*1024]
(CACHE/'feature-rows.bin').write_bytes(features)
inputs = []
for name, data in [
    ('zero', bytes(1024)),
    ('sparse', bytes(((i*37+7)%128 if i%5==0 else 0) for i in range(1024))),
    ('half-sparse', bytes(((i*19+11)%128 if i%2==0 else 0) for i in range(1024))),
    ('dense', bytes((i*13+17)%128 for i in range(1024))),
    ('max', bytes([127])*1024),
]:
    (CACHE/f'input-{name}.bin').write_bytes(data)
    inputs.append({'name':name, 'sha256':hashlib.sha256(data).hexdigest(),
                   'nonzero':sum(x!=0 for x in data)})
report = {
 'scope':'Exact fixed-width dense NNUE component extraction; no Solidity chess/search engine',
 'stockfishCommit':'edb0d9db6731067ec50ce619ff372b463bc4dd5d',
 'networkSha256':expected, 'compressedFileBytes':len(raw), 'description':description,
 'version':hex(version),'networkHash':hex(network_hash),'transformerHash':hex(transformer_hash),
 'featureDimensions':{'threat':59808,'pawnPair':4560,'pieceSquare':22528,'accumulator':1024},
 'decodedRawParameterBytes':115114528,
 'decodedRawZeroBytes':raw_zero_bytes,
 'decodedRawNonzeroBytes':115114528-raw_zero_bytes,
 'layout':{'threatAndPairInt8Bytes':64368*1024,'pieceSquareInt16Bytes':22528*1024*2,
   'psqtInt32Bytes':86896*8*4,'transformBiasInt16Bytes':1024*2,'denseStacksBytes':35204*8},
 'denseStacks':stacks,'lebBlocks':blocks,'inputs':inputs,
 'inputsAreSyntheticTransformedVectors':True,
 'notImplemented':['board feature extraction','complete accumulator/PSQT evaluation','legal moves',
   'Stockfish search','transposition table','persistent search continuation','prize settlement'],
}
assert sum(report['layout'].values()) == report['decodedRawParameterBytes']
(ROOT/'network-layout.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'compressedFileBytes':len(raw),'decodedRawParameterBytes':report['decodedRawParameterBytes'],
 'stackRawBytes':stacks[0]['rawBytes'],'stackPackedBytes':stacks[0]['packedBytes'],'parsedToEOF':True}))
