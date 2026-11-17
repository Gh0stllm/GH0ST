"""Bind completed fresh SDK runs and verify every proof on one private parent."""
from decimal import Decimal
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

W = Path('/workspace/gl3/zk-tests/warm-optimization')
R = Path('/workspace/gl3/zk-tests/warm-verifier-parent')
assert os.uname().nodename == 'cc91695a75f7'


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


old = read('/workspace/gl3/zk-tests/verifier-parent/proof-binding.json')
cases = {}
started = time.monotonic()
while True:
    assert time.monotonic() - started < 2400, 'comparison wait deadline'
    try:
        cases = {name: read(W / name / 'controller/result.json')
                 for name in ['baseline28', 'native28', 'native16']}
        break
    except (FileNotFoundError, json.JSONDecodeError):
        time.sleep(1)

checked_artifacts = set()
records = {}
for name, result in cases.items():
    assert result['passed'] and result['actualExitCode'] == 0
    assert result['cleanupRemainingCount'] == 0
    folder = W / name
    intent = W / (name + '-intent.json')
    assert sha(intent) == result['intentSHA256']
    for row in read(intent)['artifacts']:
        identity = (row['path'], row['SHA256'])
        if identity not in checked_artifacts:
            assert Path(row['path']).stat().st_size == row['bytes']
            assert sha(row['path']) == row['SHA256']
            checked_artifacts.add(identity)
    for filename, row in result['proofOutputs'].items():
        assert sha(folder / 'proof' / filename) == row['SHA256']
    bundle_path = folder / 'proof/evm-proof.json'
    bundle = read(bundle_path)
    pre = read(folder / 'proof/preproof-execution.json')
    actual = read(folder / 'controller/actual-exit.json')
    assert actual['actualExitCode'] == 0 and not actual['timedOut']
    assert bundle['nativeVerified'] and bundle['allFiveFieldsMatch']
    assert not bundle['mockProof'] and not bundle['networkProver']
    assert bundle['proofKind'] == 'Groth16' and bundle['transactions'] == 16 and bundle['chainId'] == 9
    assert bundle['programVKey'] == old['expectedProgramVKey']
    assert bundle['publicValues'] == old['expectedPublicValues']
    assert bundle['publicValues'] == pre['actualExecutionPublicValues'] == bundle['nativeExpectedPublicValues']
    assert bundle['nativeExpected'] == old['nativeFields']
    proof = (folder / 'proof/proof.bin').read_bytes()
    assert len(proof) == 260 and proof[:4].hex() == 'a4594c59'
    assert proof == bytes.fromhex(bundle['proofBytes'][2:])
    records[name] = {
        'id': name, 'bundlePath': str(bundle_path), 'bundleSHA256': sha(bundle_path),
        'sdkResultPath': str(folder / 'controller/result.json'),
        'sdkResultSHA256': sha(folder / 'controller/result.json'),
        'actualExitPath': str(folder / 'controller/actual-exit.json'),
        'actualExitSHA256': sha(folder / 'controller/actual-exit.json'),
        'preproofPath': str(folder / 'proof/preproof-execution.json'),
        'preproofSHA256': sha(folder / 'proof/preproof-execution.json'),
        'fullProofSeconds': bundle['fullProvingSecondsIncludingEVMWrapping'],
        'outerSeconds': result['outerSeconds'],
        'peakSampledOwnedRSSBytes': result['peakOwnedRSSBytes'],
    }

best = min(records, key=lambda name: Decimal(str(records[name]['fullProofSeconds'])))
primary = records[best]
binding = dict(old)
binding.update({
    'bundlePath': primary['bundlePath'], 'bundleSHA256': primary['bundleSHA256'],
    'sdkResultPath': primary['sdkResultPath'], 'sdkResultSHA256': primary['sdkResultSHA256'],
    'sdkActualExitPath': primary['actualExitPath'], 'sdkActualExitSHA256': primary['actualExitSHA256'],
    'preproofExecutionPath': primary['preproofPath'], 'preproofExecutionSHA256': primary['preproofSHA256'],
    'proofIntentSHA256': sha(W / (best + '-intent.json')),
    'proofBinarySHA256': sha(W / best / 'proof/proof.bin'),
    'selectedRun': best,
    'additionalProofs': [row for name, row in records.items() if name != best],
})
assert sha('/workspace/gl3/zk-tests/verifier/verifier-artifact.json') == binding['verifierArtifactSHA256']
assert sha(binding['workloadExportPath']) == binding['workloadExportSHA256']
binding_path = R / 'proof-binding.json'
assert not binding_path.exists(), 'preserve earlier verifier attempt first'
binding_path.write_text(json.dumps(binding, indent=2) + '\n')
(W / 'sdk-comparison.json').write_text(json.dumps({'selectedRun': best, 'runs': records,
                                                 'allSameGuestKeyAnd160PublicBytes': True}, indent=2) + '\n')
env = dict(os.environ, GL3_PROOF_BUNDLE=primary['bundlePath'], GL3_PROOF_BINDING=str(binding_path))
status = subprocess.run(['python3', str(R / 'source/verify-cloud.py')], env=env).returncode
assert status == 0, 'private verification failed; preserve evidence, no automatic retry'
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
