#!/usr/bin/env python3
"""Run a GL3 follower with loopback RPC and protect the shared host."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time

from follower_config import follower_config


DISK_FLOOR = 16_000_000_000
MEMORY_CEILING = 48_000_000_000
MEMORY_CURRENT = Path("/sys/fs/cgroup/memory.current")
LOG_LIMIT = 128_000_000


def resource_limit(root, log):
    if shutil.disk_usage(root).free < DISK_FLOOR:
        return "host scratch disk floor"
    if MEMORY_CURRENT.exists() and int(MEMORY_CURRENT.read_text()) >= MEMORY_CEILING:
        return "shared pod memory ceiling"
    if log.stat().st_size >= LOG_LIMIT:
        return "follower log size limit"
    return None


def run(root, port):
    profile = root / "data/profile"
    config = profile / "follower.json"
    binary = root / "bin/nitro-a14"
    logfile = root / "logs/follower.log"
    if json.loads(config.read_text()) != follower_config(profile, port):
        raise ValueError("The follower configuration differs from its read-only profile")
    with (root / "follower.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", port))
        with logfile.open("ab", buffering=0) as log:
            if limit := resource_limit(root, logfile):
                raise RuntimeError(limit)
            cores = sorted(os.sched_getaffinity(0))[-2:]
            os.sched_setaffinity(0, cores)
            os.nice(18)
            env = {"PATH": "/usr/bin:/bin", "HOME": str(root), "GOMAXPROCS": str(len(cores)), "GOMEMLIMIT": "4GiB"}
            command = ["/usr/bin/ionice", "-c", "3", str(binary), "--conf.file", str(config)]
            with subprocess.Popen(command, cwd=root, env=env, stdout=log, stderr=log, start_new_session=True) as child:
                (root / "follower.pid").write_text(f"{child.pid}\n")
                try:
                    while child.poll() is None:
                        if limit := resource_limit(root, logfile):
                            raise RuntimeError(limit)
                        time.sleep(5)
                finally:
                    if child.poll() is None:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:
                            child.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL)
                            child.wait()
                return child.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", type=Path)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    try:
        return run(args.stage.resolve(strict=True), args.port)
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
