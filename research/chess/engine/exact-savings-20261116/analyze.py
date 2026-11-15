#!/usr/bin/env python3
"""Reproduce explicit directional savings calculations from saved evidence."""
from pathlib import Path
import hashlib, json

HERE = Path(__file__).resolve().parent
CHESS = HERE.parents[1]
inputs = {
    'budget': CHESS / 'ops/hybrid/BUDGET_100.json',
    'prefix': HERE.parent / 'budget100/evidence/prefix-comparison.json',
    'probe': HERE / 'evidence/probe.json',
}
d = {key: json.loads(path.read_text()) for key, path in inputs.items()}
cost = d['budget']['costBasis']
rate = int(cost['cyclesPerICP'])
engine = int(cost['engineCycles'])
orchestration = int(cost['coordinatorAndRelayCycles'])
free_nnue = 1 - d['prefix']['baselineNNUEFraction']
affine_fraction = d['prefix']['results'][0]['affine'] / d['prefix']['results'][0]['instructions']
hit_fraction = d['probe']['affineCacheHitFraction']
record = {
    'scope': 'Saved local evidence plus native400k probe; no newIC measurement, no mainnet run',
    'qualityPolicyUnchanged': True,
    'affineCache': {
        'capacity': d['probe']['probe']['probe']['capacity'],
        'memoryBytes': d['probe']['probe']['probe']['capacity'] * d['probe']['probe']['probe']['entry_bytes'],
        'nativeInputReuseFraction': hit_fraction,
        'hypotheticalMeteredPrefixSavingIfSameReuseAndFreeLookup': hit_fraction * affine_fraction,
        'limitations': 'Different native/IC stop boundaries; small direct-mapped cache; only one position; lookup overhead excluded; all affine calls still executed in probe',
    },
    'scenarios': [],
    'inputSHA256': {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in inputs.items()},
    'promotion': 'None; no engine or deployment changed',
}
for decisions in [800, 1600]:
    record['scenarios'].append({
        'decisions': decisions,
        'representativeCurrentWorkICP': decisions * (engine + orchestration) / rate,
        'hypotheticalFreeNNUEWorkICP': decisions * (engine * free_nnue + orchestration) / rate,
        'hypotheticalFreeNNUEAndOrchestrationICP': decisions * engine * free_nnue / rate,
        'hypotheticalFreeNNUEWithSavedAllowanceICP': decisions * (engine * free_nnue + orchestration) / rate + cost['thirtyDayConservativeAllowanceICP'],
        'interpretation': 'Directional projection using a prefix work fraction and one fullsearch cost; not a universal lower bound or exact whole-game cost',
    })
(HERE / 'evidence/analysis.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
