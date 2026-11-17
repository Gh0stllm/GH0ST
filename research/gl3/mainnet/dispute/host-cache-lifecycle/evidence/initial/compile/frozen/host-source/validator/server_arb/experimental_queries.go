// Copyright 2026 GH0ST contributors.
// Opt-in host execution/cache behavior only. Existing defaults remain unchanged.
package server_arb

import (
	"context"
	"fmt"
	"math"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/util/stopwaiter"
)

type ExperimentalMachineCacheStats struct {
	Enabled         bool
	Recording       RecordedStepStats
	AlignedListHits uint64
	Refinements     uint64
}

func experimentalMachineCacheEnabled(c *MachineCacheConfig) bool {
	return c != nil && (c.ExperimentalRecordedHashStride != 0 || c.ExperimentalSerializeQueries || c.ExperimentalRefineRanges)
}

func validateExperimentalMachineCacheConfig(c *MachineCacheConfig) error {
	if !experimentalMachineCacheEnabled(c) {
		return nil
	}
	if c.CachedChallengeMachines < 2 || c.CachedChallengeMachines > 16 || c.CachedChallengeMachines%2 != 0 {
		return fmt.Errorf("experimental machine cache needs an even snapshot target between two and sixteen")
	}
	if c.InitialSteps == 0 {
		return fmt.Errorf("experimental initial step interval must be positive")
	}
	if (c.ExperimentalRecordedHashStride != 0 || c.ExperimentalRefineRanges) && !c.ExperimentalSerializeQueries {
		return fmt.Errorf("experimental recording/refinement requires server query serialization")
	}
	if c.ExperimentalRecordedHashStride != 0 && (c.ExperimentalMaxRecordedHashes < 2 || c.ExperimentalMaxRecordedHashes > 65536) {
		return fmt.Errorf("experimental recorded hash bound must be between two and 65536")
	}
	return nil
}

func (c *MachineCache) experimentalStep(ctx context.Context, m MachineInterface, count uint64) error {
	if c.recording != nil {
		return c.recording.Advance(ctx, m, count)
	}
	return m.Step(ctx, count)
}

func (c *MachineCache) tryRecordedHashes(ctx context.Context, start, stride, count uint64) ([]common.Hash, bool, error) {
	if c.recording == nil {
		return nil, false, nil
	}
	if err := c.lockBuild(ctx); err != nil {
		return nil, false, err
	}
	defer c.unlockBuild(nil)
	result, ok := c.recording.Hashes(start, stride, count)
	if ok {
		c.alignedListHits.Add(1)
	}
	return result, ok, nil
}

func (c *MachineCache) ExperimentalStats() ExperimentalMachineCacheStats {
	x := ExperimentalMachineCacheStats{Enabled: c.recording != nil, AlignedListHits: c.alignedListHits.Load(), Refinements: c.experimentalRefinements.Load()}
	if c.recording != nil {
		x.Recording = c.recording.Stats()
	}
	return x
}

func launchExecutionOperation[T any](e *executionRun, fn func(context.Context) (T, error)) containers.PromiseInterface[T] {
	return stopwaiter.LaunchPromiseThread(e, func(ctx context.Context) (T, error) {
		if e.experimentalOperationLock != nil {
			select {
			case e.experimentalOperationLock <- struct{}{}:
				defer func() { <-e.experimentalOperationLock }()
			case <-ctx.Done():
				var zero T
				return zero, ctx.Err()
			}
			if err := ctx.Err(); err != nil {
				var zero T
				return zero, err
			}
		}
		// This uses the actual execution-run context, not a caller's RPC Await
		// context. A disconnected/cancelled client cannot release the server's
		// operation lock while underlying machine work is still running.
		return fn(ctx)
	})
}

func checkedExperimentalEnd(start, stride, count uint64) (uint64, error) {
	if stride == 0 {
		return 0, fmt.Errorf("step size cannot be 0")
	}
	if count == 0 {
		return 0, fmt.Errorf("max number of iterations cannot be 0")
	}
	if count-1 > (math.MaxUint64-start)/stride {
		return 0, fmt.Errorf("experimental machine query range overflow")
	}
	return start + (count-1)*stride, nil
}

func (e *executionRun) refineExperimentalRange(ctx context.Context, start, end uint64) error {
	if end < start {
		return fmt.Errorf("experimental range ends before start")
	}
	final, err := e.cache.GetFinalMachine(ctx)
	if err != nil {
		return err
	}
	F := final.GetStepCount()
	// Keep zero-step and Finished padding on their normal paths. Clipping
	// before SetRange avoids its unsigned subtraction corner cases.
	if start == 0 || start >= F {
		return nil
	}
	if end > F {
		end = F
	}
	if end == start {
		end = start + 1
	}
	if end > F {
		end = F
	}
	if err := e.cache.SetRange(ctx, start, end); err != nil {
		return err
	}
	e.cache.experimentalRefinements.Add(1)
	return nil
}

func (e *executionRun) ExperimentalStats() ExperimentalMachineCacheStats {
	return e.cache.ExperimentalStats()
}
