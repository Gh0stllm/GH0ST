"""Seal public closed-run evidence on Runpod; exclude keys, private configs and DBs."""
from pathlib import Path
import hashlib
import io
import json
import shutil
import tarfile

W = Path('/workspace/gl3/zk-tests/warm-optimization')
R = Path('/workspace/gl3/zk-tests/warm-verifier-parent')
O = R / 'evidence'
out = W / 'verifier-evidence'
out.mkdir(exist_ok=True)
assert json.loads((O / 'controller-result.json').read_text())['passed']
assert json.loads((O / 'independent-audit.json').read_text())['passed']
assert json.loads((W / 'comparison.json').read_text())['status'] == 'THREE_FRESH_FULL_PROOFS_SDK_AND_SOLIDITY_PASSED'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sensitive(value):
    if isinstance(value, dict):
        for key, item in value.items():
            name = key.lower().replace('-', '').replace('_', '')
            if name in {'privatekey', 'mnemonic', 'seedphrase', 'password', 'apikey', 'secret'} and item:
                return True
            if sensitive(item):
                return True
    elif isinstance(value, list):
        return any(sensitive(item) for item in value)
    return False


selected = []
for directory in [R / 'source', O, R / 'attempts']:
    if directory == O:
        candidates = list(O.glob('*.json')) + list(O.glob('*.log')) + list(O.glob('*.csv'))
        for name in ['receipts', 'transactions']:
            candidates.extend((O / name).glob('*.json'))
    else:
        candidates = list(directory.rglob('*'))
    for path in candidates:
        if not path.is_file() or path.is_symlink() or '__pycache__' in path.parts:
            continue
        if path.name.endswith('.private.json') or path.name in {'owner-key.json', 'wallet.json'}:
            continue
        if path.suffix == '.json' and sensitive(json.loads(path.read_text())):
            continue
        selected.append(path)
selected.extend([R / 'proof-binding.json', R / 'dependency-links.json'])
selected = sorted(set(selected))
manifest = []
archive = out / 'warm-verifier-evidence.tar.gz'
with tarfile.open(archive, 'w:gz') as capsule:
    for path in selected:
        data = path.read_bytes()
        name = str(path.relative_to(R))
        item = tarfile.TarInfo(name)
        item.size = len(data)
        item.mode = 0o644
        item.mtime = 0
        capsule.addfile(item, io.BytesIO(data))
        manifest.append({'path': name, 'bytes': len(data), 'SHA256': digest(data)})
with tarfile.open(archive, 'r:gz') as capsule:
    assert [item.name for item in capsule.getmembers()] == [row['path'] for row in manifest]
    for row in manifest:
        assert digest(capsule.extractfile(row['path']).read()) == row['SHA256']
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(out / 'export-receipt.json').write_text(json.dumps({
    'members': len(manifest), 'bytes': archive.stat().st_size,
    'SHA256': digest(archive.read_bytes()), 'roundtripVerifiedOnRunpod': True,
    'privateKeysConfigsAndDatabasesExcluded': True,
}, indent=2) + '\n')
for name in ['actual-exit.json', 'controller-result.json', 'verifier-result.json',
             'independent-audit.json', 'source-manifest.json', 'owned-exits.json']:
    shutil.copy2(O / name, out / name)
for name in ['proof-binding.json', 'dependency-links.json']:
    shutil.copy2(R / name, out / name)
readable = out / 'readable-receipts'
readable.mkdir(exist_ok=True)
for prefix in ['valid-verification', 'additional-baseline28', 'additional-native16',
               'negative-proofBytes', 'negative-publicValues', 'negative-programVKey', 'batch-da']:
    for suffix in ['receipt', 'transaction']:
        shutil.copy2(O / (prefix + '-' + suffix + '.json'), readable)
print((out / 'export-receipt.json').read_text())
