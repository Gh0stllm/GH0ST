"""Historical first-assembly script, retained for provenance only.

The final frozen/reproducible overlay is apply_overlay.py + candidate-01/.
This initial draft predates review cleanup fixes and must not be used to
reconstruct or claim the final candidate.
"""
from pathlib import Path
import hashlib
import json
import subprocess

base = Path('/root/gl3-host-execution-cache')
sdk = base / 'nitro'
before = json.loads((base / 'baseline-manifest.json').read_text())
for name in ['validator/server_arb/machine_cache.go', 'validator/server_arb/execution_run.go']:
    assert hashlib.sha256((sdk / name).read_bytes()).hexdigest() == before['files'][name]

p = sdk / 'validator/server_arb/machine_cache.go'
s = p.read_text().replace('"sync"', '"sync"\n\t"sync/atomic"', 1)
s = s.replace('lastMachineLock sync.Mutex\n}', '''lastMachineLock sync.Mutex
	recording *recordedStepAccumulator
	alignedListHits atomic.Uint64
	experimentalRefinements atomic.Uint64
}''', 1)
needle = 'InitialSteps            uint64 `koanf:"initial-steps"`'
assert needle in s
s = s.replace(needle, needle + '''
	ExperimentalRecordedHashStride uint64 `koanf:"experimental-recorded-hash-stride"`
	ExperimentalMaxRecordedHashes uint64 `koanf:"experimental-max-recorded-hashes"`
	ExperimentalSerializeQueries bool `koanf:"experimental-serialize-queries"`
	ExperimentalRefineRanges bool `koanf:"experimental-refine-ranges"`''', 1)
s = s.replace('InitialSteps:            100000,', 'InitialSteps:            100000,\n\tExperimentalMaxRecordedHashes: 4096,', 1)
needle = '\tgo func() {\n\t\tzeroStepMachine, err := initialMachineGetter(ctx)'
assert needle in s
s = s.replace(needle, '''	if experimentalMachineCacheEnabled(config) {
		cache.recording = newRecordedStepAccumulator(config.ExperimentalRecordedHashStride, config.ExperimentalMaxRecordedHashes)
	}
	go func() {
		if err := validateExperimentalMachineCacheConfig(config); err != nil { cache.unlockBuild(err); return }
		zeroStepMachine, err := initialMachineGetter(ctx)''', 1)
s = s.replace('cache.zeroStepMachine = zeroStepMachine', '''cache.zeroStepMachine = zeroStepMachine
		if cache.recording != nil { if err := cache.recording.ObserveInitial(zeroStepMachine); err != nil { cache.unlockBuild(err); return } }''', 1)
s = s.replace('cache.finalMachineStep = lastMachine.GetStepCount()', '''cache.finalMachineStep = lastMachine.GetStepCount()
		if cache.recording != nil { if err := cache.recording.CommitFinal(lastMachine); err != nil { cache.unlockBuild(err); return } }''', 1)
s = s.replace('err := initial.Step(ctx, start-closestStep)', 'err := c.experimentalStep(ctx, initial, start-closestStep)', 1)
s = s.replace('err := nextMachine.Step(ctx, c.machineStepInterval)', 'err := c.experimentalStep(ctx, nextMachine, c.machineStepInterval)', 1)
s = s.replace('err = closestMachine.Step(ctx, stepCount-closestMachine.GetStepCount())', 'err = c.experimentalStep(ctx, closestMachine, stepCount-closestMachine.GetStepCount())', 1)
needle = '\tfor _, mach := range c.machines {\n\t\tmach.Destroy()\n\t}\n}'
assert needle in s
s = s.replace(needle, '''	for _, mach := range c.machines {
		mach.Destroy()
	}
	if c.recording != nil {
		if last := c.getLastMachine(); last != nil { last.Destroy() }
		c.recording.invalidate()
	}
}''', 1)
p.write_text(s)

p = sdk / 'validator/server_arb/execution_run.go'
s = p.read_text().replace('close sync.Once\n}', 'close sync.Once\n\texperimentalOperationLock chan struct{}\n}', 1)
s = s.replace('exec := &executionRun{}', '''if err := validateExperimentalMachineCacheConfig(config); err != nil { return nil, err }
	exec := &executionRun{}
	if config.ExperimentalSerializeQueries { exec.experimentalOperationLock = make(chan struct{}, 1) }''', 1)
for typ in ['struct{}', '*validator.MachineStepResult', '[]byte']:
    s = s.replace('stopwaiter.LaunchPromiseThread[' + typ + '](e,', 'launchExecutionOperation[' + typ + '](e,')
s = s.replace('stopwaiter.LaunchPromiseThread(e,', 'launchExecutionOperation(e,')
s = s.replace('err := e.cache.SetRange(ctx, start, end)', '''var err error
		if experimentalMachineCacheEnabled(e.cache.config) { err = e.refineExperimentalRange(ctx, start, end) } else { err = e.cache.SetRange(ctx, start, end) }''', 1)
s = s.replace('} else {\n\t\t\tmachine, err = e.cache.GetMachineAt(ctx, position)', '''} else {
			if e.cache.config.ExperimentalRefineRanges { if err = e.refineExperimentalRange(ctx, position, position); err != nil { return nil, err } }
			machine, err = e.cache.GetMachineAt(ctx, position)''', 1)
needle = '\tif maxIterations == 0 {\n\t\treturn nil, fmt.Errorf("max number of iterations cannot be 0")\n\t}\n'
assert needle in s
s = s.replace(needle, needle + '''	if experimentalMachineCacheEnabled(e.cache.config) {
		end, err := checkedExperimentalEnd(machineStartIndex, stepSize, maxIterations); if err != nil { return nil, err }
		if hashes, ok, err := e.cache.tryRecordedHashes(ctx, machineStartIndex, stepSize, maxIterations); err != nil { return nil, err } else if ok { return hashes, nil }
		if e.cache.config.ExperimentalRefineRanges { if err := e.refineExperimentalRange(ctx, machineStartIndex, end); err != nil { return nil, err } }
	}
''', 1)
s = s.replace('if err := machine.Step(ctx, stepSize); err != nil {', 'if err := e.cache.experimentalStep(ctx, machine, stepSize); err != nil {', 1)
needle = 'return launchExecutionOperation[[]byte](e, func(ctx context.Context) ([]byte, error) {\n\t\tmachine, err := e.cache.GetMachineAt(ctx, position)'
assert needle in s
s = s.replace(needle, '''return launchExecutionOperation[[]byte](e, func(ctx context.Context) ([]byte, error) {
		if e.cache.config.ExperimentalRefineRanges { if err := e.refineExperimentalRange(ctx, position, position); err != nil { return nil, err } }
		machine, err := e.cache.GetMachineAt(ctx, position)''', 1)
p.write_text(s)

p = sdk / 'validator/server_arb/experimental_queries.go'
s = p.read_text().replace('\tif !e.cache.config.ExperimentalRefineRanges{return nil}\n', '')
needle = '\tif c.InitialSteps==0{return fmt.Errorf("experimental initial step interval must be positive")}'
assert needle in s
s = s.replace(needle, needle + '''
	if (c.ExperimentalRecordedHashStride != 0 || c.ExperimentalRefineRanges) && !c.ExperimentalSerializeQueries { return fmt.Errorf("experimental recording/refinement requires server query serialization") }''', 1)
p.write_text(s)

gofmt = '/root/bounded-restore/toolchain/go/bin/gofmt'
subprocess.run([gofmt, '-w'] + [str(sdk / name) for name in [
    'validator/server_arb/machine_cache.go', 'validator/server_arb/execution_run.go',
    'validator/server_arb/recorded_steps.go', 'validator/server_arb/experimental_queries.go',
]], check=True)
print('Applied isolated native host changes; no build or replay performed')
