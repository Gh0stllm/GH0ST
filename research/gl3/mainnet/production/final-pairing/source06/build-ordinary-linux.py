"""One-at-a-time Runpod-only ordinary06 builds; execute only after root review.

The selected SDK, source05 binaries and all machine/engine sources are read-only.
Help/version/config dump are startup-free smokes, not configuration validation.
"""
from pathlib import Path
import argparse, datetime, hashlib, json, os, shutil, signal, subprocess, time

BASE = Path('/root/gl3-final-pairing')
SOURCE = BASE / 'source05'
PROFILE = BASE / 'source06'
OUT = BASE / 'ordinary06'
GO = '/root/bounded-restore/toolchain/go/bin/go'
MIN_FREE = 6_000_000_000
MAX_OWNED_SCRATCH = 3_000_000_000


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def scratch():
    return sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file() and not p.is_symlink())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', required=True, choices=['nitro', 'nitro-val'])
    args = parser.parse_args()
    for directory in ['bin', 'tmp', 'evidence']:
        (OUT / directory).mkdir(parents=True, exist_ok=True)
    evidence = OUT / 'evidence'
    overlay = PROFILE / 'verified-frozen-production-overlay.json'
    subprocess.run(['python3', str(PROFILE / 'make-overlay.py'), '--source-base', str(SOURCE),
                    '--output', str(overlay)], check=True)
    lock = json.loads((PROFILE / 'manifest.json').read_text())
    if sha(PROFILE / 'manifest.json') != '37b2a3d541d53fbef32cfb101adc57277b5caf83ff2f9f80b4b9ce9ced36b196':
        raise RuntimeError('Frozen source06 manifest changed')
    records = json.loads((PROFILE / 'evidence/ordinary06-source-files.json').read_text())
    for row in records.values():
        source = Path(row['sourcePath'])
        if source.stat().st_size != row['bytes'] or sha(source) != row['SHA256']:
            raise RuntimeError('Ordinary dependency source changed: ' + str(source))
    env = os.environ.copy()
    env['PATH'] = str(Path(GO).parent) + ':' + env['PATH']
    env['GOMAXPROCS'] = '2'
    env['TMPDIR'] = str(OUT / 'tmp')
    cpus = sorted(os.sched_getaffinity(0))[-2:]
    results = []

    def execute(command, label, deadline=600):
        if shutil.disk_usage(OUT).free < MIN_FREE:
            raise RuntimeError('Disk floor prevents ' + label)
        if (evidence / (label + '-exit.json')).exists():
            raise RuntimeError('Refusing to overwrite an earlier attempt: ' + label)
        start = time.time()
        reason = None
        minimum_free = shutil.disk_usage(OUT).free
        peak_scratch = scratch()
        with (evidence / (label + '.stdout')).open('w') as stdout, (evidence / (label + '.stderr')).open('w') as stderr:
            child = subprocess.Popen(command, cwd=SOURCE, env=env, stdout=stdout, stderr=stderr,
                                     start_new_session=True, preexec_fn=lambda: os.sched_setaffinity(0, cpus))
            (evidence / (label + '-running.json')).write_text(json.dumps({
                'pid': child.pid, 'command': command, 'startUnix': start, 'CPUs': cpus,
            }, indent=2) + '\n')
            while child.poll() is None:
                free = shutil.disk_usage(OUT).free
                owned = scratch()
                minimum_free = min(minimum_free, free)
                peak_scratch = max(peak_scratch, owned)
                if free < MIN_FREE:
                    reason = 'polled six-billion-byte free disk floor'
                elif owned > MAX_OWNED_SCRATCH:
                    reason = 'polled three-billion-byte owned output/temp cap'
                elif time.time() - start > deadline:
                    reason = 'deadline'
                if reason:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                    break
                time.sleep(0.2)
            code = child.wait()
        receipt = {'command': command, 'actualExitCode': code, 'seconds': time.time() - start,
                   'stoppedReason': reason, 'CPUs': cpus, 'minimumSampledDiskFreeBytes': minimum_free,
                   'peakSampledOwnedScratchBytes': peak_scratch, 'diskFreeAfterBytes': shutil.disk_usage(OUT).free}
        (evidence / (label + '-exit.json')).write_text(json.dumps(receipt, indent=2) + '\n')
        results.append(receipt)
        if code:
            raise RuntimeError(label + ' failed; actual exit preserved')
        return receipt

    name = args.only
    binary = OUT / 'bin' / name
    if binary.exists():
        raise RuntimeError('Refusing to overwrite an existing artifact')
    execute([GO, 'build', '-p', '1', '-mod=readonly', '-overlay', str(overlay),
             '-ldflags=-extldflags=-Wl,-z,noexecstack', '-o', str(binary), './cmd/' + name], name + '-build')
    artifact = {'path': str(binary), 'bytes': binary.stat().st_size, 'SHA256': sha(binary)}
    execute([GO, 'version', '-m', str(binary)], name + '-metadata', 30)
    execute(['readelf', '-W', '-l', str(binary)], name + '-elf', 30)
    stacks = [line.strip() for line in (evidence / (name + '-elf.stdout')).read_text().splitlines() if 'GNU_STACK' in line]
    if len(stacks) != 1 or ' RW ' not in stacks[0] or ' RWE ' in stacks[0]:
        raise RuntimeError('Executable stack invariant failed')
    artifact['GNUStackLine'] = stacks[0]
    execute(['ldd', str(binary)], name + '-libraries', 30)
    execute([str(binary), '--help'], name + '-help', 15)
    if '--validation.rpc-request-max-bytes' not in ((evidence / (name + '-help.stdout')).read_text() + (evidence / (name + '-help.stderr')).read_text()):
        raise RuntimeError('Ordinary binary does not expose the reviewed cap flag')
    config_args = [str(binary), '--conf.dump']
    if name == 'nitro':
        execute([str(binary), '--version'], name + '-version', 15)
        config_args += ['--chain.id=412346', '--chain.info-files=' + str(BASE / 'private-chain-info-smoke.json')]
    execute(config_args, name + '-default-config', 15)
    default = json.loads((evidence / (name + '-default-config.stdout')).read_text())
    if default['validation']['rpc-request-max-bytes'] != 3221225472:
        raise RuntimeError('Compiled default request cap drift')
    if name == 'nitro':
        cfg = default['node']['block-validator']['experimental-bold-execution-cache']
        if cfg['enable'] is not False:
            raise RuntimeError('Ordinary default cache is enabled')
        explicit = config_args + ['--node.block-validator.experimental-bold-execution-cache.enable',
                                  '--node.block-validator.current-module-root=' + lock['moduleRoot'],
                                  '--validation.rpc-request-max-bytes=3221225472', '--validation.use-jit=false', '--log-level=WARN']
        execute(explicit, name + '-explicit-profile-config', 15)
        parsed = json.loads((evidence / (name + '-explicit-profile-config.stdout')).read_text())
        if not parsed['node']['block-validator']['experimental-bold-execution-cache']['enable'] or parsed['validation']['use-jit'] or parsed['log-level'] != 'WARN':
            raise RuntimeError('Explicit ordinary profile typed parsing drift')
    for row in records.values():
        if sha(Path(row['sourcePath'])) != row['SHA256']:
            raise RuntimeError('Dependency source drift during build')
    receipt = {'status': 'ONE_ORDINARY_SOURCE06_ARTIFACT_BUILT_NO_ACTIVATION', 'UTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'artifact': artifact, 'source06ManifestSHA256': sha(PROFILE / 'manifest.json'),
               'ordinarySourceClosureSHA256': sha(PROFILE / 'evidence/ordinary06-source-files.json'),
               'sourceRecordsRehashedBeforeAndAfter': len(records), 'moduleRoot': lock['moduleRoot'],
               'results': results, 'parserSmokeIsNotStartupValidation': True, 'ordinaryVersionStampProductionAccepted': False,
               'chainOrServiceOrEngineOrProverStarted': False, 'walletOrMainnetOperation': False, 'allExecutionOnRunpod': True}
    (evidence / (name + '-artifact-lock.json')).write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'artifact': artifact, 'status': receipt['status']}))


if __name__ == '__main__':
    main()
