package server_arb

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func integrationAwaitNoLive(t *testing.T, work *integrationWork) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for work.live.Load() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if work.live.Load() != 0 {
		t.Fatal("owned model machines survive final close", work.live.Load(), "clones", work.clones.Load(), "destroyed", work.destroyed.Load())
	}
}

func TestGL3IntegrationExperimentalCloseAfterBackwardsQueries(t *testing.T) {
	work := &integrationWork{}
	initial := newIntegrationMachine(31, 11, work)
	run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return initial, nil }, integrationExperimentalConfig())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, position := range []uint64{12, 3, 8, 2, 16, 7} {
		result, err := run.GetStepAt(position).Await(ctx)
		if err != nil || result.Hash != integrationHash(11, position, 31) {
			t.Fatal("backwards query mismatch", position, err)
		}
	}
	run.Close()
	integrationAwaitNoLive(t, work)
}

func TestGL3IntegrationExperimentalErrorCloneLifetimes(t *testing.T) {
	for _, kind := range []string{"constructor-populate", "query-step", "refinement-step"} {
		t.Run(kind, func(t *testing.T) {
			work := &integrationWork{}
			var failed atomic.Bool
			injected := errors.New("independent bounded model step failure")
			if kind == "constructor-populate" {
				work.hook = func(_ context.Context, position, delta uint64) error {
					if position >= 2 && delta > 0 && !failed.Swap(true) {
						return injected
					}
					return nil
				}
			}
			initial := newIntegrationMachine(31, 12, work)
			config := integrationExperimentalConfig()
			if kind == "query-step" {
				config.ExperimentalRefineRanges = false
			}
			run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return initial, nil }, config)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if kind == "constructor-populate" {
				if _, err = run.GetLastStep().Await(ctx); err == nil {
					t.Fatal("construction failure accepted")
				}
			} else {
				if _, err = run.GetLastStep().Await(ctx); err != nil {
					t.Fatal(err)
				}
				work.hook = func(_ context.Context, _ uint64, delta uint64) error {
					if delta > 0 && !failed.Swap(true) {
						return injected
					}
					return nil
				}
				if kind == "query-step" {
					_, err = run.GetStepAt(3).Await(ctx)
				} else {
					_, err = run.PrepareRange(5, 9).Await(ctx)
				}
				if err == nil || !failed.Load() {
					t.Fatal("expected actual step failure", kind, err)
				}
			}
			run.Close()
			integrationAwaitNoLive(t, work)
		})
	}
}

// Cancellation of the owner must stop callbacks before cache cleanup. Cleanup
// still needs an uncanceled context after those callbacks have returned.
func TestGL3IntegrationExperimentalCanceledOwnerCleanup(t *testing.T) {
	for _, kind := range []string{"completed-cache", "cooperative-builder"} {
		t.Run(kind, func(t *testing.T) {
			owner, cancelOwner := context.WithCancel(context.Background())
			defer cancelOwner()
			work := &integrationWork{}
			entered := make(chan struct{}, 1)
			if kind == "cooperative-builder" {
				work.hook = func(ctx context.Context, _ uint64, delta uint64) error {
					if delta > 0 {
						select {
						case entered <- struct{}{}:
						default:
						}
						<-ctx.Done()
						return ctx.Err()
					}
					return nil
				}
			}
			initial := newIntegrationMachine(31, 13, work)
			run, err := NewExecutionRun(owner, func(context.Context) (MachineInterface, error) { return initial, nil }, integrationExperimentalConfig())
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if kind == "completed-cache" {
				if _, err = run.GetStepAt(3).Await(ctx); err != nil {
					t.Fatal(err)
				}
			} else {
				select {
				case <-entered:
				case <-ctx.Done():
					t.Fatal("builder never entered", ctx.Err())
				}
			}
			cancelOwner()
			run.Close()
			integrationAwaitNoLive(t, work)
		})
	}
}
