#!/usr/bin/env python3
"""Measure lossless retained-state deltas, excluding live continuation state."""
from pathlib import Path
import hashlib, json, sys
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / '.cache/pylib'))
import zstandard as zstd

CACHE = HERE / '.cache/delta'
records = []
for start_requested, requested in [(0, 100000), (0, 200000), (100000, 200000)]:
    before_path = CACHE / ('retained-initial.bin' if start_requested == 0 else f'retained-{start_requested}.bin')
    before = np.fromfile(before_path, dtype=np.uint8)
    path = CACHE / f'retained-{requested}.bin'
    after = np.fromfile(path, dtype=np.uint8)
    assert before.size == after.size
    xor = np.bitwise_xor(before, after)
    changed = np.flatnonzero(xor)
    byte_runs = 0 if changed.size == 0 else 1 + int(np.count_nonzero(np.diff(changed) != 1))
    padded_size = ((after.size + 31) // 32) * 32
    padded_before = np.pad(before, (0, padded_size - before.size)).reshape(-1, 32)
    padded_after = np.pad(after, (0, padded_size - after.size)).reshape(-1, 32)
    dirty = np.flatnonzero(np.any(padded_before != padded_after, axis=1))
    dtype = np.dtype([('index', '<u4'), ('value', np.uint8, (32,))])
    log = np.empty(dirty.size, dtype=dtype)
    log['index'] = dirty
    log['value'] = padded_after[dirty]
    raw_log = log.tobytes()
    compressor = zstd.ZstdCompressor(level=3)
    compressed_log = compressor.compress(raw_log)
    compressed_xor = compressor.compress(memoryview(xor))
    restored_log = np.frombuffer(zstd.ZstdDecompressor().decompress(compressed_log), dtype=dtype)
    reconstructed = padded_before.copy()
    reconstructed[restored_log['index']] = restored_log['value']
    assert np.array_equal(reconstructed.reshape(-1)[:after.size], after)
    restored_xor = zstd.ZstdDecompressor().decompress(compressed_xor)
    assert np.array_equal(np.bitwise_xor(before, np.frombuffer(restored_xor, dtype=np.uint8)), after)
    dirty_pages = np.unique(changed // 4096).size
    records.append({
        'beforeRequestedTestNodes': start_requested,
        'requestedTestNodes': requested,
        'retainedStateBytes': int(after.size),
        'changedBytes': int(changed.size),
        'changedByteRuns': byte_runs,
        'dirty32ByteBlocks': int(dirty.size),
        'dirty4KiBPages': int(dirty_pages),
        'sparse32ByteLogBytes': len(raw_log),
        'sparse32ByteLogZstd3Bytes': len(compressed_log),
        'denseXorZstd3Bytes': len(compressed_xor),
        'smallestMeasuredPayloadBytes': min(len(compressed_log), len(compressed_xor)),
        'losslessRoundtripVerified': True,
        'beforeSHA256': hashlib.sha256(memoryview(before)).hexdigest(),
        'afterSHA256': hashlib.sha256(memoryview(after)).hexdigest(),
    })
record = {
    'scope': 'Native completed100k/200k test-search retained-state comparisons; both prefixes start from newgame; not live query-chunk continuation',
    'omits': ['recursive search stack', 'Asyncify stack', 'root move scratch', 'live position links', 'journals/auth', 'state commitment/Merkle proofs', 'query certificates'],
    'compression': {'zstandardPythonVersion': zstd.__version__, 'numpyVersion': np.__version__, 'level': 3},
    'records': records,
    'qualityLimit': 'Short searches are instrumentation only and are never candidate bot decisions; production still24m',
    'financialActions': False,
}
(HERE / 'evidence/retained-delta.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
