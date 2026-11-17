// Copyright 2026 GH0ST contributors.
// Host-only experimental optimization; no guest, engine or verifier changes.
package server_arb

import (
	"context"
	"fmt"
	"math"
	"sync"
	"sync/atomic"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/validator"
)

// RecordedStepStats counts actual machine progress, including work done before
// an error. Requested steps can exceed actual progress when a machine halts.
type RecordedStepStats struct {
	RequestedSteps uint64
	ActualSteps    uint64
	StepCalls      uint64
	HashCalls      uint64
	RecordedPoints uint64
	Complete       bool
	Disabled       bool
	FinalStep      uint64
}

// During eager construction this records authentic hashes at exact absolute
// wrapper-step boundaries. Nothing is served until CommitFinal succeeds.
// Tests can use Advance directly for a bounded real prefix without constructing
// upstream NewMachineCache, whose constructor eagerly executes to halt.
type recordedStepAccumulator struct {
	mu                               sync.RWMutex
	stride, maxPoints                uint64
	points                           map[uint64]common.Hash
	complete, disabled               bool
	finalStep                        uint64
	finalHash                        common.Hash
	requested, actual, calls, hashes atomic.Uint64
}

func newRecordedStepAccumulator(stride, maxPoints uint64) *recordedStepAccumulator {
	return &recordedStepAccumulator{stride: stride, maxPoints: maxPoints, points: make(map[uint64]common.Hash), disabled: stride == 0 || maxPoints == 0 || maxPoints > 65536}
}

func (r *recordedStepAccumulator) invalidate() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.disabled = true
	r.complete = false
	r.points = nil
}

func (r *recordedStepAccumulator) record(machine MachineInterface) error {
	step := machine.GetStepCount()
	r.mu.RLock()
	enabled := !r.disabled && !r.complete
	r.mu.RUnlock()
	if !enabled {
		return nil
	}
	hash := machine.Hash()
	r.hashes.Add(1)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disabled || r.complete {
		return nil
	}
	if old, ok := r.points[step]; ok {
		if old != hash {
			r.disabled = true
			r.points = nil
			return fmt.Errorf("inconsistent authentic machine hash at step %d", step)
		}
		return nil
	}
	if uint64(len(r.points)) >= r.maxPoints {
		// Optimization failure must not truncate or change execution. A bounded
		// overflow discards this memo and falls back to the real machine path.
		r.disabled = true
		r.points = nil
		return nil
	}
	r.points[step] = hash
	return nil
}

func (r *recordedStepAccumulator) ObserveInitial(machine MachineInterface) error {
	if machine.GetStepCount() != 0 {
		return fmt.Errorf("recording initial machine is not step zero")
	}
	return r.record(machine)
}

func (r *recordedStepAccumulator) step(ctx context.Context, machine MachineInterface, count uint64) error {
	before := machine.GetStepCount()
	r.requested.Add(count)
	r.calls.Add(1)
	err := machine.Step(ctx, count)
	after := machine.GetStepCount()
	if after >= before {
		r.actual.Add(after - before)
	}
	if err != nil {
		return err
	}
	if after < before || after-before > count {
		return fmt.Errorf("machine advanced outside requested step interval")
	}
	if after-before < count && machine.IsRunning() {
		return fmt.Errorf("machine returned a short running step")
	}
	return nil
}

func (r *recordedStepAccumulator) Advance(ctx context.Context, machine MachineInterface, count uint64) error {
	before := machine.GetStepCount()
	if count > math.MaxUint64-before {
		return fmt.Errorf("experimental machine step range overflow")
	}
	end := before + count
	r.mu.RLock()
	recording := !r.disabled && !r.complete
	stride := r.stride
	r.mu.RUnlock()
	if !recording {
		err := r.step(ctx, machine, count)
		if err != nil {
			r.invalidate()
		}
		return err
	}
	if count == 0 {
		return r.step(ctx, machine, 0)
	}
	for machine.GetStepCount() < end && machine.IsRunning() {
		if err := ctx.Err(); err != nil {
			r.invalidate()
			return err
		}
		current := machine.GetStepCount()
		target := end
		// Division and checked addition avoid wrapping the next boundary.
		quotient := current / stride
		if quotient < math.MaxUint64/stride {
			next := (quotient + 1) * stride
			if next > current && next < target {
				target = next
			}
		}
		if err := r.step(ctx, machine, target-current); err != nil {
			r.invalidate()
			return err
		}
		at := machine.GetStepCount()
		if at%stride == 0 {
			if err := r.record(machine); err != nil {
				r.invalidate()
				return err
			}
		}
		if !machine.IsRunning() {
			break
		}
		if at == current {
			r.invalidate()
			return fmt.Errorf("experimental recording made no progress")
		}
		r.mu.RLock()
		stillRecording := !r.disabled && !r.complete
		r.mu.RUnlock()
		if !stillRecording && at < end {
			return r.step(ctx, machine, end-at)
		}
	}
	return ctx.Err()
}

func (r *recordedStepAccumulator) CommitFinal(machine MachineInterface) error {
	if machine.IsRunning() {
		r.invalidate()
		return fmt.Errorf("cannot commit an unfinished recording")
	}
	if machine.IsErrored() || machine.Status() != uint8(validator.MachineStatusFinished) {
		r.invalidate()
		return nil
	}
	step, hash := machine.GetStepCount(), machine.Hash()
	r.hashes.Add(1)
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disabled {
		return nil
	}
	r.finalStep = step
	r.finalHash = hash
	r.complete = true
	return nil
}

// Hashes reproduces the legacy hash-list length and early-halt behavior.
// Padding hashes come only from an actually Finished machine. In particular,
// this never fabricates a last-running state or a proof at F-1.
func (r *recordedStepAccumulator) Hashes(start, stepSize, count uint64) ([]common.Hash, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.disabled || !r.complete || stepSize != r.stride || stepSize == 0 || count == 0 || start%stepSize != 0 {
		return nil, false
	}
	if count > 1 && (count-1) > (math.MaxUint64-start)/stepSize {
		return nil, false
	}
	if start >= r.finalStep {
		// Legacy starts with one hash, then performs one no-op stopped step and
		// appends another before noticing halt (unless count was one).
		if count == 1 {
			return []common.Hash{r.finalHash}, true
		}
		return []common.Hash{r.finalHash, r.finalHash}, true
	}
	capacity := count
	if capacity > r.maxPoints+1 {
		capacity = r.maxPoints + 1
	}
	out := make([]common.Hash, 0, int(capacity))
	position := start
	for uint64(len(out)) < count {
		if position >= r.finalStep {
			out = append(out, r.finalHash)
			return out, true
		}
		h, ok := r.points[position]
		if !ok {
			return nil, false
		}
		out = append(out, h)
		if uint64(len(out)) == count {
			return out, true
		}
		if stepSize > math.MaxUint64-position {
			return nil, false
		}
		position += stepSize
	}
	return out, true
}

func (r *recordedStepAccumulator) Snapshot() map[uint64]common.Hash {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[uint64]common.Hash, len(r.points))
	for k, v := range r.points {
		out[k] = v
	}
	return out
}

func (r *recordedStepAccumulator) Stats() RecordedStepStats {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return RecordedStepStats{RequestedSteps: r.requested.Load(), ActualSteps: r.actual.Load(), StepCalls: r.calls.Load(), HashCalls: r.hashes.Load(), RecordedPoints: uint64(len(r.points)), Complete: r.complete, Disabled: r.disabled, FinalStep: r.finalStep}
}
