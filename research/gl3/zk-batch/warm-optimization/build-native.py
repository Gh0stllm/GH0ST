"""Runpod-only native-CPU build, queued after the isolated warm baseline."""
from pathlib import Path
import hashlib
import json
import os
import signal
import subprocess
import time

W = Path('/workspace/gl3/zk-tests/warm-optimization')
B = Path('/workspace/gl3/zk-tests/evm-proof')
R = W / 'native-build'
R.mkdir(exist_ok=True)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def memory():
    current = int(Path('/sys/fs/cgroup/memory.current').read_text())
    stat = dict(line.split() for line in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines())
    return current - int(stat['inactive_file'])


def owned(group):
    total = 0
    for path in Path('/proc').glob('[0-9]*'):
        try:
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) != group:
                continue
            for line in (path / 'status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    total += int(line.split()[1]) * 1024
        except (FileNotFoundError, ProcessLookupError):
            pass
    return total


assert os.uname().nodename == 'cc91695a75f7'
assert int(Path('/sys/fs/cgroup/memory.max').read_text()) == 64000000000
queued = time.monotonic()
while True:
    assert time.monotonic() - queued < 2400, 'baseline wait limit'
    try:
        baseline = json.loads((W / 'baseline28/controller/result.json').read_text())
        break
    except (FileNotFoundError, json.JSONDecodeError):
        time.sleep(1)
assert baseline['passed'] and baseline['actualExitCode'] == 0
assert baseline['cleanupRemainingCount'] == 0
original = json.loads((W / 'baseline28-intent.json').read_text())
for row in original['artifacts']:
    path = Path(row['path'])
    assert path.stat().st_size == row['bytes'] and sha(path) == row['SHA256']
source = B / 'source/replay-sp1-native'
target = Path('/root/gl3-sp1-native/target')
target.mkdir(parents=True, exist_ok=True)
assert not (R / 'result.json').exists(), 'preserve previous attempt first'
allowed = sorted(os.sched_getaffinity(0))
os.sched_setaffinity(0, allowed[:28])
env = dict(os.environ, RUSTUP_HOME=str(B / 'toolchains/rustup'),
           CARGO_HOME=str(B / 'toolchains/cargo'), CARGO_TARGET_DIR=str(target),
           CARGO_NET_OFFLINE='true', CARGO_NET_GIT_FETCH_WITH_CLI='true',
           SP1_SKIP_PROGRAM_BUILD='true', SP1_PROVER='cpu',
           RUSTFLAGS='-C target-cpu=native', CARGO_BUILD_JOBS='28',
           RAYON_NUM_THREADS='28', GOMAXPROCS='28')
env['PATH'] = ':'.join([str(B / 'toolchains/sp1/bin'), str(B / 'toolchains/cargo/bin'),
                        '/workspace/gl3/durable/toolchain/go/bin', os.environ['PATH']])
args = [str(B / 'toolchains/cargo/bin/cargo'), 'build', '--release', '--locked',
        '--features', 'sp1', '--example', 'gl3-proof16', '-j28']
started = time.monotonic()
result = {'passed': False, 'scope': 'Host compilation only; guest and proof security unchanged',
          'rustflags': env['RUSTFLAGS'], 'CPUCap': 28, 'networkDependencyFetchAllowed': False}
child = None
try:
    with (R / 'build.log').open('w') as log:
        child = subprocess.Popen(args, cwd=source, env=env, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        (R / 'process.json').write_text(json.dumps({'controllerPID': os.getpid(), 'childPID': child.pid}) + '\n')
        while child.poll() is None:
            rss = owned(child.pid)
            result['peakSampledOwnedRSSBytes'] = max(result.get('peakSampledOwnedRSSBytes', 0), rss)
            free = os.statvfs('/root').f_bavail * os.statvfs('/root').f_frsize
            assert rss < 40 * 1024**3 and memory() < 56000000000 and free > 6000000000, 'build resource guard'
            assert time.monotonic() - started < 1800, 'build wall guard'
            time.sleep(.5)
    result['actualExitCode'] = child.returncode
    assert child.returncode == 0, 'native build failed'
    binary = target / 'release/examples/gl3-proof16'
    guest = B / 'guest/ethrex15-sp1.elf'
    image, elf = binary.read_bytes(), guest.read_bytes()
    offset = image.find(elf)
    assert offset >= 0 and image[offset:offset + len(elf)] == elf
    fingerprints = []
    for directory in (target / 'release/.fingerprint').glob('p3-baby-bear-*'):
        for path in directory.glob('lib-p3_baby_bear.json'):
            data = json.loads(path.read_text())
            fingerprints.append({'path': str(path), 'rustflags': data['rustflags'],
                                 'features': data['features'], 'SHA256': sha(path)})
    assert fingerprints and all('target-cpu=native' in row['rustflags'] for row in fingerprints)
    result.update({'passed': True, 'binary': str(binary), 'binaryBytes': binary.stat().st_size,
                   'binarySHA256': sha(binary), 'embeddedGuestOffset': offset,
                   'embeddedGuestCompleteBytesMatch': True, 'guestSHA256': sha(guest),
                   'p3BabyBearFingerprints': fingerprints})
except BaseException as error:
    result['error'] = repr(error)
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    result['actualExitCode'] = None if child is None else child.returncode
result['seconds'] = time.monotonic() - started
(R / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result), flush=True)
if result['passed']:
    intent = dict(original)
    intent.update({'runID': 'native28', 'executable': str(binary),
                   'candidateRustflags': env['RUSTFLAGS'], 'embeddedGuestByteOffset': offset,
                   'expectedProgramVKey': '0x005cc930fd52fd7e71ca44913ae824ce5578ff90d2005a0d4840b1eb76e9211a'})
    intent['artifacts'] = list(original['artifacts'])
    for path in [binary, W / 'optimized-controller.py', W / 'build-native.py']:
        intent['artifacts'].append({'path': str(path), 'bytes': path.stat().st_size, 'SHA256': sha(path)})
    intent_file = W / 'native28-intent.json'
    assert not intent_file.exists()
    intent_file.write_text(json.dumps(intent, indent=2) + '\n')
    with (W / 'native28-launch.log').open('w') as log:
        next_process = subprocess.Popen(['python3', str(W / 'optimized-controller.py'), str(intent_file)],
                                        stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    (R / 'next-proof-launch.json').write_text(json.dumps({'controllerPID': next_process.pid, 'runID': 'native28'}) + '\n')
