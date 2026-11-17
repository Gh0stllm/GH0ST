"""Runpod-only private binary/machine backup, with streaming verification."""
from pathlib import Path
import gzip
import hashlib
import json
import os
import shutil
import tarfile
import time

BASE = Path('/root/gl3-final-pairing')
OUT = BASE / 'ordinary05'
BACKUP = Path('/root/gl3-private-selected-backup')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()


def main():
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[-2:])
    BACKUP.mkdir(exist_ok=True, mode=0o700)
    archive = BACKUP / 'source05-node-validator-machine.tar.gz'
    if archive.exists():
        raise RuntimeError('Refusing to replace an existing private backup')
    machine = Path('/root/bounded-restore/fast-comparison/C-combined/machine')
    root = (machine / 'module-root.txt').read_text().strip().removeprefix('0x')
    members = {'bin/nitro': OUT / 'bin/nitro', 'bin/nitro-val': OUT / 'bin/nitro-val',
               'locks/artifact-lock.json': OUT / 'artifact-lock.json',
               'locks/operator-source-manifest.json': BASE / 'source05-freeze/manifest.json',
               'locks/base-host-source-manifest.json': Path('/root/gl3-host-execution-cache-orphans-v3/frozen-candidate-03/source-manifest.json'),
               'inputs/go-source-files.json': BASE / 'source05-closure/final03-source-source-files.json',
               'inputs/ordinary-source-closure.json': BASE / 'source05-closure/source-pairing.json',
               'build/build-ordinary05.py': BASE / 'build-ordinary05.py'}
    for name in ['machine.v2.wavm.br', 'until-host-io-state.bin', 'module-root.txt']:
        members['machines/' + root + '/' + name] = machine / name
    for p in (OUT / 'evidence').iterdir():
        if p.is_file():
            members['build/evidence/' + p.name] = p
    for p in (BASE / 'source05-freeze').rglob('*'):
        if p.is_file():
            members['source05/' + str(p.relative_to(BASE / 'source05-freeze'))] = p
    identities = {name: {'bytes': p.stat().st_size, 'SHA256': sha(p)} for name, p in members.items()}
    raw_bytes = sum(v['bytes'] for v in identities.values())
    baseline_scratch = sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file() and not p.is_symlink())
    if baseline_scratch + raw_bytes * 1.02 > 3_000_000_000 or shutil.disk_usage(BASE).free - raw_bytes * 1.02 < 6_000_000_000:
        raise RuntimeError('Conservative backup upper bound exceeds scratch or free-space guard')
    manifest = OUT / 'backup-member-manifest.json'
    manifest.write_text(json.dumps({'members': identities, 'runtimeArchiveOnlyNoActivation': True}, indent=2) + '\n')
    members['locks/backup-member-manifest.json'] = manifest
    identities['locks/backup-member-manifest.json'] = {'bytes': manifest.stat().st_size, 'SHA256': sha(manifest)}
    last_check = 0.0

    class GuardedReader:
        def __init__(self, file):
            self.file = file

        def read(self, count=-1):
            nonlocal last_check
            now = time.monotonic()
            if now - last_check > 0.25:
                last_check = now
                if shutil.disk_usage(BASE).free < 6_000_000_000 or baseline_scratch + archive.stat().st_size > 3_000_000_000:
                    raise RuntimeError('Backup resource guard reached')
            return self.file.read(count)

    started = time.time()
    with archive.open('xb') as output:
        os.chmod(archive, 0o600)
        with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=1, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|') as tar:
                for name, p in sorted(members.items()):
                    info = tar.gettarinfo(str(p), arcname=name)
                    with p.open('rb') as stream:
                        tar.addfile(info, GuardedReader(stream))
    compressed_sha = sha(archive)
    verified = {}
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            if not member.isfile() or member.name not in identities:
                raise RuntimeError('Unexpected archive member')
            h = hashlib.sha256()
            size = 0
            stream = tar.extractfile(member)
            for data in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(data)
                size += len(data)
            actual = {'bytes': size, 'SHA256': h.hexdigest()}
            if actual != identities[member.name]:
                raise RuntimeError('Archive byte mismatch: ' + member.name)
            verified[member.name] = actual
    if verified != identities:
        raise RuntimeError('Archive member set mismatch')
    receipt = {'passed': True, 'archive': str(archive), 'compressedBytes': archive.stat().st_size,
               'compressedSHA256': compressed_sha, 'verifiedMembers': len(verified),
               'allDecompressedMemberBytesAndHashesMatch': True,
               'memberManifestSHA256': sha(manifest), 'seconds': time.time() - started,
               'diskFreeAfter': shutil.disk_usage(BASE).free,
               'allCompressionAndVerificationOnRunpod': True,
               'scope': 'Private lossless runtime/input-identity preservation; no binary executed or deployed'}
    (OUT / 'backup-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
