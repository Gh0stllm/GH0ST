package client

// Real legacy 10-second health cadence and 5-second CheckAlive deadline are
// exercised here. This is a bounded mock transport test, not a native proof.
import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/validator"
)

type gl3HealthRun struct {
	*gl3PoolMockRun
	checks          atomic.Int64
	waitForDeadline bool
}

func (r *gl3HealthRun) CheckAlive(ctx context.Context) error {
	r.checks.Add(1)
	if r.waitForDeadline {
		<-ctx.Done()
		return ctx.Err()
	}
	return errors.New("bounded health regression: backend unavailable")
}

func TestGL3PoolPreservesLegacyHealthCancellation(t *testing.T) {
	for _, method := range []string{"hashes", "proof"} {
		for _, wait := range []bool{false, true} {
			method, wait := method, wait
			name := method + "/failure"
			if wait {
				name = method + "/timeout"
			}
			t.Run(name, func(t *testing.T) {
				t.Parallel()
				run := &gl3HealthRun{gl3PoolMockRun: newGL3PoolMockRun(), waitForDeadline: wait}
				pendingHashes := containers.NewPromise[[]common.Hash](nil)
				pendingProof := containers.NewPromise[[]byte](nil)
				run.onHashes = func(uint64, uint64, uint64) containers.PromiseInterface[[]common.Hash] { return &pendingHashes }
				run.onProof = func(uint64) containers.PromiseInterface[[]byte] { return &pendingProof }
				spawner := &gl3PoolMockSpawner{factory: func(index int) containers.PromiseInterface[validator.ExecutionRun] {
					if index == 0 {
						return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
					}
					return containers.NewReadyPromise[validator.ExecutionRun](newGL3PoolMockRun(), nil)
				}}
				pool := gl3Pool(t, spawner, 1, time.Minute)
				ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
				defer cancel()
				start := time.Now()
				var err error
				root := common.HexToHash("0x11")
				if method == "hashes" {
					_, err = pool.getMachineHashes(ctx, root, gl3PoolInput(), 0, 1, 2)
				} else {
					_, err = pool.getProof(ctx, root, gl3PoolInput(), 0)
				}
				elapsed := time.Since(start)
				if !errors.Is(err, context.Canceled) || ctx.Err() != nil {
					t.Fatalf("health did not cancel independently: query=%v caller=%v", err, ctx.Err())
				}
				minimum := 9 * time.Second
				if wait {
					minimum = 14 * time.Second
				}
				if elapsed < minimum || elapsed > 20*time.Second {
					t.Fatalf("unexpected legacy health timing: %s", elapsed)
				}
				if run.checks.Load() != 1 || run.closes.Load() != 1 || pool.stats().Invalidations != 1 || pool.stats().Leases != 0 || pool.stats().Entries != 0 {
					t.Fatal("uncertain health run retained", pool.stats(), run.checks.Load(), run.closes.Load())
				}
				if _, err = pool.getProof(ctx, root, gl3PoolInput(), 0); err != nil {
					t.Fatal("fresh master unavailable", err)
				}
				if pool.stats().Creates != 2 {
					t.Fatal("health-failed master reused", pool.stats())
				}
				t.Logf("method=%s deadline=%t elapsed=%s checks=%d closes=%d", method, wait, elapsed, run.checks.Load(), run.closes.Load())
			})
		}
	}
}
