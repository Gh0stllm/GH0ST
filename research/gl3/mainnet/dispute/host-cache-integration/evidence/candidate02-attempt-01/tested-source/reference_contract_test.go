package server_arb

import (
	"context"
	"testing"
	"time"
)

func integrationExperimentalConfig() *MachineCacheConfig {
	return &MachineCacheConfig{CachedChallengeMachines: 4, InitialSteps: 2, ExperimentalRecordedHashStride: 2, ExperimentalMaxRecordedHashes: 128, ExperimentalSerializeQueries: true, ExperimentalRefineRanges: true}
}

// These exercise the actual executionRun/MachineCache contract with a faithful
// bounded MachineInterface, not a separately reimplemented cache.
func TestGL3IntegrationReferenceRangeAndFinishedPadding(t *testing.T) {
	work := &integrationWork{}
	initial := newIntegrationMachine(31, 7, work)
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return initial, nil }, integrationExperimentalConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer run.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	rows, err := run.GetMachineHashesWithStepSize(0, 3, 20).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	expected := []uint64{0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 31}
	if len(rows) != len(expected) {
		t.Fatal("hash list/Finished boundary", len(rows))
	}
	for i, pos := range expected {
		if rows[i] != integrationHash(7, pos, 31) {
			t.Fatal("wrong reference hash", i, pos)
		}
	}
	padded, err := run.GetStepAt(99).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if padded.Position != 31 || uint8(padded.Status) != 1 || padded.Hash != integrationHash(7, 31, 31) {
		t.Fatal("Finished padding changed exact halt result")
	}
	proofAtH, err := run.GetProofAt(31).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	proofAfterH, err := run.GetProofAt(99).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(proofAtH) != string(proofAfterH) {
		t.Fatal("absorbing proof changed after Finished")
	}
	if _, err = run.PrepareRange(20, 26).Await(ctx); err != nil {
		t.Fatal(err)
	}
	narrow, err := run.GetMachineHashesWithStepSize(22, 1, 3).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, pos := range []uint64{22, 23, 24} {
		if narrow[i] != integrationHash(7, pos, 31) {
			t.Fatal("refined range changed execution")
		}
	}
}

func TestGL3IntegrationReferenceImmutableQueryOutputs(t *testing.T) {
	work := &integrationWork{}
	initial := newIntegrationMachine(17, 8, work)
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return initial, nil }, integrationExperimentalConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer run.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	first, err := run.GetMachineHashesWithStepSize(0, 2, 4).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first[1][0] ^= 1
	second, err := run.GetMachineHashesWithStepSize(0, 2, 4).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if second[1] != integrationHash(8, 2, 17) {
		t.Fatal("caller poisoned hash list")
	}
	proof, err := run.GetProofAt(3).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	proof[0] ^= 1
	again, err := run.GetProofAt(3).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(proof) == string(again) {
		t.Fatal("caller poisoned later proof")
	}
	result, err := run.GetStepAt(4).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	result.GlobalState.Batch = 999
	result.Hash[0] ^= 1
	fresh, err := run.GetStepAt(4).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.GlobalState.Batch != 4 || fresh.Hash != integrationHash(8, 4, 17) {
		t.Fatal("caller poisoned step result")
	}
}

func TestGL3IntegrationActualBoldWrapperOffsetAndPadding(t *testing.T) {
	work := &integrationWork{}
	inner := newIntegrationMachine(31, 9, work)
	wrapped := BoldMachineWrapper(inner)
	defer wrapped.Destroy()
	if wrapped.GetStepCount() != 0 || wrapped.Status() != 1 || !wrapped.IsRunning() {
		t.Fatal("actual wrapper kickoff contract")
	}
	initial := wrapped.Hash()
	if initial == integrationHash(9, 0, 31) {
		t.Fatal("wrapper lost canonical Finished kickoff")
	}
	if err := wrapped.Step(context.Background(), 1); err != nil {
		t.Fatal(err)
	}
	if wrapped.GetStepCount() != 1 || wrapped.Hash() != integrationHash(9, 0, 31) {
		t.Fatal("raw0 must equal wrapped1")
	}
	if err := wrapped.Step(context.Background(), 5); err != nil {
		t.Fatal(err)
	}
	if wrapped.GetStepCount() != 6 || wrapped.Hash() != integrationHash(9, 5, 31) {
		t.Fatal("wrapper raw+1 relation")
	}
	clone := wrapped.CloneMachineInterface()
	defer clone.Destroy()
	if clone.GetStepCount() != 6 || clone.Hash() != wrapped.Hash() {
		t.Fatal("clone lost wrapper position")
	}
	if err := wrapped.Step(context.Background(), 100); err != nil {
		t.Fatal(err)
	}
	if wrapped.GetStepCount() != 32 || wrapped.Status() != 1 || wrapped.IsRunning() || !wrapped.ValidForStep(999) {
		t.Fatal("actual wrapper Finished padding")
	}
	finished := wrapped.Hash()
	if err := wrapped.Step(context.Background(), 7); err != nil {
		t.Fatal(err)
	}
	if wrapped.Hash() != finished || wrapped.GetStepCount() != 32 {
		t.Fatal("padding mutated Finished result")
	}
	if clone.GetStepCount() != 6 || clone.Hash() != integrationHash(9, 5, 31) {
		t.Fatal("borrower clone advanced with original")
	}
}

func TestGL3IntegrationActualCacheCloseReclaimsLastMachine(t *testing.T) {
	work := &integrationWork{}
	initial := newIntegrationMachine(17, 10, work)
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return initial, nil }, integrationExperimentalConfig())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err = run.GetStepAt(3).Await(ctx); err != nil {
		t.Fatal(err)
	}
	run.Close()
	run.Close()
	deadline := time.Now().Add(2 * time.Second)
	for work.live.Load() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if work.live.Load() != 0 {
		t.Fatal("execution cache retained a live machine after final close", work.live.Load())
	}
}
