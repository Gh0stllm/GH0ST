"""Runpod-only isolated Go overlays. No search, replay or baseline edits."""
from pathlib import Path
import hashlib, json, os, platform, resource, shutil, signal, subprocess, time

ROOT = Path('/root/gl3-full-checkpoint-guest')
if platform.system() != 'Linux' or Path(__file__).resolve().parent != ROOT/'capture':
    raise RuntimeError('Run only from the owned Runpod prefix')
EVIDENCE = ROOT / 'capture/evidence'
EVIDENCE.mkdir(parents=True,exist_ok=True)
GO = Path('/root/bounded-restore/toolchain/go/bin/go')
BASE = Path('/root/bounded-restore/fast-comparison/C-combined')
FLOOR = 6_000_000_000
SCRATCH = 3 * 1024**3
CPUS = sorted(os.sched_getaffinity(0))[:2]
os.sched_setaffinity(0, CPUS)

def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def save(name, obj):
    (EVIDENCE / name).write_text(json.dumps(obj, indent=2) + '\n')

def allocated():
    total = 0
    for top, _, names in os.walk(ROOT):
        for name in names:
            p = Path(top) / name
            if not p.is_symlink():
                total += p.stat().st_blocks * 512
    return total

def check_space():
    free, used = shutil.disk_usage(ROOT).free, allocated()
    if free < FLOOR or used > SCRATCH:
        raise RuntimeError(f'Resource guard: free={free}, ownedAllocated={used}')
    return free, used

ENV = {**os.environ, 'GOTOOLCHAIN': 'local', 'GOMAXPROCS': '2',
       'GOMEMLIMIT': '6GiB', 'GOPROXY': 'off', 'GOSUMDB': 'off',
       'GOCACHE': '/root/.cache/go-build', 'GOTMPDIR': str(ROOT / 'capture/tmp'), 'TMPDIR': str(ROOT/'capture/tmp'),
       'NITRO_TEST_L1_GETH':'/root/terminal-acceptance/bin/geth',
       'PATH': str(GO.parent) + ':' + os.environ['PATH']}
ENV.pop('GL3_CHECKPOINT_NEXT_DECISION', None)
(ROOT / 'capture/tmp').mkdir(parents=True,exist_ok=True)

def run(label, args, cwd, env=ENV):
    check_space()
    start = time.monotonic()
    log = EVIDENCE / (label + '.log')
    with log.open('wb') as output:
        p = subprocess.Popen([str(a) for a in args], cwd=cwd, env=env,
                             stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        save(label + '-process.json', {'pid': p.pid, 'args': [str(a) for a in args],
             'cwd': str(cwd), 'cpuAffinity': CPUS, 'startedUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
             'allExecutionOnRunpod': True})
        guard_error = None
        guard_signal_time = None
        while True:
            waited, status, usage = os.wait4(p.pid, os.WNOHANG)
            if waited:
                actual_exit = os.waitstatus_to_exitcode(status)
                p.returncode = actual_exit
                break
            if guard_error is None:
                try:
                    check_space()
                except Exception as e:
                    guard_error = str(e)
                    guard_signal_time = time.monotonic()
                    os.killpg(p.pid, signal.SIGTERM)
            elif time.monotonic() - guard_signal_time > 5:
                try: os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            time.sleep(0.25)
    result = {'exitCode': actual_exit, 'seconds': time.monotonic() - start,
              'resourceGuardFailure': guard_error, 'allExecutionOnRunpod': True,
              'ownedAllocatedBytes': allocated(), 'freeBytes': shutil.disk_usage(ROOT).free}
    if usage is not None: result['kernelMaxRSSKiB'] = usage.ru_maxrss
    save(label + '-exit.json', result)
    if actual_exit or guard_error:
        raise RuntimeError(label + ' failed: see preserved actual exit/log')
    return result


check_space()
profile=json.loads((ROOT/'evidence/result.json').read_text())
for name,digest in profile['profileSources'].items():
 if sha(ROOT/'profile'/name)!=digest:raise RuntimeError('Frozen v1 profile changed')
assert sha(ROOT/'replay.wasm')=='fc5645ec7536ca7191c4eaa1db0fa381a67dafb46cdf844eb6403298516fed5d'
assert sha(ROOT/'machine-generation/machine/machine.v2.wavm.br')=='9f5ce0c06b01debaf3077c95559d38af11d2d7925f02721742acacfcfb944752'
run('format',[GO.parent/'gofmt','-w',*sorted((ROOT/'capture').glob('*.go'))],ROOT)
overlay=json.loads((ROOT/'overlay-native.json').read_text())['Replace']
overlay[str(BASE/'native/precompiles/checkpoint_fixture_export_capture.go')]=str(ROOT/'capture/checkpoint_fixture_export.go')
overlay[str(BASE/'native/system_tests/gl3_checkpoint_begin_capture_test.go')]=str(ROOT/'capture/gl3_checkpoint_begin_capture_test.go')
overlay[str(BASE/'native/system_tests/external_l1.go')]=str(ROOT/'capture/external_l1_capture.go')
O=ROOT/'capture/overlay.json';O.write_text(json.dumps({'Replace':overlay},indent=2)+'\n')
manifest={'profile':'full-checkpoint-guest-v1-short-private-begin-capture','sources':{p.name:sha(p) for p in sorted((ROOT/'capture').glob('*.go'))},'frozenV1Sources':profile['profileSources'],'overlaySHA256':sha(O),'matchingMachineRoot':'0x2a423e3e57903ae5bcb7385608d05387201b5cde24a7d4138d5b7ec09cb9e608','matchingMachineSHA256':sha(ROOT/'machine-generation/machine/machine.v2.wavm.br'),'guestSHA256':sha(ROOT/'replay.wasm'),'parentGethSHA256':sha(Path(ENV['NITRO_TEST_L1_GETH'])),'full24mSearchPermitted':False,'originalQuantaRequested':4,'guestReplayPermitted':False,'allExecutionOnRunpod':True,'productionAccepted':False}
save('source-manifest.json',manifest)
run('compile',[GO,'test','-c','-overlay',O,'-p','2','-mod=readonly','-tags=gl3_acceptance,gl3_checkpoint_integration,gl3_checkpoint_capture','-o',ROOT/'capture/capture.test','./system_tests'],BASE/'native')
manifest['nativeCaptureELFSHA256']=sha(ROOT/'capture/capture.test');save('compiled-inputs.json',manifest)
env={**ENV,'GL3_CHECKPOINT_EVIDENCE':str(EVIDENCE),'GL3_CHECKPOINT_CAPTURE_EVIDENCE':str(EVIDENCE),'GL3_CHECKPOINT_CAPTURE_MACHINES':str(ROOT/'machines')}
run('capture',[ROOT/'capture/capture.test','-test.v','-test.timeout=10m','-test.count=1','-test.run=^TestGL3CheckpointedBeginBlockCapture$'],BASE/'native',env)
report=json.loads((EVIDENCE/'capture-manifest.json').read_text())
if not report['passed'] or report['guestReplayExecuted'] or report['fullSearchExecuted']:raise RuntimeError('Invalid capture scope')
log=(EVIDENCE/'capture.log').read_text()
if '--- PASS: TestGL3CheckpointedBeginBlockCapture' not in log or '\nPASS\n' not in log:raise RuntimeError('Named actual test pass missing')
for name,digest in profile['profileSources'].items():
 if sha(ROOT/'profile'/name)!=digest:raise RuntimeError('Frozen v1 profile changed during capture')
manifest.update(status='PRIVATE_SHORT_BEGIN_CAPTURE_READY_NOT_GUEST_REPLAYED',passed=True,capture=report)
save('result.json',manifest)
