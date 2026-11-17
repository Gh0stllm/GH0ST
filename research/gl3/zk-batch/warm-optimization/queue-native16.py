"""One physical-core-affinity comparison after the 28-thread native proof."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

W = Path('/workspace/gl3/zk-tests/warm-optimization')
assert os.uname().nodename == 'cc91695a75f7'
start = time.monotonic()
while True:
    assert time.monotonic() - start < 3600, 'queue deadline'
    build_path = W / 'native-build/result.json'
    if build_path.exists():
        build = json.loads(build_path.read_text())
        assert build['passed'], 'native build did not pass; no automatic retry'
    try:
        result = json.loads((W / 'native28/controller/result.json').read_text())
        break
    except (FileNotFoundError, json.JSONDecodeError):
        time.sleep(1)
assert result['passed'] and result['actualExitCode'] == 0 and result['cleanupRemainingCount'] == 0
intent = json.loads((W / 'native28-intent.json').read_text())
allowed = sorted(os.sched_getaffinity(0))
cores = {}
for cpu in allowed:
    topology = Path('/sys/devices/system/cpu') / ('cpu' + str(cpu)) / 'topology'
    key = ((topology / 'physical_package_id').read_text().strip(),
           (topology / 'core_id').read_text().strip())
    cores.setdefault(key, cpu)
chosen = sorted(cores.values())
assert len(chosen) == 16, 'expected sixteen distinct physical cores in allocation'
intent.update({'runID': 'native16', 'threads': 16, 'cpuAffinity': chosen,
               'affinityMeaning': 'One allowed hardware thread per distinct physical core'})
path = W / 'queue-native16.py'
intent['artifacts'].append({'path': str(path), 'bytes': path.stat().st_size,
                            'SHA256': hashlib.sha256(path.read_bytes()).hexdigest()})
out = W / 'native16-intent.json'
assert not out.exists()
out.write_text(json.dumps(intent, indent=2) + '\n')
with (W / 'native16-launch.log').open('w') as log:
    process = subprocess.Popen(['python3', str(W / 'optimized-controller.py'), str(out)],
                               stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
(W / 'native16-queue-launch.json').write_text(json.dumps({'controllerPID': process.pid, 'cpuAffinity': chosen}) + '\n')
