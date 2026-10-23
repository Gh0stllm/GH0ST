#!/usr/bin/env python3
"""Read-only post-execution arithmetic validation; never drives chain execution."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone

for name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[name] = '1'
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'analysis-model'))
from s0ul.integer import IntegerModel
from s0ul.solidity_export import verify_export, keccak256
from analysis_codec import decode_words

MODEL_SHA = '9b6090a7639245180a6dbcc1ae69f379d3b9c5bd4c1c5981c78aa7035b50b97d'
PAYLOAD_SHA = 'b83416a49a7600136a9eb26c8d13b260ed4d4933ec0b1bff7fb5b6419579d901'
CHECKPOINT = '0x9cf0b5ce17109bda877f21ac08731cd1897bf6d160b4b690de809c750e960716'
EXECUTOR = '0x150e7f441bf5218d00716ad3b25a72d6e22423b5'
TARGET = '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559'

def sha(data): return hashlib.sha256(data).hexdigest()
def dumps(value): return json.dumps(value, sort_keys=True, separators=(',', ':'))
def utc(): return datetime.now(timezone.utc).isoformat()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    temp.replace(path)
def abi_ids(ids):
    word = lambda n: int(n).to_bytes(32, 'big')
    return word(32) + word(len(ids)) + b''.join(word(n) for n in ids)

def load_proof(path):
    raw = path.read_bytes()
    proof = json.loads(raw)
    if (proof.get('chainId') != 4663 or str(proof.get('jobId')) != '1'
        or proof.get('executor', '').lower() != EXECUTOR
        or proof.get('target', '').lower() != TARGET
        or proof.get('checkpoint') != CHECKPOINT
        or proof.get('modelManifestSha256') != MODEL_SHA
        or proof.get('modelPayloadSha256') != PAYLOAD_SHA):
        raise ValueError('Actual proof deployment/job/model identity mismatch')
    prompt = proof['promptTokenIds']
    if (len(prompt) != 16 or prompt[0] != 1 or prompt[-1] != 3
        or any(type(n) is not int or not 0 <= n < 512 for n in prompt)
        or keccak256(abi_ids(prompt)) != proof['promptHash']
        or keccak256(bytes.fromhex(proof['factsBytes'][2:])) != proof['factsHash']):
        raise ValueError('Actual on-chain prompt/facts binding mismatch')
    return proof, raw

def reference(proof):
    root = ROOT / 'analysis-model/evaluation-v2/solidity'
    manifest_raw = (root / 'model.json').read_bytes()
    if sha(manifest_raw) != MODEL_SHA: raise ValueError('Pinned manifest changed')
    manifest = verify_export(root)
    raw = (root / 'payload.bin').read_bytes()
    if sha(raw) != PAYLOAD_SHA or manifest['sourceCheckpoint'] != CHECKPOINT:
        raise ValueError('Pinned Solidity payload/checkpoint changed')
    arrays = {}
    for tensor in manifest['tensors']:
        block = raw[tensor['offset']:tensor['offset'] + tensor['nbytes']]
        arrays[tensor['name']] = np.frombuffer(block, dtype=tensor['dtype']).copy().reshape(tensor['shape'])
    config = manifest['config']
    model = IntegerModel(manifest['integerConfig'], arrays, eps_q28=config['epsQ28'],
                         attention_scale_q14=config['attentionScaleQ14'])
    prefix = proof['promptTokenIds'].copy()
    decisions, output = [], []
    started = time.monotonic()
    for index in range(32):
        # Independently recompute the full causal prefix. No cached attention,
        # authored response label, floating model or actual chain output is used.
        logits = model.forward(prefix)[-1].tolist()
        token = int(np.argmax(logits))
        decisions.append({'index': index, 'tokenId': token, 'logits': logits,
                          'logitsSha256': sha(dumps(logits).encode())})
        output.append(token)
        if token == 2: break
        prefix.append(token)
    if output[-1] != 2: raise ValueError('Independent reference did not reach EOS within 32')
    return {'format': 's0ul-mainnet-independent-integer-reference-v1',
        'validationOnly': True, 'drivesOnchainExecution': False, 'chainCalls': 0,
        'chainId': 4663, 'jobId': '1', 'executor': EXECUTOR, 'target': TARGET,
        'modelId': proof['modelId'], 'checkpoint': CHECKPOINT,
        'manifestSha256': MODEL_SHA, 'solidityPayloadSha256': PAYLOAD_SHA,
        'promptTokenIds': proof['promptTokenIds'], 'promptHash': proof['promptHash'],
        'factsHash': proof['factsHash'], 'expectedGeneratedTokenIds': output,
        'expectedDecodedText': decode_words(output), 'decisions': decisions,
        'reference': 'Untouched IntegerModel.forward over the full causal prefix for every decision; lowest-ID argmax tie rule.',
        'integerSourceSha256': sha((ROOT / 's0ul/integer.py').read_bytes()),
        'exportVerifierSourceSha256': sha((ROOT / 's0ul/solidity_export.py').read_bytes()),
        'validatorSourceSha256': sha(Path(__file__).read_bytes()),
        'fullForwardCalls': model.forward_count, 'saturationCount': model.saturation_count,
        'computedAt': utc(), 'cpuElapsedSeconds': time.monotonic() - started}

def compare(proof, proof_raw, ref, ref_path):
    captured = proof.get('decisions', [])
    seen, checks, errors = set(), [], []
    for item in captured:
        index, actual = item['index'], item['actualLogits']
        if type(index) is not int or index in seen or index < 0 or index >= len(ref['decisions']):
            raise ValueError('Duplicate or out-of-range captured decision index')
        seen.add(index)
        expected = ref['decisions'][index]
        valid = (len(actual) == 512 and all(type(n) is int for n in actual)
                 and sha(dumps(actual).encode()) == item['logitsSha256'])
        mismatch = [i for i, (a, b) in enumerate(zip(actual, expected['logits'])) if a != b]
        equal = valid and not mismatch
        token = int(np.argmax(actual)) if valid else None
        match = equal and token == expected['tokenId']
        checks.append({'index': index, 'all512LogitsMatch': equal,
                       'actualArgmaxTokenId': token, 'referenceTokenId': expected['tokenId'],
                       'argmaxMatches': token == expected['tokenId'],
                       'mismatchingLogitIndexes': mismatch,
                       'matchingLogitCount': 512 - len(mismatch) if valid else 0,
                       'observedAtBlock': item.get('observedAtBlock'),
                       'observedAtBlockHash': item.get('observedAtBlockHash')})
        if not match: errors.append(index)
    terminal = proof.get('result') == 'PASS' and proof.get('complete') is True
    output_match = proof.get('generatedTokenIds') == ref['expectedGeneratedTokenIds'] if terminal else None
    text_match = proof.get('response') == ref['expectedDecodedText'] if terminal else None
    coverage = sorted(seen) == list(range(len(ref['decisions'])))
    complete = terminal and coverage and not errors and output_match and text_match
    result = 'PASS' if complete else 'FAIL' if errors or terminal and not complete else 'PARTIAL'
    return {'format': 's0ul-mainnet-independent-integer-parity-v1', 'result': result,
        'complete': bool(complete), 'updatedAt': utc(), 'chainId': 4663, 'jobId': '1',
        'executor': EXECUTOR, 'target': TARGET, 'modelId': proof['modelId'],
        'checkpoint': CHECKPOINT, 'solidityPayloadSha256': PAYLOAD_SHA,
        'manifestSha256': MODEL_SHA, 'promptTokenIds': proof['promptTokenIds'],
        'promptHash': proof['promptHash'], 'factsHash': proof['factsHash'],
        'mainnetProofSha256AtSnapshot': sha(proof_raw),
        'mainnetProofResultAtSnapshot': proof.get('result'),
        'referenceFile': str(ref_path.relative_to(ROOT)),
        'referenceSha256': sha(ref_path.read_bytes()), 'expectedDecisionCount': len(ref['decisions']),
        'capturedDecisionCount': len(captured), 'comparedLogitCount': len(captured) * 512,
        'matchingLogitCount': sum(c['matchingLogitCount'] for c in checks),
        'allCapturedLogitsMatch': not errors, 'allDecisionsCaptured': coverage,
        'actualGeneratedTokenIds': proof.get('generatedTokenIds'),
        'actualGeneratedTokenIdsMatchReference': output_match, 'actualStoredTextMatchesReference': text_match,
        'actualStoredText': proof.get('response'), 'eosVerified': bool(terminal and output_match and proof['generatedTokenIds'][-1] == 2),
        'integerSaturationCount': ref['saturationCount'],
        'mainnetEngineSaturationCountAtSnapshot': proof.get('status', {}).get('saturationCount'),
        'receiptAuditAtSnapshot': proof.get('receiptAudit'), 'decisions': checks,
        'validatorSourceSha256': sha(Path(__file__).read_bytes()), 'chainCalls': 0,
        'externalAnalysisDataUsed': False, 'cpuOutputDrivesChain': False,
        'limits': ['Arithmetic parity for one actual on-chain input and this frozen model, not analyst accuracy or generalization.',
                   'Captured on-chain values and canonical financial evidence are supplied by the separate owner-invoked proof runner; this validator makes no RPC calls.',
                   'PARTIAL remains incomplete until every decision, final actual tokens and stored text are available in a completed canonical mainnet proof.']}

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--proof', type=Path, default=ROOT / 'reports/analysis-mainnet-generation-proof.json')
    p.add_argument('--reference', type=Path, default=ROOT / 'reports/analysis-mainnet-integer-reference.json')
    p.add_argument('--output', type=Path, default=ROOT / 'reports/analysis-mainnet-integer-parity.json')
    args = p.parse_args()
    proof, raw = load_proof(args.proof)
    solidity_root = ROOT / 'analysis-model/evaluation-v2/solidity'
    if sha((solidity_root / 'model.json').read_bytes()) != MODEL_SHA or sha((solidity_root / 'payload.bin').read_bytes()) != PAYLOAD_SHA:
        raise ValueError('Pinned manifest/payload changed before comparison')
    if args.reference.exists():
        ref = json.loads(args.reference.read_text())
        if (ref['manifestSha256'] != MODEL_SHA or ref['solidityPayloadSha256'] != PAYLOAD_SHA
            or ref['promptTokenIds'] != proof['promptTokenIds'] or ref['promptHash'] != proof['promptHash']
            or ref['modelId'] != proof['modelId'] or ref['factsHash'] != proof['factsHash']
            or ref['validatorSourceSha256'] != sha(Path(__file__).read_bytes())
            or ref['integerSourceSha256'] != sha((ROOT / 's0ul/integer.py').read_bytes())
            or ref['exportVerifierSourceSha256'] != sha((ROOT / 's0ul/solidity_export.py').read_bytes())):
            raise ValueError('Existing independent reference identity/source changed; do not overwrite it')
    else:
        ref = reference(proof)
        write(args.reference, ref)
    # The chain may have advanced while the CPU reference was computed.
    proof, raw = load_proof(args.proof)
    report = compare(proof, raw, ref, args.reference)
    write(args.output, report)
    print(json.dumps({key: report[key] for key in ('result', 'complete', 'expectedDecisionCount', 'capturedDecisionCount', 'comparedLogitCount', 'allCapturedLogitsMatch')}))
    if report['result'] == 'FAIL': raise SystemExit(1)

if __name__ == '__main__': main()
