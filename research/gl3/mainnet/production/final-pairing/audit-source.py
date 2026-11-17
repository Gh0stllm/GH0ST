"""Runpod-only source/dependency pairing audit; does not build or start nodes."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

OUT = Path('/root/gl3-final-pairing')
OLD = Path('/root/bounded-restore/fast-comparison/C-combined/native')
NEW = Path('/root/gl3-host-execution-cache-orphans-v3/nitro')
GO = '/root/bounded-restore/toolchain/go/bin/go'
KINDS = ['GoFiles', 'CgoFiles', 'CFiles', 'HFiles', 'CXXFiles', 'MFiles',
         'FFiles', 'SFiles', 'SwigFiles', 'SwigCXXFiles', 'SysoFiles', 'EmbedFiles']


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root, name):
    command = [GO, 'list', '-deps', '-json', '-mod=readonly', './cmd/nitro', './cmd/nitro-val']
    env = os.environ.copy()
    env['GOMAXPROCS'] = '2'
    started = time.time()
    process = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True)
    (OUT / (name + '-go-list.stderr')).write_text(process.stderr)
    (OUT / (name + '-metadata-exit.json')).write_text(json.dumps({
        'command': command, 'cwd': str(root), 'exitCode': process.returncode,
        'seconds': time.time() - started, 'buildOrNodeOrEngineExecuted': False,
    }, indent=2) + '\n')
    process.check_returncode()
    decoder = json.JSONDecoder()
    text, position, packages = process.stdout, 0, []
    while position < len(text):
        while position < len(text) and text[position].isspace():
            position += 1
        if position == len(text):
            break
        package, position = decoder.raw_decode(text, position)
        if package.get('Error') or package.get('DepsErrors'):
            raise RuntimeError('Go metadata reports package errors: ' + package['ImportPath'])
        packages.append(package)
    records = {}
    for package in packages:
        for kind in KINDS:
            for filename in package.get(kind, []):
                path = Path(package['Dir']) / filename
                key = package['ImportPath'] + '/' + kind + '/' + filename
                records[key] = {'path': str(path), 'SHA256': sha(path), 'bytes': path.stat().st_size}
    (OUT / (name + '-source-files.json')).write_text(json.dumps(records, indent=2, sort_keys=True) + '\n')
    (OUT / (name + '-packages.json')).write_text(json.dumps(packages, indent=2, sort_keys=True) + '\n')
    return records


def main():
    OUT.mkdir(exist_ok=True)
    before = inventory(OLD, 'old-cli-source')
    after = inventory(NEW, 'final03-source')
    changes = []
    for name in sorted(set(before) | set(after)):
        a, b = before.get(name), after.get(name)
        if a is None or b is None or a['SHA256'] != b['SHA256']:
            changes.append({'key': name, 'before': a, 'after': b})
    result = {
        'scope': 'Actual Go-selected ordinary node and validator dependency source closure; no build, node, search or proof execution',
        'oldSource': str(OLD), 'final03Source': str(NEW),
        'oldRecords': len(before), 'final03Records': len(after),
        'changedOrAddedOrRemoved': len(changes), 'changes': changes,
        'allExecutionOnRunpod': True,
    }
    (OUT / 'source-pairing.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'changes'}))


if __name__ == '__main__':
    main()
