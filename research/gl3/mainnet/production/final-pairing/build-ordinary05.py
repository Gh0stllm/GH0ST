"""Runpod-only source05 ordinary builds and configuration-only smoke.

No chain, service, engine, wallet, deployment or activation is started.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import signal
import subprocess
import time

BASE = Path('/root/gl3-final-pairing')
OUT = BASE / 'ordinary05'
SOURCE = BASE / 'source05'
GO = '/root/bounded-restore/toolchain/go/bin/go'
MIN_FREE = 6_000_000_000
MAX_SCRATCH = 3_000_000_000


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def scratch():
    return sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file() and not p.is_symlink())


def main():
    OUT.mkdir(exist_ok=True)
    for name in ['bin', 'tmp', 'evidence']:
        (OUT / name).mkdir(exist_ok=True)
    evidence = OUT / 'evidence'
    guard = json.loads(Path('/root/gl3-host-execution-cache-orphans-v3/frozen-candidate-03/source-manifest.json').read_text())['sourceFiles']
    guard.update(json.loads((BASE / 'source05-freeze/manifest.json').read_text())['sourceFiles'])
    for name, expected in guard.items():
        if sha(SOURCE / name) != expected:
            raise RuntimeError('Frozen host file mismatch: ' + name)
    closure = json.loads((BASE / 'source05-closure/source-pairing.json').read_text())
    expected = set(guard) - {'staker/experimental_execution_cache_test.go'}
    changed = set()
    for row in closure['changes']:
        path = row['key'].removeprefix('github.com/offchainlabs/nitro/')
        folder, filename = path.split('/GoFiles/', 1)
        changed.add(folder + '/' + filename)
    if changed != expected:
        raise RuntimeError('Ordinary dependency closure changed outside approved host files')
    env = os.environ.copy()
    env['PATH'] = str(Path(GO).parent) + ':' + env['PATH']
    env['GOMAXPROCS'] = '2'
    env['TMPDIR'] = str(OUT / 'tmp')
    cpus = sorted(os.sched_getaffinity(0))[-2:]
    results = []

    def execute(args, label, seconds=600):
        if shutil.disk_usage(BASE).free < MIN_FREE:
            raise RuntimeError('Disk safety floor prevents another command')
        started = time.time()
        reason = None
        with (evidence / (label + '.stdout')).open('w') as stdout, (evidence / (label + '.stderr')).open('w') as stderr:
            p = subprocess.Popen(args, cwd=SOURCE, env=env, stdout=stdout, stderr=stderr,
                                 start_new_session=True, preexec_fn=lambda: os.sched_setaffinity(0, cpus))
            while p.poll() is None:
                if shutil.disk_usage(BASE).free < MIN_FREE or scratch() > MAX_SCRATCH or time.time() - started > seconds:
                    reason = 'Disk/scratch/deadline guard'
                    os.killpg(p.pid, signal.SIGTERM)
                    try:
                        p.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid, signal.SIGKILL)
                    break
                time.sleep(0.25)
            code = p.wait()
        result = {'label': label, 'command': args, 'actualExitCode': code,
                  'seconds': time.time() - started, 'stoppedReason': reason,
                  'affinityCPUs': cpus, 'diskFreeAfter': shutil.disk_usage(BASE).free,
                  'taskScratchBytesAfter': scratch()}
        (evidence / (label + '-exit.json')).write_text(json.dumps(result, indent=2) + '\n')
        results.append(result)
        (evidence / 'results.json').write_text(json.dumps({'results': results, 'complete': False}, indent=2) + '\n')
        if code:
            raise RuntimeError(label + ' failed; actual exit retained')
        return result

    artifacts = {}
    for name in ['nitro', 'nitro-val']:
        binary = OUT / 'bin' / name
        execute([GO, 'build', '-p', '2', '-mod=readonly', '-ldflags=-extldflags=-Wl,-z,noexecstack',
                 '-o', str(binary), './cmd/' + name], name + '-build')
        artifacts[name] = {'bytes': binary.stat().st_size, 'SHA256': sha(binary)}
        (evidence / 'artifacts.json').write_text(json.dumps(artifacts, indent=2) + '\n')
        execute([GO, 'version', '-m', str(binary)], name + '-metadata', 30)
        execute(['readelf', '-W', '-l', str(binary)], name + '-elf', 30)
        elf = (evidence / (name + '-elf.stdout')).read_text()
        stack = [line for line in elf.splitlines() if 'GNU_STACK' in line]
        if len(stack) != 1 or ' RWE ' in stack[0] or ' RW ' not in stack[0]:
            raise RuntimeError('Non-executable stack invariant failed')
        artifacts[name]['GNUStackLine'] = stack[0].strip()
        execute(['ldd', str(binary)], name + '-libraries', 30)
        execute([str(binary), '--help'], name + '-help', 15)
        if name == 'nitro':
            execute([str(binary), '--version'], name + '-version', 15)
            args = [str(binary), '--conf.dump', '--chain.id=412346',
                    '--chain.info-files=' + str(BASE / 'private-chain-info-smoke.json')]
            execute(args, name + '-default-config', 15)
            default = json.loads((evidence / (name + '-default-config.stdout')).read_text())
            cfg = default['node']['block-validator']['experimental-bold-execution-cache']
            if (cfg.get('enable') is not False or cfg.get('max-entries') != 1
                    or cfg.get('idle-timeout') not in [14400000000000, '4h', '4h0m0s']):
                raise RuntimeError('Compiled ordinary default-off operator values differ: ' + repr(cfg))
            execute(args + ['--node.block-validator.experimental-bold-execution-cache.enable'], name + '-optin-config', 15)
            enabled = json.loads((evidence / (name + '-optin-config.stdout')).read_text())
            if enabled['node']['block-validator']['experimental-bold-execution-cache']['enable'] is not True:
                raise RuntimeError('Ordinary parser did not recognize explicit opt-in')
        else:
            execute([str(binary), '--conf.dump'], name + '-default-config', 15)
        (evidence / 'artifacts.json').write_text(json.dumps(artifacts, indent=2) + '\n')
    for name, expected in guard.items():
        if sha(SOURCE / name) != expected:
            raise RuntimeError('Frozen host input changed during build: ' + name)
    (evidence / 'results.json').write_text(json.dumps({
        'results': results, 'complete': True, 'passed': True, 'artifacts': artifacts,
        'sourceUnchanged': True, 'approvedHostSourceChanges': 14,
        'defaultOffAndExplicitOptinConfigParsingPassed': True,
        'configurationOnlyNoActivation': True, 'privateResearchChainInfoOnly': True,
        'engineOrProverOrChainStarted': False, 'walletOrMainnetOperation': False,
        'productionGenesisAccepted': False, 'allExecutionOnRunpod': True,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
