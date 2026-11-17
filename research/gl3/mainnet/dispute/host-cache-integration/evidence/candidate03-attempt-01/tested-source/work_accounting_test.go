package server_arb

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestGL3IntegrationRecordedMemoAvoidsActualRepeatedSteps(t *testing.T) {
	work := &integrationWork{}
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return newIntegrationMachine(31, 14, work), nil }, integrationExperimentalConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer run.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err = run.GetLastStep().Await(ctx); err != nil {
		t.Fatal(err)
	}
	before := work.stepped.Load()
	statsBefore := run.ExperimentalStats()
	for repeat := 0; repeat < 3; repeat++ {
		rows, err := run.GetMachineHashesWithStepSize(0, 2, 20).Await(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 17 {
			t.Fatal("memo changed early Finished list", len(rows))
		}
		for i, h := range rows {
			position := uint64(i) * 2
			if position > 31 {
				position = 31
			}
			if h != integrationHash(14, position, 31) {
				t.Fatal("memo changed actual reference", i)
			}
		}
		rows[0][0] ^= 1
	}
	after := work.stepped.Load()
	statsAfter := run.ExperimentalStats()
	if after != before || statsAfter.Recording.ActualSteps != statsBefore.Recording.ActualSteps || statsAfter.AlignedListHits-statsBefore.AlignedListHits != 3 {
		t.Fatal("recorded lists repeated real machine work", before, after, statsBefore, statsAfter)
	}
	if out := os.Getenv("GL3_INTEGRATION_EVIDENCE"); out != "" {
		data, _ := json.MarshalIndent(map[string]any{"scope": "bounded interface model, not engine performance", "actualUnderlyingStepsBefore": before, "actualUnderlyingStepsAfterThreeLists": after, "before": statsBefore, "after": statsAfter, "passed": !t.Failed()}, "", "  ")
		if err = os.WriteFile(filepath.Join(out, "model-work-accounting.json"), append(data, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestGL3IntegrationRecordedCapacityFailureFallsBackExactly(t *testing.T) {
	work := &integrationWork{}
	config := integrationExperimentalConfig()
	config.ExperimentalMaxRecordedHashes = 2
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return newIntegrationMachine(31, 15, work), nil }, config)
	if err != nil {
		t.Fatal(err)
	}
	defer run.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err = run.GetLastStep().Await(ctx); err != nil {
		t.Fatal(err)
	}
	before := work.stepped.Load()
	if !run.ExperimentalStats().Recording.Disabled {
		t.Fatal("over-capacity memo not disabled")
	}
	rows, err := run.GetMachineHashesWithStepSize(0, 2, 4).Await(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, h := range rows {
		if h != integrationHash(15, uint64(i)*2, 31) {
			t.Fatal("fallback changed reference", i)
		}
	}
	if work.stepped.Load() <= before {
		t.Fatal("test did not exercise real fallback steps")
	}
	before = work.stepped.Load()
	if _, err = run.GetMachineHashesWithStepSize(^uint64(0)-1, 2, 3).Await(ctx); err == nil {
		t.Fatal("wrapped range overflow accepted")
	}
	if work.stepped.Load() != before {
		t.Fatal("overflow stepped before rejection")
	}
}

func TestGL3IntegrationServerCanceledAwaitKeepsWorkSerialized(t *testing.T) {
	work := &integrationWork{}
	config := integrationExperimentalConfig()
	config.ExperimentalRefineRanges = false
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return newIntegrationMachine(31, 16, work), nil }, config)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err = run.GetLastStep().Await(ctx); err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	var block atomic.Bool
	block.Store(true)
	defer func() { once.Do(func() { close(release) }); run.Close() }()
	work.hook = func(ctx context.Context, _ uint64, delta uint64) error {
		if delta > 0 && block.Swap(false) {
			close(entered)
			<-release
		}
		return ctx.Err()
	}
	first := run.GetStepAt(3)
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("first query did not enter Step")
	}
	canceled, cancelWait := context.WithCancel(ctx)
	cancelWait()
	if _, err = first.Await(canceled); err == nil {
		t.Fatal("canceled Await succeeded")
	}
	second := run.GetStepAt(5)
	select {
	case <-second.ReadyChan():
		t.Fatal("second callback completed while first Step was still active")
	case <-time.After(30 * time.Millisecond):
	}
	once.Do(func() { close(release) })
	if result, err := second.Await(ctx); err != nil || result.Hash != integrationHash(16, 5, 31) {
		t.Fatal("serialized successor failed", err)
	}
	run.Close()
	integrationAwaitNoLive(t, work)
}
