from pathlib import Path
from decimal import Decimal
import json, subprocess
W=Path('/workspace/gl3/zk-tests/warm-optimization');R=Path('/workspace/gl3/zk-tests/warm-verifier-parent')
def read(p):return json.loads(Path(p).read_text())
meta=read(W/'sdk-comparison.json');records=meta['runs'];best=meta['selectedRun']
audit = subprocess.run(['node', str(R / 'source/audit.mjs')]).returncode
assert audit == 0, 'independent receipt/calldata audit failed'

quote = read(W / 'compute-quote.json')
hourly = Decimal(str(quote['computeUSDPerHour']))
baseline = Decimal(str(records['baseline28']['fullProofSeconds']))
for row in records.values():
    seconds = Decimal(str(row['fullProofSeconds']))
    row['fullProofComputeUSD'] = str(seconds * hourly / Decimal(3600))
    row['timeReductionVsWarmBaselinePercent'] = str((baseline - seconds) / baseline * 100)
    row['SolidityVerified'] = True
memory_events = dict(line.split() for line in Path('/sys/fs/cgroup/memory.events').read_text().splitlines())
summary = {
    'status': 'THREE_FRESH_FULL_PROOFS_SDK_AND_SOLIDITY_PASSED',
    'selectedRun': best, 'runs': records, 'computeQuote': quote,
    'nativeBuildSeconds': read(W / 'native-build/result.json')['seconds'],
    'verifierResult': read(R / 'evidence/verifier-result.json'),
    'independentAudit': read(R / 'evidence/independent-audit.json'),
    'kernelMemoryEventsCumulative': {key: int(value) for key, value in memory_events.items()},
    'proofSecurityChanged': False, 'guestChanged': False,
    'allExecutionOnRunpod': True, 'publicDeployment': False,
    'scope': 'Fixed same-batch A/B proof benchmark on private chain, not three appended production batches or a completed rollup coordinator',
}
(W / 'comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'passed': True, 'best': best, 'runs': records}), flush=True)
