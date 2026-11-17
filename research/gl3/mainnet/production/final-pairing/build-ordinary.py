"""Runpod-only ordinary final03 binaries. No node/service/engine is started."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import signal
import subprocess
import time

BASE = Path('/root/gl3-final-pairing')
SOURCE = Path('/root/gl3-host-execution-cache-orphans-v3/nitro')
GO = '/root/bounded-restore/toolchain/go/bin/go'
MIN_FREE = 6_000_000_000
MAX_SCRATCH = 1024 ** 3


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def scratch_bytes():
    return sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file() and not p.is_symlink())


def main():
    (BASE / 'bin').mkdir(exist_ok=True)
    (BASE / 'tmp').mkdir(exist_ok=True)
    (BASE / 'build').mkdir(exist_ok=True)
    source_manifest = json.loads((Path('/root/gl3-host-execution-cache-orphans-v3/frozen-candidate-03') / 'source-manifest.json').read_text())
    for filename, expected in source_manifest['sourceFiles'].items():
        if sha(SOURCE / filename) != expected:
            raise RuntimeError('Frozen host source mismatch: ' + filename)
    env = os.environ.copy()
    env['PATH'] = str(Path(GO).parent) + ':' + env['PATH']
    env['GOMAXPROCS'] = '2'
    env['TMPDIR'] = str(BASE / 'tmp')
    results = []
    for name in ['nitro', 'nitro-val']:
        free_before = shutil.disk_usage(BASE).free
        if free_before < MIN_FREE:
            raise RuntimeError('Disk safety floor prevents a new build')
        command = [GO, 'build', '-p', '2', '-mod=readonly',
                   '-ldflags=-extldflags=-Wl,-z,noexecstack',
                   '-o', str(BASE / 'bin' / name), './cmd/' + name]
        started = time.time()
        stopped_reason = None
        with (BASE / 'build' / (name + '.log')).open('w') as log:
            process = subprocess.Popen(command, cwd=SOURCE, env=env, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            while process.poll() is None:
                if shutil.disk_usage(BASE).free < MIN_FREE or scratch_bytes() > MAX_SCRATCH:
                    stopped_reason = 'Disk safety floor or task scratch limit reached'
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                    break
                time.sleep(1)
            actual_exit = process.wait()
        # Persist actual child exit before optional artifact processing.
        result = {'name': name, 'command': command, 'source': str(SOURCE),
                  'actualExitCode': actual_exit, 'seconds': time.time() - started,
                  'stoppedReason': stopped_reason, 'diskFreeBefore': free_before,
                  'diskFreeAfter': shutil.disk_usage(BASE).free,
                  'taskScratchBytesAfter': scratch_bytes(), 'allExecutionOnRunpod': True}
        (BASE / 'build' / (name + '-exit.json')).write_text(json.dumps(result, indent=2) + '\n')
        results.append(result)
        (BASE / 'build' / 'results.json').write_text(json.dumps({'results': results}, indent=2) + '\n')
        if actual_exit != 0:
            return actual_exit if actual_exit > 0 else 1
        binary = BASE / 'bin' / name
        result.update({'binaryBytes': binary.stat().st_size, 'binarySHA256': sha(binary)})
        (BASE / 'build' / (name + '-artifact.json')).write_text(json.dumps(result, indent=2) + '\n')
        for label, args in [('go-metadata', [GO, 'version', '-m', str(binary)]),
                            ('elf-program-headers', ['readelf', '-W', '-l', str(binary)]),
                            ('dynamic-libraries', ['ldd', str(binary)])]:
            p = subprocess.run(args, capture_output=True, text=True)
            (BASE / 'build' / (name + '-' + label + '.txt')).write_text(p.stdout + p.stderr)
            if p.returncode:
                raise RuntimeError(label + ' failed')
        # Help is parsed before stack/node/JWT initialization. Validator has no
        # dedicated version flag; its Go metadata supplies the main identity.
        args = [str(binary), '--version'] if name == 'nitro' else [str(binary), '--help']
        p = subprocess.run(args, capture_output=True, text=True, timeout=15, cwd=BASE, env=env)
        (BASE / 'build' / (name + '-smoke.stdout')).write_text(p.stdout)
        (BASE / 'build' / (name + '-smoke.stderr')).write_text(p.stderr)
        (BASE / 'build' / (name + '-smoke-exit.json')).write_text(json.dumps({
            'args': args, 'actualExitCode': p.returncode, 'nodeStarted': False,
            'engineExecuted': False, 'serviceBound': False,
        }, indent=2) + '\n')
        if p.returncode:
            return p.returncode
    for filename, expected in source_manifest['sourceFiles'].items():
        if sha(SOURCE / filename) != expected:
            raise RuntimeError('Frozen source changed during build: ' + filename)
    (BASE / 'build' / 'completed.json').write_text(json.dumps({
        'passed': True, 'ordinaryBuilds': 2, 'sourceUnchanged': True,
        'modelOrMachineChanged': False, 'nodeStarted': False,
        'serviceBound': False, 'genesisAccepted': False,
        'diskFreeAfter': shutil.disk_usage(BASE).free,
        'taskScratchBytesAfter': scratch_bytes(),
    }, indent=2) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
