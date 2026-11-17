package valnode

// Private, constructor-time opt-in only. A charged slot remains owned through
// late creation or registered-run Close invocation. It is not an acknowledgment
// that asynchronous native destruction has physically finished.
import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/server_arb"
)

type ExperimentalCreationStats struct {
	Enabled                                      bool
	Charged, Pending, Registered, PeakCharged    uint64
	Rejected, CanceledBeforeRegister, LateClosed uint64
}

type experimentalCreationGate struct {
	slot  chan struct{}
	mu    sync.Mutex
	stats ExperimentalCreationStats
}

type experimentalCreationLease struct {
	gate       *experimentalCreationGate
	once       sync.Once
	registered bool // protected by gate.mu
}

func newExperimentalCreationGate() *experimentalCreationGate {
	return &experimentalCreationGate{slot: make(chan struct{}, 1), stats: ExperimentalCreationStats{Enabled: true}}
}

func (g *experimentalCreationGate) acquire(ctx context.Context) (*experimentalCreationLease, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case g.slot <- struct{}{}:
	default:
		g.mu.Lock()
		g.stats.Rejected++
		g.mu.Unlock()
		return nil, errors.New("experimental execution server capacity busy")
	}
	g.mu.Lock()
	g.stats.Charged++
	g.stats.Pending++
	if g.stats.Charged > g.stats.PeakCharged {
		g.stats.PeakCharged = g.stats.Charged
	}
	g.mu.Unlock()
	l := &experimentalCreationLease{gate: g}
	if err := ctx.Err(); err != nil {
		l.release()
		return nil, err
	}
	return l, nil
}

func (l *experimentalCreationLease) register() {
	g := l.gate
	g.mu.Lock()
	defer g.mu.Unlock()
	l.registered = true
	g.stats.Pending--
	g.stats.Registered++
}

func (l *experimentalCreationLease) release() {
	l.once.Do(func() {
		g := l.gate
		g.mu.Lock()
		g.stats.Charged--
		if l.registered {
			g.stats.Registered--
		} else {
			g.stats.Pending--
		}
		g.mu.Unlock()
		<-g.slot
	})
}

type experimentalOwnedRun struct {
	validator.ExecutionRun
	lease *experimentalCreationLease
	once  sync.Once
}

func (r *experimentalOwnedRun) Close() {
	r.once.Do(func() { defer r.lease.release(); r.ExecutionRun.Close() })
}

func (s *ExecServer) ExperimentalCreationStats() ExperimentalCreationStats {
	if s.experimentalCreation == nil {
		return ExperimentalCreationStats{}
	}
	g := s.experimentalCreation
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.stats
}

func (s *ExecServer) createExperimentalExecutionRun(ctx context.Context, root common.Hash, jsonInput *server_api.InputJSON, useBoldOptional *bool) (uint64, error) {
	if ctx == nil {
		return 0, errors.New("execution request context required")
	}
	serverContext, contextErr := s.GetContextSafe()
	if contextErr != nil {
		return 0, contextErr
	}
	operationCtx, cancel := context.WithCancel(ctx)
	stopOwner := context.AfterFunc(serverContext, cancel)
	defer func() { stopOwner(); cancel() }()
	lease, err := s.experimentalCreation.acquire(operationCtx)
	if err != nil {
		return 0, err
	}
	input, err := server_api.ValidationInputFromJson(jsonInput)
	if err != nil {
		lease.release()
		return 0, err
	}
	if err = operationCtx.Err(); err != nil {
		lease.release()
		return 0, err
	}
	useBold := false
	if useBoldOptional != nil {
		useBold = *useBoldOptional
	}
	promise := s.execSpawner.CreateExecutionRun(root, input, useBold)
	if promise == nil {
		lease.release()
		return 0, errors.New("execution spawner returned nil creation promise")
	}
	run, err := promise.Await(operationCtx)
	if err != nil {
		if operationCtx.Err() != nil {
			g := s.experimentalCreation
			g.mu.Lock()
			g.stats.CanceledBeforeRegister++
			g.mu.Unlock()
		}
		promise.Cancel()
		// At most one such observer can exist: its slot stays charged even if
		// the promise ignores cancellation or the server has stopped.
		go func() {
			defer lease.release()
			<-promise.ReadyChan()
			late, _ := promise.Current()
			if late != nil {
				late.Close()
				g := s.experimentalCreation
				g.mu.Lock()
				g.stats.LateClosed++
				g.mu.Unlock()
			}
		}()
		return 0, err
	}
	if run == nil {
		lease.release()
		return 0, errors.New("execution spawner returned nil execution run")
	}
	s.runIdLock.Lock()
	if err = operationCtx.Err(); err != nil || s.Stopped() {
		s.runIdLock.Unlock()
		if err != nil {
			g := s.experimentalCreation
			g.mu.Lock()
			g.stats.CanceledBeforeRegister++
			g.mu.Unlock()
		}
		run.Close()
		lease.release()
		if err == nil {
			err = errors.New("ExecServer is stopped")
		}
		return 0, err
	}
	lease.register()
	owned := &experimentalOwnedRun{ExecutionRun: run, lease: lease}
	id := s.nextId
	s.nextId++
	s.runs[id] = &execRunEntry{run: owned, accessed: time.Now()}
	s.runIdLock.Unlock()
	return id, nil
}

// Read-only Go diagnostics; neither this node nor ExecServer is the registered
// RPC service (ExecServerAPI is). No remote setter or new RPC method is added.
type ExperimentalExecutionStats struct {
	RunID uint64
	Cache server_arb.ExperimentalMachineCacheStats
}
type ExperimentalHostCacheStats struct {
	Creation   ExperimentalCreationStats
	Executions []ExperimentalExecutionStats
}

func (n *ValidationNode) ExperimentalHostCacheStats() ExperimentalHostCacheStats {
	if n == nil || n.execServer == nil {
		return ExperimentalHostCacheStats{}
	}
	return n.execServer.ExperimentalHostCacheStats()
}
func (s *ExecServer) ExperimentalHostCacheStats() ExperimentalHostCacheStats {
	out := ExperimentalHostCacheStats{Creation: s.ExperimentalCreationStats()}
	s.runIdLock.Lock()
	defer s.runIdLock.Unlock()
	for id, entry := range s.runs {
		run := entry.run
		if owned, ok := run.(*experimentalOwnedRun); ok {
			run = owned.ExecutionRun
		}
		if native, ok := run.(interface {
			ExperimentalStats() server_arb.ExperimentalMachineCacheStats
		}); ok {
			out.Executions = append(out.Executions, ExperimentalExecutionStats{RunID: id, Cache: native.ExperimentalStats()})
		}
	}
	return out
}
