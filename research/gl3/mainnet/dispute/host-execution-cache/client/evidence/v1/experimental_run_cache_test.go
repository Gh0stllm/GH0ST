// SPDX-License-Identifier: GPL-3.0-or-later
package client

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/offchainlabs/nitro/daprovider"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/validator"
)

type gl3PoolMockRun struct {
	closes   atomic.Int64
	active   atomic.Int64
	peak     atomic.Int64
	hashes   []common.Hash
	proof    []byte
	onHashes func(uint64, uint64, uint64) containers.PromiseInterface[[]common.Hash]
	onProof  func(uint64) containers.PromiseInterface[[]byte]
	onClose  func()
}

func newGL3PoolMockRun() *gl3PoolMockRun {
	return &gl3PoolMockRun{hashes: []common.Hash{common.HexToHash("0x01"), common.HexToHash("0x02")}, proof: []byte{1, 2, 3}}
}
func (r *gl3PoolMockRun) GetMachineHashesWithStepSize(a, b, c uint64) containers.PromiseInterface[[]common.Hash] {
	if r.onHashes != nil {
		return r.onHashes(a, b, c)
	}
	return containers.NewReadyPromise(r.hashes, nil)
}
func (r *gl3PoolMockRun) GetProofAt(pos uint64) containers.PromiseInterface[[]byte] {
	if r.onProof != nil {
		return r.onProof(pos)
	}
	return containers.NewReadyPromise(r.proof, nil)
}
func (r *gl3PoolMockRun) GetStepAt(pos uint64) containers.PromiseInterface[*validator.MachineStepResult] {
	return containers.NewReadyPromise(&validator.MachineStepResult{Position: pos}, nil)
}
func (r *gl3PoolMockRun) GetLastStep() containers.PromiseInterface[*validator.MachineStepResult] {
	return r.GetStepAt(10)
}
func (r *gl3PoolMockRun) PrepareRange(a, b uint64) containers.PromiseInterface[struct{}] {
	return containers.NewReadyPromise(struct{}{}, nil)
}
func (r *gl3PoolMockRun) CheckAlive(context.Context) error { return nil }
func (r *gl3PoolMockRun) Close() {
	if r.closes.Add(1) == 1 && r.onClose != nil {
		r.onClose()
	}
}

type gl3PoolMockSpawner struct {
	mu      sync.Mutex
	creates int
	runs    []*gl3PoolMockRun
	inputs  []*validator.ValidationInput
	roots   []common.Hash
	bold    []bool
	factory func(int) containers.PromiseInterface[validator.ExecutionRun]
}

func (s *gl3PoolMockSpawner) CreateExecutionRun(root common.Hash, in *validator.ValidationInput, bold bool) containers.PromiseInterface[validator.ExecutionRun] {
	s.mu.Lock()
	index := s.creates
	s.creates++
	s.inputs = append(s.inputs, in)
	s.roots = append(s.roots, root)
	s.bold = append(s.bold, bold)
	factory := s.factory
	if factory != nil {
		s.mu.Unlock()
		return factory(index)
	}
	r := newGL3PoolMockRun()
	s.runs = append(s.runs, r)
	s.mu.Unlock()
	return containers.NewReadyPromise[validator.ExecutionRun](r, nil)
}
func (s *gl3PoolMockSpawner) Launch(*validator.ValidationInput, common.Hash) validator.ValidationRun {
	return nil
}
func (s *gl3PoolMockSpawner) WasmModuleRoots() ([]common.Hash, error) { return nil, nil }
func (s *gl3PoolMockSpawner) Start(context.Context) error             { return nil }
func (s *gl3PoolMockSpawner) Stop()                                   {}
func (s *gl3PoolMockSpawner) Name() string                            { return "gl3-tiny-pool-mock" }
func (s *gl3PoolMockSpawner) StylusArchs() []rawdb.WasmTarget         { return []rawdb.WasmTarget{"mock"} }
func (s *gl3PoolMockSpawner) Capacity() int                           { return 1 }

func gl3PoolInput() *validator.ValidationInput {
	return &validator.ValidationInput{Id: 7, Preimages: daprovider.PreimagesMap{0: {common.HexToHash("0x01"): []byte("source-bytes")}}, BatchInfo: []validator.BatchInfo{{Number: 1, Data: []byte("batch")}}}
}
func gl3Pool(t *testing.T, s *gl3PoolMockSpawner, max int, ttl time.Duration) *experimentalRunCache {
	t.Helper()
	p, e := newExperimentalRunCache(context.Background(), s, ExperimentalRunCacheConfig{max, ttl})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(p.stop)
	return p
}
func gl3Wait(t *testing.T, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !f() {
		if time.Now().After(deadline) {
			t.Fatal("condition timeout")
		}
		time.Sleep(time.Millisecond)
	}
}
func gl3Ctx(t *testing.T) (context.Context, context.CancelFunc) {
	t.Helper()
	return context.WithTimeout(context.Background(), 3*time.Second)
}

func TestGL3PoolReuseLeaseAndCopiedResults(t *testing.T) {
	s := &gl3PoolMockSpawner{}
	p := gl3Pool(t, s, 2, time.Minute)
	ctx, cancel := gl3Ctx(t)
	defer cancel()
	root := common.HexToHash("0x11")
	in := gl3PoolInput()
	a, e := p.getMachineHashes(ctx, root, in, 3, 5, 2)
	if e != nil {
		t.Fatal(e)
	}
	a[0] = common.HexToHash("0xff")
	b, e := p.getMachineHashes(ctx, root, in, 3, 5, 2)
	if e != nil || b[0] == a[0] {
		t.Fatal("hash output alias", e)
	}
	x, e := p.getProof(ctx, root, in, 9)
	if e != nil {
		t.Fatal(e)
	}
	x[0] = 99
	y, e := p.getProof(ctx, root, in, 9)
	if e != nil || y[0] != 1 {
		t.Fatal("proof output alias", e)
	}
	s.mu.Lock()
	run := s.runs[0]
	bold := s.bold[0]
	s.mu.Unlock()
	if run.closes.Load() != 0 || !bold {
		t.Fatal("lease closed master or wrapper mode lost")
	}
	stats := p.stats()
	if stats.Creates != 1 || stats.Hits != 3 || stats.Leases != 0 || stats.Entries != 1 {
		t.Fatal(stats)
	}
	stats.Entries = 999
	if p.stats().Entries != 1 {
		t.Fatal("stats alias")
	}
	p.stop()
	p.stop()
	if run.closes.Load() != 1 || p.stats().Closes != 1 {
		t.Fatal("owner closure not idempotent")
	}
	if _, e = p.getProof(ctx, root, in, 0); e == nil {
		t.Fatal("stopped pool reused master")
	}
}

func TestGL3PoolOwnedInputsAndRootSeparation(t *testing.T) {
	s := &gl3PoolMockSpawner{}
	p := gl3Pool(t, s, 3, time.Minute)
	ctx, cancel := gl3Ctx(t)
	defer cancel()
	root := common.HexToHash("0x11")
	in := gl3PoolInput()
	key := common.HexToHash("0x01")
	if _, e := p.getProof(ctx, root, in, 0); e != nil {
		t.Fatal(e)
	}
	in.Preimages[0][key][0] ^= 1
	in.BatchInfo[0].Data[0] ^= 1
	s.mu.Lock()
	owned := s.inputs[0]
	s.mu.Unlock()
	if string(owned.Preimages[0][key]) != "source-bytes" || string(owned.BatchInfo[0].Data) != "batch" {
		t.Fatal("caller alias retained")
	}
	if _, e := p.getProof(ctx, root, in, 0); e != nil {
		t.Fatal(e)
	}
	if _, e := p.getProof(ctx, common.HexToHash("0x22"), in, 0); e != nil {
		t.Fatal(e)
	}
	if p.stats().Creates != 3 {
		t.Fatal("distinct input/root reused", p.stats())
	}
	if _, e := p.getProof(ctx, common.Hash{}, in, 0); e == nil {
		t.Fatal("unresolved root accepted")
	}
}

func TestGL3PoolSerializesOneEntry(t *testing.T) {
	r := newGL3PoolMockRun()
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var calls atomic.Int64
	r.onHashes = func(a, b, c uint64) containers.PromiseInterface[[]common.Hash] {
		if a != 10 || b != 2 || c != 3 {
			t.Error("query geometry changed")
		}
		n := r.active.Add(1)
		for old := r.peak.Load(); n > old && !r.peak.CompareAndSwap(old, n); old = r.peak.Load() {
		}
		index := calls.Add(1)
		entered <- struct{}{}
		promise := containers.NewPromise[[]common.Hash](nil)
		go func() {
			if index == 1 {
				<-release
			}
			r.active.Add(-1)
			promise.Produce(r.hashes)
		}()
		return &promise
	}
	s := &gl3PoolMockSpawner{factory: func(int) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](r, nil)
	}}
	p := gl3Pool(t, s, 1, time.Minute)
	ctx, cancel := gl3Ctx(t)
	defer cancel()
	root := common.HexToHash("0x11")
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(1)
	go func() { defer wg.Done(); _, e := p.getMachineHashes(ctx, root, gl3PoolInput(), 10, 2, 3); errs <- e }()
	<-entered
	wg.Add(1)
	go func() { defer wg.Done(); _, e := p.getMachineHashes(ctx, root, gl3PoolInput(), 10, 2, 3); errs <- e }()
	gl3Wait(t, func() bool { return p.stats().Leases == 2 })
	if calls.Load() != 1 {
		t.Fatal("second query entered before release")
	}
	close(release)
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	if r.peak.Load() != 1 || calls.Load() != 2 || p.stats().Creates != 1 {
		t.Fatal("query overlap or duplicate master", p.stats())
	}
}

func TestGL3PoolQueryErrorInvalidatesAndRecreates(t *testing.T) {
	want := errors.New("exact query failure")
	r := newGL3PoolMockRun()
	r.onProof = func(uint64) containers.PromiseInterface[[]byte] { return containers.NewReadyPromise[[]byte](nil, want) }
	s := &gl3PoolMockSpawner{factory: func(n int) containers.PromiseInterface[validator.ExecutionRun] {
		if n == 0 {
			return containers.NewReadyPromise[validator.ExecutionRun](r, nil)
		}
		return containers.NewReadyPromise[validator.ExecutionRun](newGL3PoolMockRun(), nil)
	}}
	p := gl3Pool(t, s, 1, time.Minute)
	ctx, cancel := gl3Ctx(t)
	defer cancel()
	root := common.HexToHash("0x11")
	if data, e := p.getProof(ctx, root, gl3PoolInput(), 0); !errors.Is(e, want) || data != nil {
		t.Fatal("error was normalized or partial data returned", e)
	}
	if r.closes.Load() != 1 || p.stats().Entries != 0 || p.stats().Invalidations != 1 {
		t.Fatal(p.stats())
	}
	if _, e := p.getProof(ctx, root, gl3PoolInput(), 0); e != nil {
		t.Fatal(e)
	}
	if p.stats().Creates != 2 {
		t.Fatal("failed master reused")
	}
}

func TestGL3PoolCanceledQueryInvalidates(t *testing.T) {
	r := newGL3PoolMockRun()
	entered := make(chan struct{})
	query := containers.NewPromise[[]byte](nil)
	r.onProof = func(uint64) containers.PromiseInterface[[]byte] { close(entered); return &query }
	s := &gl3PoolMockSpawner{factory: func(int) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](r, nil)
	}}
	p := gl3Pool(t, s, 1, time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		data, e := p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0)
		if data != nil {
			t.Error("partial canceled result")
		}
		done <- e
	}()
	<-entered
	cancel()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if r.closes.Load() != 1 || p.stats().Invalidations != 1 || p.stats().Leases != 0 {
		t.Fatal(p.stats())
	}
	query.Produce([]byte{9}) // Late result cannot re-enter the detached cache.
	if p.stats().Entries != 0 {
		t.Fatal("late result restored invalid master")
	}
}

func TestGL3PoolWaitingCancellationRejectsActiveLateResult(t *testing.T) {
	r := newGL3PoolMockRun()
	entered := make(chan struct{})
	query := containers.NewPromise[[]byte](nil)
	r.onProof = func(uint64) containers.PromiseInterface[[]byte] { close(entered); return &query }
	s := &gl3PoolMockSpawner{factory: func(int) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](r, nil)
	}}
	p := gl3Pool(t, s, 1, time.Minute)
	firstCtx, firstCancel := gl3Ctx(t)
	defer firstCancel()
	secondCtx, secondCancel := context.WithCancel(context.Background())
	root := common.HexToHash("0x11")
	first := make(chan error, 1)
	second := make(chan error, 1)
	go func() {
		data, e := p.getProof(firstCtx, root, gl3PoolInput(), 0)
		if data != nil {
			t.Error("invalidated active result escaped")
		}
		first <- e
	}()
	<-entered
	go func() { _, e := p.getProof(secondCtx, root, gl3PoolInput(), 0); second <- e }()
	gl3Wait(t, func() bool { return p.stats().Leases == 2 })
	secondCancel()
	if e := <-second; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	query.Produce([]byte{9})
	if e := <-first; !errors.Is(e, context.Canceled) {
		t.Fatal("late success was accepted", e)
	}
	if r.closes.Load() != 1 || p.stats().Invalidations != 1 || p.stats().Leases != 0 {
		t.Fatal(p.stats())
	}
}

func TestGL3PoolBusyCapacityAndLeaseClose(t *testing.T) {
	r := newGL3PoolMockRun()
	entered := make(chan struct{})
	query := containers.NewPromise[[]byte](nil)
	r.onProof = func(uint64) containers.PromiseInterface[[]byte] { close(entered); return &query }
	s := &gl3PoolMockSpawner{factory: func(int) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](r, nil)
	}}
	p := gl3Pool(t, s, 1, time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, e := p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0); done <- e }()
	<-entered
	if _, e := p.getProof(context.Background(), common.HexToHash("0x22"), gl3PoolInput(), 0); !errors.Is(e, errExperimentalRunCacheCapacity) {
		t.Fatal("active entry was evicted", e)
	}
	if r.closes.Load() != 0 {
		t.Fatal("capacity miss closed active master")
	}
	cancel()
	<-done
	// A lease can be released twice without touching its master.
	s2 := &gl3PoolMockSpawner{}
	p2 := gl3Pool(t, s2, 1, time.Minute)
	c2, done2 := gl3Ctx(t)
	defer done2()
	lease, e := p2.acquire(c2, common.HexToHash("0x11"), gl3PoolInput())
	if e != nil {
		t.Fatal(e)
	}
	_, release, e := p2.queryMaster(c2, lease)
	if e != nil {
		t.Fatal(e)
	}
	release()
	lease.close()
	lease.close()
	s2.mu.Lock()
	master := s2.runs[0]
	s2.mu.Unlock()
	if p2.stats().Leases != 0 || master.closes.Load() != 0 {
		t.Fatal("lease close affected master")
	}
}

func TestGL3PoolPendingCreationBoundAndLateClose(t *testing.T) {
	var cancels atomic.Int64
	promise := containers.NewPromise[validator.ExecutionRun](func() { cancels.Add(1) })
	entered := make(chan struct{})
	s := &gl3PoolMockSpawner{factory: func(int) containers.PromiseInterface[validator.ExecutionRun] { close(entered); return &promise }}
	p := gl3Pool(t, s, 1, time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, e := p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0); done <- e }()
	<-entered
	cancel()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	gl3Wait(t, func() bool { return cancels.Load() > 0 })
	if _, e := p.getProof(context.Background(), common.HexToHash("0x22"), gl3PoolInput(), 0); !errors.Is(e, errExperimentalRunCacheCapacity) {
		t.Fatal("pending observer budget bypassed", e)
	}
	if p.stats().PendingCreations != 1 || p.stats().PeakPendingCreations != 1 || p.stats().Entries != 0 {
		t.Fatal(p.stats())
	}
	stopped := make(chan struct{})
	go func() { p.stop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stop waited on uncooperative creation")
	}
	r := newGL3PoolMockRun()
	promise.Produce(r)
	gl3Wait(t, func() bool { return p.stats().PendingCreations == 0 && r.closes.Load() == 1 })
	if p.stats().Closes != 1 || p.stats().Leases != 0 {
		t.Fatal(p.stats())
	}
}

func TestGL3PoolCreationErrorAndNilMaster(t *testing.T) {
	for _, want := range []error{errors.New("exact create error"), nil} {
		s := &gl3PoolMockSpawner{factory: func(int) containers.PromiseInterface[validator.ExecutionRun] {
			return containers.NewReadyPromise[validator.ExecutionRun](nil, want)
		}}
		p := gl3Pool(t, s, 1, time.Minute)
		ctx, cancel := gl3Ctx(t)
		_, e := p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0)
		cancel()
		if e == nil || want != nil && !errors.Is(e, want) {
			t.Fatal("create failure lost", e)
		}
		gl3Wait(t, func() bool { return p.stats().PendingCreations == 0 })
		if p.stats().Entries != 0 || p.stats().Leases != 0 {
			t.Fatal(p.stats())
		}
	}
}

func TestGL3PoolIdleAndCapacityEviction(t *testing.T) {
	t.Run("idle", func(t *testing.T) {
		s := &gl3PoolMockSpawner{}
		p := gl3Pool(t, s, 1, 15*time.Millisecond)
		ctx, cancel := gl3Ctx(t)
		defer cancel()
		if _, e := p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0); e != nil {
			t.Fatal(e)
		}
		gl3Wait(t, func() bool { return p.stats().Entries == 0 && p.stats().Closes == 1 })
		if _, e := p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0); e != nil {
			t.Fatal(e)
		}
		if p.stats().Creates != 2 || p.stats().Evictions < 1 {
			t.Fatal(p.stats())
		}
	})
	t.Run("capacity", func(t *testing.T) {
		s := &gl3PoolMockSpawner{}
		p := gl3Pool(t, s, 1, time.Minute)
		ctx, cancel := gl3Ctx(t)
		defer cancel()
		for _, root := range []common.Hash{common.HexToHash("0x11"), common.HexToHash("0x22"), common.HexToHash("0x11")} {
			if _, e := p.getProof(ctx, root, gl3PoolInput(), 0); e != nil {
				t.Fatal(e)
			}
		}
		if p.stats().Creates != 3 || p.stats().Closes != 2 || p.stats().Evictions != 2 {
			t.Fatal(p.stats())
		}
	})
}

func TestGL3PoolOwnerContextAndConfig(t *testing.T) {
	s := &gl3PoolMockSpawner{}
	for _, cfg := range []ExperimentalRunCacheConfig{{0, time.Minute}, {1, 0}} {
		if _, e := newExperimentalRunCache(context.Background(), s, cfg); e == nil {
			t.Fatal("invalid config accepted")
		}
	}
	owner, cancel := context.WithCancel(context.Background())
	p, e := newExperimentalRunCache(owner, s, ExperimentalRunCacheConfig{1, time.Minute})
	if e != nil {
		t.Fatal(e)
	}
	ctx, done := gl3Ctx(t)
	defer done()
	if _, e = p.getProof(ctx, common.HexToHash("0x11"), gl3PoolInput(), 0); e != nil {
		t.Fatal(e)
	}
	cancel()
	gl3Wait(t, func() bool { return p.stats().Entries == 0 && p.stats().Closes == 1 })
	p.stop()
}
