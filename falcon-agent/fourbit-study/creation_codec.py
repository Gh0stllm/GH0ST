"""Canonical Huffman creation payloads; decoded runtime/model bytes never change."""
import hashlib
import heapq
import json
from collections import Counter
from pathlib import Path
from eth_utils import keccak

ROOT = Path(__file__).resolve().parent


def lengths(data):
    counts = Counter(data)
    if len(counts) == 1:
        symbol = next(iter(counts))
        counts[(symbol + 1) % 256] = 1
    floor = 1
    while True:
        heap = [(max(count, floor), symbol, [symbol]) for symbol, count in counts.items()]
        heapq.heapify(heap)
        result = {symbol: 0 for symbol in counts}
        serial = 256
        while len(heap) > 1:
            a, _, sa = heapq.heappop(heap)
            b, _, sb = heapq.heappop(heap)
            for symbol in sa + sb:
                result[symbol] += 1
            heapq.heappush(heap, (a + b, serial, sa + sb))
            serial += 1
        if max(result.values()) <= 12:
            return result
        floor *= 2


def compressed_block(data):
    lens = lengths(data)
    order = sorted(lens, key=lambda s: (lens[s], s))
    maximum = max(lens.values())
    counts = [sum(lens[s] == n for s in order) for n in range(1, maximum + 1)]
    if max(counts) > 255:
        return None
    codes = {}
    code = previous = 0
    for symbol in order:
        width = lens[symbol]
        code <<= width - previous
        codes[symbol] = (code, width)
        code += 1
        previous = width
    output = bytearray()
    accumulator = held = bit_count = 0
    for symbol in data:
        value, width = codes[symbol]
        accumulator = (accumulator << width) | value
        held += width
        bit_count += width
        while held >= 8:
            held -= 8
            output.append((accumulator >> held) & 255)
        accumulator &= (1 << held) - 1
    if held:
        output.append(accumulator << (8 - held))
    return b'\1' + len(data).to_bytes(3, 'big') + bytes([maximum]) + bytes(counts) + bytes(order) + output


def block(data):
    raw = b'\0' + len(data).to_bytes(3, 'big') + data
    compressed = compressed_block(data)
    return compressed if compressed and len(compressed) < len(raw) else raw


def encode(payload, cuts=()):
    decoder = bytes.fromhex(json.loads((ROOT / 'creation/decoder.json').read_text())['bytecode'])
    points = [0] + sorted(set(x for x in cuts if 0 < x < len(payload))) + [len(payload)]
    parts = [block(payload[a:b]) for a, b in zip(points, points[1:])]
    runtime = b'\0' + payload
    body = keccak(runtime) + len(runtime).to_bytes(3, 'big') + len(parts).to_bytes(2, 'big') + b''.join(parts)
    return decoder + body + len(body).to_bytes(4, 'big')


def semantic_cuts(manifest, start, size):
    cuts = []
    for tensor in manifest['tensors']:
        offset = tensor['offset']
        end = offset + tensor['byte_count']
        if end <= start or offset >= start + size:
            continue
        cuts.extend([offset - start, end - start])
        if tensor.get('matrix'):
            # Matrix metadata ends after 16-byte header + two bytes per 64 weights.
            count = 1
            for n in tensor['shape']:
                count *= n
            cuts.append(offset + 16 + count // 64 * 2 - start)
    return [x for x in cuts if 0 < x < size]


def choose(payload, manifest, start):
    from local import initcode
    if len(initcode(payload)) + 120 <= 95000:
        return 'raw', initcode(payload)
    candidates = [('whole', encode(payload))]
    cuts = semantic_cuts(manifest, start, len(payload))
    if cuts:
        candidates.append(('tensor_sections', encode(payload, cuts)))
    return min(candidates, key=lambda item: len(item[1]))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', required=True, type=Path)
    parser.add_argument('--shard', type=int, default=18)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    data = args.weights.read_bytes()
    manifest = json.loads((ROOT/'selected-manifest.json').read_text())
    assert hashlib.sha256(data).hexdigest() == manifest['sha256']
    start = args.shard * 98303
    payload = data[start:start+98303]
    variant, code = choose(payload, manifest, start)
    args.output.write_bytes(code)
    print(json.dumps({'shard': args.shard, 'variant': variant, 'init_bytes': len(code), 'init_sha256': hashlib.sha256(code).hexdigest()}))
