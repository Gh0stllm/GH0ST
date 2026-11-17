// Copyright 2021-2026, Offchain Labs, Inc.
// For license information, see https://github.com/OffchainLabs/nitro/blob/master/LICENSE.md

package server_arb

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/spf13/pflag"
)

// MachineCache manages a list of machines at various step counts.
// Aims to speed the retrieval of a machine at a given step count.
type MachineCache struct {
	buildingLock chan struct{}
	err          error

	zeroStepMachine     MachineInterface
	finalMachine        MachineInterface
	finalMachineStep    uint64
	machines            []MachineInterface
	firstMachineStep    uint64
	machineStepInterval uint64
	config              *MachineCacheConfig

	lastMachine             MachineInterface
	lastMachineLock         sync.Mutex
	recording               *recordedStepAccumulator
	alignedListHits         atomic.Uint64
	experimentalRefinements atomic.Uint64
}

type MachineCacheConfig struct {
	CachedChallengeMachines        uint64 `koanf:"cached-challenge-machines"`
	InitialSteps                   uint64 `koanf:"initial-steps"`
	ExperimentalRecordedHashStride uint64 `koanf:"experimental-recorded-hash-stride"`
	ExperimentalMaxRecordedHashes  uint64 `koanf:"experimental-max-recorded-hashes"`
	ExperimentalSerializeQueries   bool   `koanf:"experimental-serialize-queries"`
	ExperimentalRefineRanges       bool   `koanf:"experimental-refine-ranges"`
}

var DefaultMachineCacheConfig = MachineCacheConfig{
	CachedChallengeMachines:       4,
	InitialSteps:                  100000,
	ExperimentalMaxRecordedHashes: 4096,
}

func MachineCacheConfigConfigAddOptions(prefix string, f *pflag.FlagSet) {
	f.Uint64(prefix+".initial-steps", DefaultMachineCacheConfig.InitialSteps, "initial steps between machines")
	f.Uint64(prefix+".cached-challenge-machines", DefaultMachineCacheConfig.CachedChallengeMachines, "how many machines to store in cache while working on a challenge (should be even)")
}

// `initialMachine` won't be mutated by this function.
func NewMachineCache(ctx context.Context, initialMachineGetter func(context.Context) (MachineInterface, error), config *MachineCacheConfig) *MachineCache {
	cache := &MachineCache{
		buildingLock: make(chan struct{}, 1), // locked on init
		config:       config,
	}
	if experimentalMachineCacheEnabled(config) {
		cache.recording = newRecordedStepAccumulator(config.ExperimentalRecordedHashStride, config.ExperimentalMaxRecordedHashes)
	}
	go func() {
		if err := validateExperimentalMachineCacheConfig(config); err != nil {
			cache.unlockBuild(err)
			return
		}
		zeroStepMachine, err := initialMachineGetter(ctx)
		if err == nil && zeroStepMachine.GetStepCount() != 0 {
			zeroStepMachine.Destroy()
			err = errors.New("initialMachine not at step count 0")
		}
		if err != nil {
			cache.unlockBuild(err)
			return
		}
		zeroStepMachine.Freeze()
		cache.zeroStepMachine = zeroStepMachine
		if cache.recording != nil {
			if err := cache.recording.ObserveInitial(zeroStepMachine); err != nil {
				cache.unlockBuild(err)
				return
			}
		}
		cache.machines = []MachineInterface{}
		cache.machineStepInterval = config.InitialSteps
		cache.finalMachineStep = ^uint64(0)
		for {
			err = cache.populateCache(ctx)
			if err != nil {
				cache.unlockBuild(err)
				return
			}
			if !cache.machines[len(cache.machines)-1].IsRunning() {
				break
			}
			compressedMachines := []MachineInterface{}
			for i, mach := range cache.machines {
				if i%2 == 1 {
					compressedMachines = append(compressedMachines, mach)
				} else {
					mach.Destroy()
				}
			}
			cache.machines = compressedMachines
			cache.firstMachineStep += cache.machineStepInterval
			cache.machineStepInterval *= 2
		}
		lastMachine := cache.machines[len(cache.machines)-1]
		cache.machines = cache.machines[:len(cache.machines)-1]
		cache.finalMachine = lastMachine
		cache.finalMachineStep = lastMachine.GetStepCount()
		if cache.recording != nil {
			if err := cache.recording.CommitFinal(lastMachine); err != nil {
				cache.unlockBuild(err)
				return
			}
		}
		cache.unlockBuild(nil)
	}()
	return cache
}

func (c *MachineCache) Destroy(ctx context.Context) {
	err := c.lockBuild(ctx)
	if err != nil {
		return
	}
	c.unlockBuild(errors.New("machine cache destroyed"))
}

func (c *MachineCache) destroyWithLock() {
	if c.zeroStepMachine != nil {
		c.zeroStepMachine.Destroy()
		c.zeroStepMachine = nil
	}
	if c.finalMachine != nil {
		c.finalMachine.Destroy()
		c.finalMachine = nil
	}
	for _, mach := range c.machines {
		mach.Destroy()
	}
	if c.recording != nil {
		if last := c.getLastMachine(); last != nil {
			last.Destroy()
		}
		c.recording.invalidate()
	}
}

func (c *MachineCache) lockBuild(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.buildingLock:
	}
	err := c.err
	if err != nil {
		c.buildingLock <- struct{}{}
	}
	return err
}

func (c *MachineCache) unlockBuild(err error) {
	c.err = err
	if err != nil {
		c.destroyWithLock()
	}
	c.buildingLock <- struct{}{}
}

func (c *MachineCache) setRangeLocked(ctx context.Context, start uint64, end uint64) error {
	newInterval := (end - start) / c.config.CachedChallengeMachines
	if newInterval == 0 {
		newInterval = 2
	}
	if start == 0 {
		start = newInterval / 2
	}
	if end >= c.finalMachineStep {
		end = c.finalMachineStep - newInterval/2
	}
	newInterval = (end - start) / c.config.CachedChallengeMachines
	if newInterval == 0 {
		newInterval = 1
	}
	if start == c.firstMachineStep && newInterval == c.machineStepInterval {
		return nil
	}
	closestIndex, closest := c.getClosestMachine(start)
	closestStep := closest.GetStepCount()
	if closestStep > start {
		return fmt.Errorf("initial machine step too large %d > %d", closestStep, start)
	}
	var retained []MachineInterface
	for i, mach := range c.machines {
		if i != closestIndex {
			mach.Destroy()
		} else if c.recording != nil {
			retained = append(retained, mach)
		}
	}
	// Experimental ownership follows only still-live snapshots, so a later
	// stepping error cannot destroy already-released machines a second time.
	if c.recording != nil {
		c.machines = retained
	}
	var initial MachineInterface
	if closestStep < start {
		initial = closest.CloneMachineInterface()
		err := c.experimentalStep(ctx, initial, start-closestStep)
		if err != nil {
			if c.recording != nil {
				initial.Destroy()
			}
			return err
		}
		if closest != c.zeroStepMachine && closest != c.finalMachine {
			closest.Destroy()
		}
		initial.Freeze()
	} else {
		initial = closest
	}
	c.machines = []MachineInterface{initial}
	c.firstMachineStep = start
	c.machineStepInterval = newInterval
	return c.populateCache(ctx)
}

func (c *MachineCache) SetRange(ctx context.Context, start uint64, end uint64) error {
	err := c.lockBuild(ctx)
	if err != nil {
		return err
	}
	err = c.setRangeLocked(ctx, start, end)
	c.unlockBuild(err)
	return err
}

func (c *MachineCache) populateCache(ctx context.Context) error {
	var nextMachine MachineInterface
	if len(c.machines) == 0 {
		nextMachine = c.zeroStepMachine
		c.firstMachineStep = c.machineStepInterval
	} else {
		nextMachine = c.machines[len(c.machines)-1]
	}
	for {
		if !nextMachine.IsRunning() {
			break
		}
		if nextMachine.GetStepCount()+c.machineStepInterval >= c.finalMachineStep {
			break
		}
		if uint64(len(c.machines)) >= c.config.CachedChallengeMachines {
			break
		}
		nextMachine = nextMachine.CloneMachineInterface()
		err := c.experimentalStep(ctx, nextMachine, c.machineStepInterval)
		if err != nil {
			if c.recording != nil {
				nextMachine.Destroy()
			}
			return err
		}
		nextMachine.Freeze()
		c.machines = append(c.machines, nextMachine)
	}
	return nil
}

// Warning: don't mutate the result of this!
func (c *MachineCache) getClosestMachine(stepCount uint64) (int, MachineInterface) {
	if stepCount < c.firstMachineStep {
		return -1, c.zeroStepMachine
	}
	if stepCount >= c.finalMachineStep {
		return len(c.machines), c.finalMachine
	}
	stepsFromStart := stepCount - c.firstMachineStep
	var index int
	// #nosec G115
	if c.machineStepInterval == 0 || stepsFromStart > c.machineStepInterval*uint64(len(c.machines)-1) {
		index = len(c.machines) - 1
	} else {
		// #nosec G115
		index = int(stepsFromStart / c.machineStepInterval)
	}
	return index, c.machines[index]
}

func (c *MachineCache) getLastMachine() MachineInterface {
	c.lastMachineLock.Lock()
	defer c.lastMachineLock.Unlock()
	last := c.lastMachine
	c.lastMachine = nil
	return last
}

func (c *MachineCache) setLastMachine(machine MachineInterface) {
	c.lastMachineLock.Lock()
	prevLast := c.lastMachine
	c.lastMachine = machine
	c.lastMachineLock.Unlock()
	if prevLast != nil {
		prevLast.Destroy()
	}
}

// GetMachineAt a given step count, optionally using a passed in machine if that's the best option.
func (c *MachineCache) GetMachineAt(ctx context.Context, stepCount uint64) (MachineInterface, error) {
	err := c.lockBuild(ctx)
	if err != nil {
		return nil, err
	}
	_, closestMachine := c.getClosestMachine(stepCount)
	lastMachine := c.getLastMachine()
	if lastMachine != nil && lastMachine.GetStepCount() >= closestMachine.GetStepCount() && lastMachine.GetStepCount() <= stepCount {
		closestMachine = lastMachine
	} else {
		if c.recording != nil && lastMachine != nil {
			lastMachine.Destroy()
		}
		closestMachine = closestMachine.CloneMachineInterface()
	}
	c.unlockBuild(nil)

	err = c.experimentalStep(ctx, closestMachine, stepCount-closestMachine.GetStepCount())
	if err != nil {
		if c.recording != nil {
			closestMachine.Destroy()
		}
		return nil, err
	}
	if !closestMachine.ValidForStep(stepCount) {
		actualStep := closestMachine.GetStepCount()
		if c.recording != nil {
			closestMachine.Destroy()
		}
		return nil, fmt.Errorf("internal error: got machine with wrong step count %v looking for step count %v", actualStep, stepCount)
	}
	c.setLastMachine(closestMachine)
	return closestMachine, nil
}

func (c *MachineCache) GetFinalMachine(ctx context.Context) (MachineInterface, error) {
	err := c.lockBuild(ctx)
	if err != nil {
		return nil, err
	}
	defer c.unlockBuild(nil)
	return c.finalMachine, nil
}
