#!/usr/bin/env python3
"""Build the exact upstream parent dependency required by pinned Nitro tests."""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time

B = Path('/workspace/gl3/durable/base-dispute/parent-geth')
GO = '/root/bounded-restore/toolchain/go/bin/go'
VERSION = 'v1.17.6-0.20260813154252-aa1f2fcf5129'
COMMIT = 'aa1f2fcf512988eb8890d9352e601b898d6fdb2c'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def child_setup():
    parent = os.getppid()
    if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0 or os.getppid() != parent:
        os._exit(127)


def main():
    def interrupt(sig, _frame):
        raise InterruptedError(str(sig))
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    assert socket.gethostname() == 'cc91695a75f7'
    assert Path('/sys/fs/cgroup/memory.max').read_text().strip() == '64000000000'
    resolved = json.loads((B / 'resolve.json').read_text())
    assert resolved['Version'] == VERSION and resolved['Origin']['Hash'] == COMMIT
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:8])
    os.nice(10)
    tmp = Path('/root/gl3-base-dispute-compile/parent-geth-tmp')
    tmp.mkdir(parents=True, exist_ok=True)
    (B / 'bin').mkdir(exist_ok=True)
    env = dict(os.environ, GOMAXPROCS='8', GOTOOLCHAIN='local', CGO_ENABLED='1',
               GOCACHE='/root/gl3-base-dispute-compile/go-cache', GOMODCACHE='/root/go/pkg/mod',
               GOTMPDIR=str(tmp), TMPDIR=str(tmp), GOBIN=str(B / 'bin'))
    command = [GO, 'install', '-p', '8', 'github.com/ethereum/go-ethereum/cmd/geth@' + VERSION]
    start = time.monotonic()
    process = None
    result = {'phase': 'exact_upstream_parent_dependency_build', 'branch': 'glamsterdam-devnet-8',
              'commit': COMMIT, 'version': VERSION, 'command': command, 'exitCode': None,
              'guardFailure': None, 'peakAggregateRSSBytes': 0, 'peakWorkingSetBytes': 0,
              'RSSGuardBytes': 24 * 1024**3, 'workingSetGuardBytes': 56_000_000_000,
              'diskFloorBytes': 6_000_000_000, 'wallLimitSeconds': 1200,
              'childSTFOrFixtureChanged': False, 'publicWrites': False}
    try:
        with (B / 'build.log').open('wb') as log:
            process = subprocess.Popen(command, cwd=B, env=env, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True, preexec_fn=child_setup)
            (B / 'process.json').write_text(json.dumps({**result, 'controllerPID': os.getpid(), 'childPID': process.pid}, indent=2) + '\n')
            while process.poll() is None:
                if time.monotonic() - start >= 1200:
                    raise RuntimeError('wall deadline')
                fs = os.statvfs(tmp)
                if fs.f_bavail * fs.f_frsize < 6_000_000_000:
                    raise RuntimeError('root disk floor')
                rss = 0
                for path in Path('/proc').glob('[0-9]*'):
                    try:
                        fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
                        if int(fields[2]) != process.pid and int(path.name) != os.getpid():
                            continue
                        for line in (path / 'status').read_text().splitlines():
                            if line.startswith('VmRSS:'):
                                rss += int(line.split()[1]) * 1024
                    except (FileNotFoundError, ProcessLookupError):
                        continue
                stats = dict(line.split() for line in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines())
                ws = max(0, int(Path('/sys/fs/cgroup/memory.current').read_text()) - int(stats['inactive_file']))
                result['peakAggregateRSSBytes'] = max(result['peakAggregateRSSBytes'], rss)
                result['peakWorkingSetBytes'] = max(result['peakWorkingSetBytes'], ws)
                if rss >= result['RSSGuardBytes'] or ws >= result['workingSetGuardBytes']:
                    raise RuntimeError('memory guard')
                time.sleep(1)
            result['exitCode'] = process.returncode
    except BaseException as exc:
        result['guardFailure'] = type(exc).__name__ + ': ' + str(exc)
    finally:
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            result['exitCode'] = process.returncode
        result['seconds'] = round(time.monotonic() - start, 3)
        result['logSHA256'] = sha(B / 'build.log')
        binary = B / 'bin/geth'
        if result['exitCode'] == 0 and binary.exists():
            result['binarySHA256'] = sha(binary)
            result['binaryBytes'] = binary.stat().st_size
        (B / 'build-result.json').write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
