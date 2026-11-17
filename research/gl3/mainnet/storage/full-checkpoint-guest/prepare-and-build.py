"""Runpod-only isolated Go overlays. No search, replay or baseline edits."""
from pathlib import Path
import hashlib, json, os, platform, resource, shutil, signal, subprocess, time

ROOT = Path('/root/gl3-full-checkpoint-guest')
if platform.system() != 'Linux' or Path(__file__).resolve().parent != ROOT:
    raise RuntimeError('Run only from the owned Runpod prefix')
EVIDENCE = ROOT / 'evidence'
EVIDENCE.mkdir(exist_ok=True)
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
       'GOCACHE': '/root/.cache/go-build', 'GOTMPDIR': str(ROOT / 'tmp'),
       'PATH': str(GO.parent) + ':' + os.environ['PATH']}
ENV.pop('GL3_CHECKPOINT_NEXT_DECISION', None)
(ROOT / 'tmp').mkdir(exist_ok=True)

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
# Formatting only our physical overlay sources; baseline sources are read-only.
run('format', [GO.parent/'gofmt', '-w', *sorted((ROOT/'profile').glob('*.go'))], ROOT)
manifest = {'profile': 'full-checkpoint-guest-v1', 'status': 'OVERLAYS_PREPARED',
            'allExecutionOnRunpod': True, 'engineSearchExecuted': False,
            'guestInterpreterExecuted': False, 'productionAccepted': False,
            'cpuAffinity': CPUS, 'scratchLimitBytes': SCRATCH, 'diskFreeFloorBytes': FLOOR,
            'profileSources': {p.name: sha(p) for p in sorted((ROOT/'profile').glob('*.go'))},
            'baselines': {}}
for role in ['native', 'guest']:
    base = BASE / role
    registry = base / 'precompiles/precompile.go'
    original = registry.read_text()
    anchor = 'insert(makeGhostChessSlicesPrecompile())'
    if original.count(anchor) != 1 or 'insertGhostChessCheckpointProfile(insert)' in original:
        raise RuntimeError('Pinned registry differs')
    reg = ROOT / ('precompile-' + role + '.go')
    reg.write_text(original.replace(anchor, anchor + '\n\tinsertGhostChessCheckpointProfile(insert)'))
    overlay = {str(registry): str(reg)}
    for p in (ROOT/'profile').glob('*.go'):
        overlay[str(base/'precompiles'/p.name)] = str(p)
    overlay_file = ROOT / ('overlay-' + role + '.json')
    overlay_file.write_text(json.dumps({'Replace': overlay}, indent=2) + '\n')
    manifest['baselines'][role] = {'path': str(base), 'registrySHA256': sha(registry),
      'goModSHA256': sha(base/'go.mod'), 'goSumSHA256': sha(base/'go.sum'),
      'selectedRestoreSources': {f: sha(base/'precompiles'/f) for f in
        ['ArbGhostChessSlices.go','ArbGhostChessSliceDelta.go','gl3_restore_schedule_wasm.go','gl3_restore_schedule_native.go']},
      'overlaySHA256': sha(overlay_file), 'registryOverlaySHA256': sha(reg)}
save('source-manifest.json', manifest)
for role in ['native','guest']:
    listenv = {**ENV, 'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'} if role=='guest' else ENV
    tags = 'gl3aotproof,gl3_checkpoint_integration' if role=='guest' else 'gl3_checkpoint_integration'
    run(role+'-go-list', [GO, 'list', '-overlay', ROOT/('overlay-'+role+'.json'),
        '-mod=readonly', '-tags='+tags, '-f', '{{.Dir}} {{.GoFiles}}', './precompiles'], BASE/role, listenv)
    chosen=(EVIDENCE/(role+'-go-list.log')).read_text()
    for expected in ['ArbGhostChessCheckpoint.go','cp_guest_policy.go','checkpoint_profile_enabled.go']:
        if expected not in chosen: raise RuntimeError('Overlay file not selected: '+role+'/'+expected)
run('guest-compile', [GO, 'build', '-overlay', ROOT/'overlay-guest.json', '-p', '2',
    '-mod=readonly', '-tags=gl3aotproof,gl3_checkpoint_integration', '-o', ROOT/'replay.raw.wasm', './cmd/replay'],
    BASE/'guest', {**ENV, 'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'})
run('guest-canonicalize', ['/root/bounded-restore/gh0st-wasm-canonicalizer', ROOT/'replay.raw.wasm', ROOT/'replay.wasm'], ROOT)
run('native-compile', [GO, 'test', '-c', '-overlay', ROOT/'overlay-native.json', '-p', '2',
    '-mod=readonly', '-tags=gl3_checkpoint_integration', '-o', ROOT/'native.test', './precompiles'], BASE/'native')
manifest.update(status='MATCHING_PROFILE_COMPILED_NOT_TESTED',
    guestRawSHA256=sha(ROOT/'replay.raw.wasm'), guestSHA256=sha(ROOT/'replay.wasm'),
    nativeTestSHA256=sha(ROOT/'native.test'), companionSHA256=sha('/root/bounded-restore/machine-inputs/gl3aot.wasm'))
save('compiled-manifest.json', manifest)
TEST_ENV={**ENV, 'GL3_CHECKPOINT_EVIDENCE': str(EVIDENCE)}
TEST_ENV.pop('GL3_CHECKPOINT_NEXT_DECISION', None)
pattern='^TestGL3Checkpoint(NextMoveAdmission|ProfileABIAndDomain|AcceleratorIdentity|RPCAdmissionLease|RealEVMGuardPreflight|CompletedNativeStateDB)$'
run('native-tests', [ROOT/'native.test', '-test.v', '-test.count=1', '-test.timeout=10m', '-test.run='+pattern], BASE/'native', TEST_ENV)
manifest.update(status='NATIVE_PROFILE_TESTS_PASSED_GUEST_COMPILED_NOT_EXECUTED',
    engineSearchExecuted=False, fullVMNativeColdCanonicalAccepted=True,
    guestInterpreterExecuted=False, guestProofAccepted=False, twentyGameCapacityAccepted=False)
# Verify the selected base files are unchanged after all overlay operations.
for role, frozen in manifest['baselines'].items():
    base=BASE/role
    if sha(base/'precompiles/precompile.go') != frozen['registrySHA256']:
        raise RuntimeError('Read-only baseline registry changed')
    for name, digest in frozen['selectedRestoreSources'].items():
        if sha(base/'precompiles'/name) != digest:
            raise RuntimeError('Read-only selected source changed')
save('result.json', manifest)
