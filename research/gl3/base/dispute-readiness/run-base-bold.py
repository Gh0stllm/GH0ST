#!/usr/bin/env python3
"""Bounded Runpod-only compiler/test controller for the standard GL3 fixture."""
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time

BASE = Path('/workspace/gl3/durable/base-dispute')
SOURCE = Path('/root/gl3-base-launch/nitro-clean')
GO = '/root/bounded-restore/toolchain/go/bin/go'
EXPECTED = 'e410a7537605a03d4c113e3f86d7f7c289cf1e98edc1116e298d9b391516ca45'
ROOT = '0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
MACHINES = {
    'module-root.txt': '31ea9746e168fe49059a1bf7a49509a2827d48a07444cc97618d1b0c01351306',
    'replay.wasm': '9d6d28c4810cfc220b5fdbc4a7a675ee333dc86a5e998a6380c1c62a59b260af',
    'machine.v2.wavm.br': '791073b628dee37ed5faccb43841dc317dc24e21bd0bb0b7d38c08e652cd78a5',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def child_setup():
    parent = os.getppid()
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL) != 0 or os.getppid() != parent:
        os._exit(127)


def main():
    args = argparse.ArgumentParser()
    args.add_argument('phase', choices=['compile', 'test'])
    phase = args.parse_args().phase
    def interrupted(signum, _frame):
        raise InterruptedError('controller signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    # SSH does not inherit Runpod's process environment. This exact container
    # hostname was observed through the root-owned big SSH lane.
    pod = '9fu9ldfpioy14f'
    if socket.gethostname() != 'cc91695a75f7' or os.environ.get('RUNPOD_POD_ID', pod) != pod:
        raise SystemExit('requires authorized BIG Runpod container')
    if Path('/sys/fs/cgroup/memory.max').read_text().strip() != '64000000000':
        raise SystemExit('requires observed hard 64,000,000,000-byte memory cgroup')
    if not str(SOURCE.resolve()).startswith('/workspace/gl3/durable/'):
        raise SystemExit('requires durable pristine source staging')
    if sha(BASE / 'gl3_base_bold_full_test.go') != EXPECTED:
        raise SystemExit('frozen test source changed')
    if sha(SOURCE / 'system_tests/bold_challenge_protocol_test.go') != 'e6dedf98d9d195faf2a776a1d981278488ef38f8b7f1d0db38b75e5a94b47bdb':
        raise SystemExit('pristine upstream challenge function changed')
    machine_path = SOURCE / 'target/machines/latest'
    if machine_path.resolve().name != ROOT:
        raise SystemExit('latest machine is not the official root')
    for name, expected in MACHINES.items():
        if sha(machine_path / name) != expected:
            raise SystemExit('official machine file changed: ' + name)
    if sha(SOURCE / 'target/lib/libstylus.a') != '42cc75b003aaab6686620da6ec947bb475fe221b605bd0ac1bf417a171f4546c':
        raise SystemExit('accepted native static library changed')
    os.sched_setaffinity(0, sorted(os.sched_getaffinity(0))[:8])
    os.nice(10)
    lease = (BASE / 'exclusive.lock').open('a')
    fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    env = dict(os.environ)
    temporary = Path('/root/gl3-base-dispute-compile/tmp') if phase == 'compile' else BASE / 'tmp'
    temporary.mkdir(parents=True, exist_ok=True)
    env.update(GOMAXPROCS='8', GOTOOLCHAIN='local', CGO_ENABLED='1',
               LD_LIBRARY_PATH=str(SOURCE / 'target/lib'),
               TMPDIR=str(temporary),
               GL3_BASE_BOLD_REPORT=str(BASE / 'full-lifecycle-report.json'))
    overlay = {'Replace': {str(SOURCE / 'system_tests/gl3_base_bold_full_test.go'):
                           str(BASE / 'gl3_base_bold_full_test.go')}}
    (BASE / 'overlay.json').write_text(json.dumps(overlay, indent=2) + '\n')
    binary = BASE / 'base-bold.test'
    if phase == 'compile':
        env['GOTMPDIR'] = str(temporary)
        command = [GO, 'test', '-c', '-mod=readonly', '-p', '8', '-tags=challengetest,blst_enabled',
                   '-overlay=' + str(BASE / 'overlay.json'), '-o', str(binary), './system_tests']
        limit = 1200
    else:
        lock = json.loads((BASE / 'compile-result.json').read_text())
        if lock.get('exitCode') != 0 or lock.get('guardFailure') or sha(binary) != lock.get('binarySHA256'):
            raise SystemExit('requires successful hash-bound compile receipt')
        command = [str(binary), '-test.run=^TestGL3BaseBOLDFullLifecycle$', '-test.v', '-test.timeout=15m']
        limit = 930
    log_path = BASE / (phase + '.log')
    process = None
    result = {'phase': phase, 'command': command, 'podID': pod,
              'hostname': socket.gethostname(), 'podBindingSource': 'root-owned big SSH lane and observed exact container hostname',
              'testSourceSHA256': EXPECTED, 'startUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'cpuAffinity': sorted(os.sched_getaffinity(0)), 'nice': os.nice(0),
              'diskFloorBytes': 6_000_000_000, 'wallLimitSeconds': limit,
              'processGroupRSSGuardBytes': 24 * 1024**3, 'peakProcessGroupRSSBytes': 0,
              'cgroupWorkingSetGuardBytes': 56_000_000_000, 'peakCgroupWorkingSetBytes': 0,
              'guardFailure': None, 'publicWrites': False, 'realChainSpend': 0}
    start = time.monotonic()
    try:
        if os.statvfs(temporary).f_bavail * os.statvfs(temporary).f_frsize < 6_500_000_000:
            raise RuntimeError('insufficient launch headroom above 6GB floor')
        with log_path.open('wb') as log:
            process = subprocess.Popen(command, cwd=SOURCE, env=env, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True, preexec_fn=child_setup)
            (BASE / (phase + '-process.json')).write_text(json.dumps({
                **result, 'controllerPID': os.getpid(), 'childPID': process.pid}, indent=2) + '\n')
            while process.poll() is None:
                if time.monotonic() - start >= limit:
                    raise RuntimeError('wall deadline')
                stat = os.statvfs(temporary)
                if stat.f_bavail * stat.f_frsize < 6_000_000_000:
                    raise RuntimeError('shared filesystem 6GB disk floor')
                rss = 0
                for path in Path('/proc').glob('[0-9]*'):
                    try:
                        fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
                        if int(fields[2]) != process.pid:
                            continue
                        for entry in (path / 'status').read_text().splitlines():
                            if entry.startswith('VmRSS:'):
                                rss += int(entry.split()[1]) * 1024
                    except (FileNotFoundError, ProcessLookupError):
                        continue
                result['peakProcessGroupRSSBytes'] = max(result['peakProcessGroupRSSBytes'], rss)
                if rss >= result['processGroupRSSGuardBytes']:
                    raise RuntimeError('owned process group 24GiB RSS guard')
                memory = int(Path('/sys/fs/cgroup/memory.current').read_text())
                memory_stats = dict(line.split() for line in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines())
                working_set = max(0, memory - int(memory_stats['inactive_file']))
                result['peakCgroupWorkingSetBytes'] = max(result['peakCgroupWorkingSetBytes'], working_set)
                if working_set >= result['cgroupWorkingSetGuardBytes']:
                    raise RuntimeError('shared cgroup 56GB working-set guard')
                time.sleep(1)
            result['exitCode'] = process.returncode
    except BaseException as exc:
        result['guardFailure'] = type(exc).__name__ + ': ' + str(exc)
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        result['exitCode'] = None if process is None else process.returncode
    finally:
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        result['seconds'] = round(time.monotonic() - start, 3)
        result['logSHA256'] = sha(log_path) if log_path.exists() else None
        if phase == 'compile' and result.get('exitCode') == 0 and binary.exists():
            result['binarySHA256'] = sha(binary)
            result['binaryBytes'] = binary.stat().st_size
        if phase == 'test' and result.get('exitCode') == 0:
            report_path = BASE / 'full-lifecycle-report.json'
            if not report_path.exists():
                result['guardFailure'] = 'missing successful full lifecycle report'
            else:
                report = json.loads(report_path.read_text())
                result['reportSHA256'] = sha(report_path)
                result['fullLifecycleReportPassed'] = report.get('passed') is True
                if not result['fullLifecycleReportPassed']:
                    result['guardFailure'] = 'full lifecycle report did not pass'
        (BASE / (phase + '-result.json')).write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
