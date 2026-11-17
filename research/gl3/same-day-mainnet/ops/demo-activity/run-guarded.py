#!/usr/bin/env python3
"""Root-invoked, one-run controller. No service/config changes or automatic retries."""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
WRAPPER = Path('/workspace/gl3/same-day-mainnet/ops/infra-prepare/runtime-exec.sh')
HOST = '42456c02ced1'
GIB = 1024 ** 3


def working_set():
    current = int(Path('/sys/fs/cgroup/memory.current').read_text())
    values = dict(line.split() for line in Path('/sys/fs/cgroup/memory.stat').read_text().splitlines())
    return max(0, current - int(values.get('inactive_file', 0)))


def owned_rss(pgid):
    total, pids = 0, []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            pid = int(entry.name)
            if os.getpgid(pid) != pgid:
                continue
            fields = (entry / 'statm').read_text().split()
            total += int(fields[1]) * os.sysconf('SC_PAGE_SIZE')
            pids.append(pid)
        except (OSError, ValueError, IndexError):
            pass
    return total, pids


def run():
    assert os.uname().nodename == HOST, 'wrong pod hostname'
    assert int(Path('/sys/fs/cgroup/memory.max').read_text()) == 64_000_000_000, 'wrong memory boundary'
    config_path = Path(sys.argv[1]).resolve()
    config_bytes = config_path.read_bytes()
    approval = hashlib.sha256(config_bytes).hexdigest()
    assert os.environ.get('GL3_DEMO_APPROVAL_SHA256') == approval, 'Root exact configuration approval missing'
    c = json.loads(config_bytes)
    assert c['activationApproved'] is True and c['chainId'] == 4663001
    state = Path(c['stateDir'])
    assert str(state).startswith('/workspace/gl3/mainnet/private/demo/') and state.resolve() == state
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    assert stat.S_IMODE(state.stat().st_mode) == 0o700
    assert os.statvfs('/root').f_bavail * os.statvfs('/root').f_frsize >= 6 * GIB, 'disk floor'
    assert working_set() <= 56_000_000_000, 'shared working set guard'
    run_dir = state / ('run-' + str(time.time_ns()))
    run_dir.mkdir(mode=0o700)
    stdout = open(run_dir / 'stdout.private.log', 'xb', buffering=0)
    stderr = open(run_dir / 'stderr.private.log', 'xb', buffering=0)
    os.chmod(stdout.name, 0o600)
    os.chmod(stderr.name, 0o600)
    affinity = sorted(os.sched_getaffinity(0))[-2:]

    def child_setup():
        os.nice(10)
        os.sched_setaffinity(0, affinity)

    cmd = [str(WRAPPER), 'node', '--max-old-space-size=1536', str(BASE / 'worker.mjs'), str(config_path)]
    started = time.monotonic()
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True, preexec_fn=child_setup)
    stop_requested = False

    def request_stop(_signal, _frame):
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    reason, peak, shared_peak = None, 0, 0
    minimum_free = 1 << 63
    while proc.poll() is None:
        rss, _ = owned_rss(proc.pid)
        shared = working_set()
        free = os.statvfs('/root').f_bavail * os.statvfs('/root').f_frsize
        peak, shared_peak, minimum_free = max(peak, rss), max(shared_peak, shared), min(minimum_free, free)
        if stop_requested:
            reason = 'ROOT_OPERATOR_STOP'
        elif rss > 2 * GIB:
            reason = 'OWNED_RSS_GUARD'
        elif shared > 56_000_000_000:
            reason = 'SHARED_CGROUP_WORKING_SET_GUARD'
        elif free < 6 * GIB:
            reason = 'DISK_FREE_GUARD'
        elif time.monotonic() - started > c['maxRunSeconds'] + 15:
            reason = 'WALL_DEADLINE'
        if reason:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
            break
        time.sleep(0.5)
    code = proc.wait()
    _, remaining = owned_rss(proc.pid)
    if remaining:
        os.killpg(proc.pid, signal.SIGTERM)
        time.sleep(0.5)
        _, remaining = owned_rss(proc.pid)
        if remaining:
            os.killpg(proc.pid, signal.SIGKILL)
            time.sleep(0.5)
    _, remaining = owned_rss(proc.pid)
    result = {'schema': 'gh0st.gl3.automated-demo.controller.v1', 'actualExitCode': code,
              'stopReason': reason, 'elapsedSeconds': time.monotonic() - started,
              'configSHA256': approval, 'sampledOwnedSumRSSBytesUpperBound': peak,
              'sampledWholePodWorkingSetPeakBytes': shared_peak, 'minimumRootFreeBytes': minimum_free,
              'remainingOwnedPIDs': remaining, 'affinity': affinity,
              'automaticRetries': 0, 'scope': 'Automated demo only; no organic adoption or volume claim.'}
    (run_dir / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    os.chmod(run_dir / 'result.json', 0o600)
    stdout.close()
    stderr.close()
    print(json.dumps({'actualExitCode': code, 'stopReason': reason, 'remainingOwnedPIDs': remaining}))
    return 1 if code != 0 or remaining else 0


if __name__ == '__main__':
    raise SystemExit(run())
