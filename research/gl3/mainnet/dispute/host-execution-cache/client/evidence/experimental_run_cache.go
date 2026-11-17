// SPDX-License-Identifier: GPL-3.0-or-later
package client

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/hostcacheidentity"
)

type ExperimentalRunCacheConfig struct {
	MaxEntries  int
	IdleTimeout time.Duration
}

// Closes counts exactly-once Close invocations, not remote close acknowledgments.
// PendingCreations includes canceled creations until their promise resolves;
// it therefore also bounds late-result observers after stop.
type ExperimentalRunCacheStats struct {
	Creates              uint64
	Hits                 uint64
	Closes               uint64
	Invalidations        uint64
	Evictions            uint64
	Entries              int
	Leases               int
	PendingCreations     int
	PeakPendingCreations int
}

var errExperimentalRunCacheStopped = errors.New("experimental execution cache stopped")
var errExperimentalRunCacheCapacity = errors.New("experimental execution cache capacity busy")

type experimentalRunEntry struct {
	key          hostcacheidentity.Key
	ready        chan struct{}
	readyClosed  bool
	master       validator.ExecutionRun
	err          error
	removed      bool
	invalidated  bool
	refs         int
	lastUsed     time.Time
	querySlot    chan struct{}
	createCtx    context.Context
	createCancel context.CancelFunc
	closeOnce    sync.Once
}

type experimentalRunCache struct {
	ctx           context.Context
	cancel        context.CancelFunc
	spawner       validator.ExecutionSpawner
	config        ExperimentalRunCacheConfig
	mu            sync.Mutex
	entries       map[hostcacheidentity.Key]*experimentalRunEntry
	stopped       bool
	counters      ExperimentalRunCacheStats
	creationSlots chan struct{}
	keySlot       chan struct{}
}

func newExperimentalRunCache(ownerCtx context.Context, spawner validator.ExecutionSpawner, cfg ExperimentalRunCacheConfig) (*experimentalRunCache, error) {
	if ownerCtx == nil || spawner == nil {
		return nil, errors.New("execution cache owner context and spawner required")
	}
	if cfg.MaxEntries <= 0 || cfg.IdleTimeout <= 0 {
		return nil, errors.New("execution cache requires positive capacity and idle timeout")
	}
	if err := ownerCtx.Err(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(ownerCtx)
	p := &experimentalRunCache{ctx: ctx, cancel: cancel, spawner: spawner, config: cfg, entries: make(map[hostcacheidentity.Key]*experimentalRunEntry), creationSlots: make(chan struct{}, cfg.MaxEntries), keySlot: make(chan struct{}, 1)}
	go p.sweepLoop()
	return p, nil
}

func (p *experimentalRunCache) stats() ExperimentalRunCacheStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := p.counters
	s.Entries = len(p.entries)
	return s
}

func (p *experimentalRunCache) sweepLoop() {
	interval := p.config.IdleTimeout / 2
	if interval < time.Millisecond {
		interval = time.Millisecond
	}
	if interval > time.Minute {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-p.ctx.Done():
			p.stop()
			return
		case now := <-ticker.C:
			p.evictIdle(now)
		}
	}
}

func (p *experimentalRunCache) closeMaster(e *experimentalRunEntry, run validator.ExecutionRun) {
	if run == nil {
		return
	}
	e.closeOnce.Do(func() { p.mu.Lock(); p.counters.Closes++; p.mu.Unlock(); run.Close() })
}
func (p *experimentalRunCache) finishReadyLocked(e *experimentalRunEntry) {
	if !e.readyClosed {
		e.readyClosed = true
		close(e.ready)
	}
}
func (p *experimentalRunCache) detachLocked(e *experimentalRunEntry, reason error, invalidate bool) validator.ExecutionRun {
	if invalidate && !e.invalidated {
		e.invalidated = true
		p.counters.Invalidations++
	}
	if !e.removed {
		e.removed = true
		e.err = reason
		e.createCancel()
		if p.entries[e.key] == e {
			delete(p.entries, e.key)
		}
		p.finishReadyLocked(e)
	}
	run := e.master
	e.master = nil
	return run
}

func (p *experimentalRunCache) invalidate(e *experimentalRunEntry, reason error) {
	p.mu.Lock()
	run := p.detachLocked(e, reason, true)
	p.mu.Unlock()
	p.closeMaster(e, run)
}

func (p *experimentalRunCache) evictIdle(now time.Time) {
	type closing struct {
		e *experimentalRunEntry
		r validator.ExecutionRun
	}
	var closes []closing
	p.mu.Lock()
	for _, e := range p.entries {
		if e.refs == 0 && e.master != nil && now.Sub(e.lastUsed) >= p.config.IdleTimeout {
			p.counters.Evictions++
			closes = append(closes, closing{e, p.detachLocked(e, errors.New("execution cache idle eviction"), false)})
		}
	}
	p.mu.Unlock()
	for _, v := range closes {
		p.closeMaster(v.e, v.r)
	}
}

// stop is idempotent and never waits for a creation promise. A canceled promise
// that ignores cancellation retains its charged slot and one observer until it
// becomes ready. Actual ExecutionClientRun.Close initiates nonblocking closure;
// arbitrary implementations with a blocking Close violate this required contract.
func (p *experimentalRunCache) stop() {
	type closing struct {
		e *experimentalRunEntry
		r validator.ExecutionRun
	}
	var closes []closing
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return
	}
	p.stopped = true
	p.cancel()
	for _, e := range p.entries {
		closes = append(closes, closing{e, p.detachLocked(e, errExperimentalRunCacheStopped, false)})
	}
	p.mu.Unlock()
	for _, v := range closes {
		p.closeMaster(v.e, v.r)
	}
}

type experimentalRunLease struct {
	pool  *experimentalRunCache
	entry *experimentalRunEntry
	once  sync.Once
}

func (l *experimentalRunLease) close() {
	l.once.Do(func() {
		p, e := l.pool, l.entry
		p.mu.Lock()
		e.refs--
		p.counters.Leases--
		if e.refs == 0 {
			e.lastUsed = time.Now()
		}
		p.mu.Unlock()
	})
}

func (p *experimentalRunCache) acquire(ctx context.Context, root common.Hash, input *validator.ValidationInput) (*experimentalRunLease, error) {
	if ctx == nil {
		return nil, errors.New("query context required")
	}
	if root == (common.Hash{}) {
		return nil, errors.New("resolved nonzero module root required before execution cache lookup")
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.ctx.Done():
		return nil, errExperimentalRunCacheStopped
	case p.keySlot <- struct{}{}:
	}
	if err := ctx.Err(); err != nil {
		<-p.keySlot
		return nil, err
	}
	if p.ctx.Err() != nil {
		<-p.keySlot
		return nil, errExperimentalRunCacheStopped
	}
	// Clone before keying: neither the generic caller's maps nor its byte slices
	// may become mutable aliases of a retained execution. One clone at a time
	// bounds transient snapshot work; callers must synchronize their own input.
	owned, key, err := hostcacheidentity.CloneAndKey(root, input, true)
	<-p.keySlot
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if p.ctx.Err() != nil {
		return nil, errExperimentalRunCacheStopped
	}
	var evictedEntry *experimentalRunEntry
	var evictedRun validator.ExecutionRun
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return nil, errExperimentalRunCacheStopped
	}
	if existing := p.entries[key]; existing != nil && !existing.removed {
		// Enforce expiry at lookup too; the periodic sweeper is not the authority.
		if existing.refs == 0 && existing.master != nil && time.Since(existing.lastUsed) >= p.config.IdleTimeout {
			p.counters.Evictions++
			evictedEntry = existing
			evictedRun = p.detachLocked(existing, errors.New("execution cache idle eviction"), false)
		} else {
			existing.refs++
			p.counters.Leases++
			p.counters.Hits++
			p.mu.Unlock()
			return &experimentalRunLease{pool: p, entry: existing}, nil
		}
	}
	if len(p.entries) >= p.config.MaxEntries {
		var oldest *experimentalRunEntry
		for _, candidate := range p.entries {
			if candidate.refs == 0 && candidate.master != nil && (oldest == nil || candidate.lastUsed.Before(oldest.lastUsed)) {
				oldest = candidate
			}
		}
		if oldest == nil {
			p.mu.Unlock()
			p.closeMaster(evictedEntry, evictedRun)
			return nil, errExperimentalRunCacheCapacity
		}
		p.counters.Evictions++
		evictedEntry = oldest
		evictedRun = p.detachLocked(oldest, errors.New("execution cache capacity eviction"), false)
	}
	select {
	case p.creationSlots <- struct{}{}:
	default:
		p.mu.Unlock()
		p.closeMaster(evictedEntry, evictedRun)
		return nil, errExperimentalRunCacheCapacity
	}
	createCtx, createCancel := context.WithCancel(p.ctx)
	e := &experimentalRunEntry{key: key, ready: make(chan struct{}), refs: 1, lastUsed: time.Now(), querySlot: make(chan struct{}, 1), createCtx: createCtx, createCancel: createCancel}
	p.entries[key] = e
	p.counters.Leases++
	p.counters.PendingCreations++
	if p.counters.PendingCreations > p.counters.PeakPendingCreations {
		p.counters.PeakPendingCreations = p.counters.PendingCreations
	}
	p.mu.Unlock()
	p.closeMaster(evictedEntry, evictedRun)
	go p.create(e, owned)
	return &experimentalRunLease{pool: p, entry: e}, nil
}

func (p *experimentalRunCache) create(e *experimentalRunEntry, input *validator.ValidationInput) {
	defer func() { p.mu.Lock(); p.counters.PendingCreations--; p.mu.Unlock(); <-p.creationSlots }()
	if err := e.createCtx.Err(); err != nil {
		p.invalidate(e, err)
		return
	}
	p.mu.Lock()
	p.counters.Creates++
	p.mu.Unlock()
	promise := p.spawner.CreateExecutionRun(e.key.ModuleRoot, input, e.key.UseBoldMachine)
	if promise == nil {
		p.invalidate(e, errors.New("execution spawner returned nil promise"))
		return
	}
	select {
	case <-e.createCtx.Done():
		promise.Cancel()
		// Entry cancellation is already published by invalidate/stop. Keep one
		// charged observer so an arbitrarily late master cannot be orphaned.
		<-promise.ReadyChan()
	case <-promise.ReadyChan():
	}
	run, err := promise.Current()
	if err != nil || run == nil {
		if err == nil {
			err = errors.New("execution spawner returned nil master")
		}
		p.invalidate(e, err)
		p.closeMaster(e, run)
		return
	}
	p.mu.Lock()
	if e.removed || p.stopped || e.createCtx.Err() != nil {
		p.mu.Unlock()
		p.closeMaster(e, run)
		return
	}
	e.master = run
	p.finishReadyLocked(e)
	p.mu.Unlock()
}

func (p *experimentalRunCache) completedQueryError(ctx context.Context, e *experimentalRunEntry) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if p.ctx.Err() != nil {
		return errExperimentalRunCacheStopped
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if e.removed {
		if e.err != nil {
			return e.err
		}
		return errors.New("execution cache entry invalidated during query")
	}
	return nil
}

func (p *experimentalRunCache) queryMaster(ctx context.Context, l *experimentalRunLease) (validator.ExecutionRun, func(), error) {
	e := l.entry
	select {
	case <-ctx.Done():
		p.invalidate(e, ctx.Err())
		return nil, nil, ctx.Err()
	case <-p.ctx.Done():
		return nil, nil, errExperimentalRunCacheStopped
	case <-e.ready:
	}
	select {
	case <-ctx.Done():
		p.invalidate(e, ctx.Err())
		return nil, nil, ctx.Err()
	case <-p.ctx.Done():
		return nil, nil, errExperimentalRunCacheStopped
	case e.querySlot <- struct{}{}:
	}
	release := func() { <-e.querySlot }
	p.mu.Lock()
	run, err, removed, stopped := e.master, e.err, e.removed, p.stopped
	p.mu.Unlock()
	if stopped {
		release()
		return nil, nil, errExperimentalRunCacheStopped
	}
	if removed || err != nil || run == nil {
		release()
		if err == nil {
			err = errors.New("execution cache entry unavailable")
		}
		return nil, nil, err
	}
	if err = ctx.Err(); err != nil {
		release()
		p.invalidate(e, err)
		return nil, nil, err
	}
	return run, release, nil
}

func (p *experimentalRunCache) getMachineHashes(ctx context.Context, root common.Hash, input *validator.ValidationInput, start, stride, count uint64) ([]common.Hash, error) {
	l, err := p.acquire(ctx, root, input)
	if err != nil {
		return nil, err
	}
	defer l.close()
	run, release, err := p.queryMaster(ctx, l)
	if err != nil {
		return nil, err
	}
	defer release()
	queryCtx, cancel := context.WithCancel(ctx)
	stopOwner := context.AfterFunc(p.ctx, cancel)
	defer func() { stopOwner(); cancel() }()
	promise := run.GetMachineHashesWithStepSize(start, stride, count)
	if promise == nil {
		err = errors.New("execution query returned nil promise")
		p.invalidate(l.entry, err)
		return nil, err
	}
	result, err := promise.Await(queryCtx)
	if err == nil {
		err = p.completedQueryError(queryCtx, l.entry)
	}
	if err != nil {
		promise.Cancel()
		p.invalidate(l.entry, err)
		return nil, err
	}
	if result == nil {
		return nil, nil
	}
	copied := make([]common.Hash, len(result))
	copy(copied, result)
	return copied, nil
}

func (p *experimentalRunCache) getProof(ctx context.Context, root common.Hash, input *validator.ValidationInput, pos uint64) ([]byte, error) {
	l, err := p.acquire(ctx, root, input)
	if err != nil {
		return nil, err
	}
	defer l.close()
	run, release, err := p.queryMaster(ctx, l)
	if err != nil {
		return nil, err
	}
	defer release()
	queryCtx, cancel := context.WithCancel(ctx)
	stopOwner := context.AfterFunc(p.ctx, cancel)
	defer func() { stopOwner(); cancel() }()
	promise := run.GetProofAt(pos)
	if promise == nil {
		err = errors.New("execution query returned nil promise")
		p.invalidate(l.entry, err)
		return nil, err
	}
	result, err := promise.Await(queryCtx)
	if err == nil {
		err = p.completedQueryError(queryCtx, l.entry)
	}
	if err != nil {
		promise.Cancel()
		p.invalidate(l.entry, err)
		return nil, err
	}
	if result == nil {
		return nil, nil
	}
	copied := make([]byte, len(result))
	copy(copied, result)
	return copied, nil
}
