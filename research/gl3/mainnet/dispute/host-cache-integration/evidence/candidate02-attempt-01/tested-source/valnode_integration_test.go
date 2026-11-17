package valnode

// Independent actual ExecServer/RPC/client integration. Only the engine-facing
// spawner/run are bounded test doubles. No engine search or chain is launched.
import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/util/jsonapi"
	"github.com/offchainlabs/nitro/util/rpcclient"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/client"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/server_arb"
)

type gl3ServerRun struct {
	closeCalls atomic.Int64
	proofHook  func(context.Context) error
	healthErr  error
}

func (r *gl3ServerRun) Close()                           { r.closeCalls.Add(1) }
func (r *gl3ServerRun) CheckAlive(context.Context) error { return r.healthErr }
func (r *gl3ServerRun) GetStepAt(p uint64) containers.PromiseInterface[*validator.MachineStepResult] {
	return containers.NewReadyPromise(&validator.MachineStepResult{Position: p, Hash: common.Hash{byte(p)}, Status: validator.MachineStatus(0)}, nil)
}
func (r *gl3ServerRun) GetLastStep() containers.PromiseInterface[*validator.MachineStepResult] {
	return r.GetStepAt(31)
}
func (r *gl3ServerRun) GetProofAt(p uint64) containers.PromiseInterface[[]byte] {
	return containers.DoPromise(context.Background(), func(ctx context.Context) ([]byte, error) {
		if r.proofHook != nil {
			if err := r.proofHook(ctx); err != nil {
				return nil, err
			}
		}
		return []byte{byte(p), 22, 33}, nil
	})
}
func (r *gl3ServerRun) GetMachineHashesWithStepSize(start, stride, count uint64) containers.PromiseInterface[[]common.Hash] {
	if count > 32 {
		return containers.NewReadyPromise[[]common.Hash](nil, errors.New("bounded model limit"))
	}
	out := make([]common.Hash, count)
	for i := range out {
		out[i] = common.Hash{byte(start + uint64(i)*stride)}
	}
	return containers.NewReadyPromise(out, nil)
}
func (r *gl3ServerRun) PrepareRange(uint64, uint64) containers.PromiseInterface[struct{}] {
	return containers.NewReadyPromise(struct{}{}, nil)
}

type gl3ServerSpawner struct {
	calls   atomic.Int64
	factory func(int64) containers.PromiseInterface[validator.ExecutionRun]
}

func (s *gl3ServerSpawner) CreateExecutionRun(common.Hash, *validator.ValidationInput, bool) containers.PromiseInterface[validator.ExecutionRun] {
	return s.factory(s.calls.Add(1))
}
func (s *gl3ServerSpawner) Start(context.Context) error { return nil }
func (s *gl3ServerSpawner) Stop()                       {}
func (s *gl3ServerSpawner) Name() string                { return "independent bounded ExecServer fixture" }
func (s *gl3ServerSpawner) Capacity() int               { return 2 }
func (s *gl3ServerSpawner) StylusArchs() []rawdb.WasmTarget {
	return []rawdb.WasmTarget{rawdb.TargetWavm}
}
func (s *gl3ServerSpawner) WasmModuleRoots() ([]common.Hash, error) { return []common.Hash{{9}}, nil }
func (s *gl3ServerSpawner) Launch(*validator.ValidationInput, common.Hash) validator.ValidationRun {
	panic("full validation forbidden in bounded test")
}

var _ validator.ExecutionSpawner = (*gl3ServerSpawner)(nil)

func gl3Await(t *testing.T, description string, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !predicate() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !predicate() {
		t.Fatal(description)
	}
}
func gl3ExecServer(t *testing.T, spawner *gl3ServerSpawner, timeout time.Duration) *ExecServer {
	t.Helper()
	config := server_arb.DefaultArbitratorSpawnerConfig
	config.ExperimentalBoundExecutionCreations = true
	config.ExecutionRunTimeout = timeout
	server := NewExecServer(spawner, func() *server_arb.ArbitratorSpawnerConfig { return &config })
	server.Start(context.Background())
	t.Cleanup(server.StopAndWait)
	return server
}
func gl3Create(t *testing.T, server *ExecServer) uint64 {
	t.Helper()
	bold := true
	id, err := server.CreateExecutionRun(context.Background(), common.Hash{9}, &server_api.InputJSON{}, &bold)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestGL3IntegrationExecServerAdmissionBeforeDecodeAndClose(t *testing.T) {
	run := &gl3ServerRun{}
	spawner := &gl3ServerSpawner{factory: func(int64) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
	}}
	server := gl3ExecServer(t, spawner, time.Hour)
	id := gl3Create(t, server)
	stats := server.ExperimentalCreationStats()
	if !stats.Enabled || stats.Charged != 1 || stats.Registered != 1 {
		t.Fatal("registered run not charged", stats)
	}
	_, err := server.CreateExecutionRun(context.Background(), common.Hash{9}, &server_api.InputJSON{DelayedMsgB64: "invalid!"}, nil)
	if err == nil {
		t.Fatal("second creation admitted")
	}
	if spawner.calls.Load() != 1 || server.ExperimentalCreationStats().Rejected != 1 {
		t.Fatal("admission did not reject before decode/spawn", err, server.ExperimentalCreationStats())
	}
	server.CloseExec(id)
	server.CloseExec(id)
	gl3Await(t, "registered Close did not release gate", func() bool { return server.ExperimentalCreationStats().Charged == 0 })
	if run.closeCalls.Load() != 1 {
		t.Fatal("duplicate physical Close invocation", run.closeCalls.Load())
	}
	if _, err = server.CreateExecutionRun(context.Background(), common.Hash{9}, &server_api.InputJSON{DelayedMsgB64: "invalid!"}, nil); err == nil {
		t.Fatal("bad decode accepted")
	}
	if server.ExperimentalCreationStats().Charged != 0 || spawner.calls.Load() != 1 {
		t.Fatal("failed decode leaked gate")
	}
}

func TestGL3IntegrationExecServerCanceledLateCreationStaysCharged(t *testing.T) {
	late := containers.NewPromise[validator.ExecutionRun](nil)
	run := &gl3ServerRun{}
	next := &gl3ServerRun{}
	spawner := &gl3ServerSpawner{factory: func(n int64) containers.PromiseInterface[validator.ExecutionRun] {
		if n == 1 {
			return &late
		}
		return containers.NewReadyPromise[validator.ExecutionRun](next, nil)
	}}
	server := gl3ExecServer(t, spawner, time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	returned := make(chan error, 1)
	go func() {
		_, err := server.CreateExecutionRun(ctx, common.Hash{9}, &server_api.InputJSON{}, nil)
		returned <- err
	}()
	gl3Await(t, "factory did not start", func() bool { return spawner.calls.Load() == 1 })
	cancel()
	if err := <-returned; !errors.Is(err, context.Canceled) {
		t.Fatal("canceled request did not return cancellation", err)
	}
	stats := server.ExperimentalCreationStats()
	if stats.Charged != 1 || stats.Pending != 1 || stats.Registered != 0 {
		t.Fatal("late creation lost charge", stats)
	}
	if _, err := server.CreateExecutionRun(context.Background(), common.Hash{9}, &server_api.InputJSON{}, nil); err == nil || spawner.calls.Load() != 1 {
		t.Fatal("unresolved late allocation admitted another run", err)
	}
	late.Produce(run)
	gl3Await(t, "late master not closed and uncharged", func() bool { return server.ExperimentalCreationStats().Charged == 0 && run.closeCalls.Load() == 1 })
	if server.ExperimentalCreationStats().LateClosed != 1 {
		t.Fatal("late cleanup counter missing")
	}
	id := gl3Create(t, server)
	server.CloseExec(id)
	if next.closeCalls.Load() != 1 {
		t.Fatal("subsequent registered run did not close")
	}
}

func TestGL3IntegrationExecServerLostResponseIdleAndStopCleanup(t *testing.T) {
	for _, kind := range []string{"idle-expiry", "stop", "pending-stop"} {
		t.Run(kind, func(t *testing.T) {
			run := &gl3ServerRun{}
			late := containers.NewPromise[validator.ExecutionRun](nil)
			spawner := &gl3ServerSpawner{factory: func(int64) containers.PromiseInterface[validator.ExecutionRun] {
				if kind == "pending-stop" {
					return &late
				}
				return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
			}}
			timeout := time.Hour
			if kind == "idle-expiry" {
				timeout = 30 * time.Millisecond
			}
			server := gl3ExecServer(t, spawner, timeout)
			var returned chan error
			if kind == "pending-stop" {
				returned = make(chan error, 1)
				go func() {
					_, err := server.CreateExecutionRun(context.Background(), common.Hash{9}, &server_api.InputJSON{}, nil)
					returned <- err
				}()
				gl3Await(t, "pending create did not start", func() bool { return spawner.calls.Load() == 1 })
			} else {
				_ = gl3Create(t, server)
			} // Ignore ID: emulate response lost after registration.
			if kind == "idle-expiry" {
				gl3Await(t, "unknown-ID registered run survived idle expiry", func() bool { return server.ExperimentalCreationStats().Charged == 0 && run.closeCalls.Load() == 1 })
				return
			}
			stopped := make(chan struct{})
			go func() { server.StopAndWait(); close(stopped) }()
			select {
			case <-stopped:
			case <-time.After(2 * time.Second):
				t.Fatal("Stop blocked on uncooperative pending creation")
			}
			if kind == "pending-stop" {
				select {
				case err := <-returned:
					if err == nil {
						t.Fatal("stopped pending call succeeded")
					}
				case <-time.After(2 * time.Second):
					t.Fatal("server Stop did not cancel pending creation")
				}
				late.Produce(run)
			}
			gl3Await(t, "Stop did not close known/late master", func() bool { return server.ExperimentalCreationStats().Charged == 0 && run.closeCalls.Load() == 1 })
		})
	}
}

func gl3RPCClient(t *testing.T, spawner *gl3ServerSpawner) (*client.BOLDExecutionClient, *ExecServer) {
	t.Helper()
	server := gl3ExecServer(t, spawner, time.Hour)
	rpcServer := rpc.NewServer()
	if err := rpcServer.RegisterName(server_api.Namespace, NewExecServerAPI(spawner, server)); err != nil {
		t.Fatal(err)
	}
	http := httptest.NewServer(rpcServer)
	t.Cleanup(http.Close)
	t.Cleanup(rpcServer.Stop)
	config := rpcclient.DefaultClientConfig
	config.URL = http.URL
	config.Timeout = 30 * time.Second
	config.Retries = 0
	remote := client.NewExecutionClient(func() *rpcclient.ClientConfig { return &config }, nil)
	if err := remote.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(remote.Stop)
	bold := client.NewBOLDExecutionClient(remote)
	if err := bold.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := bold.EnableExperimentalRunCache(client.ExperimentalRunCacheConfig{MaxEntries: 1, IdleTimeout: time.Hour}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(bold.Stop)
	return bold, server
}

func TestGL3IntegrationActualRPCSharedBorrowerCancellation(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	var first atomic.Bool
	first.Store(true)
	run := &gl3ServerRun{proofHook: func(ctx context.Context) error {
		if first.Swap(false) {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}}
	defer once.Do(func() { close(release) })
	spawner := &gl3ServerSpawner{factory: func(int64) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
	}}
	bold, server := gl3RPCClient(t, spawner)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	input := &validator.ValidationInput{Id: 77}
	active := make(chan error, 1)
	go func() { _, err := bold.GetProofAt(ctx, common.Hash{9}, input, 3); active <- err }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("actual RPC query never entered")
	}
	queuedCtx, cancelQueued := context.WithCancel(ctx)
	queued := make(chan error, 1)
	go func() { _, err := bold.GetProofAt(queuedCtx, common.Hash{9}, input, 4); queued <- err }()
	gl3Await(t, "second RPC borrower not queued", func() bool { return bold.ExperimentalRunCacheStats().Leases == 2 })
	cancelQueued()
	if err := <-queued; !errors.Is(err, context.Canceled) {
		t.Fatal("queued cancellation not returned", err)
	}
	once.Do(func() { close(release) })
	if err := <-active; err != nil {
		t.Fatal("queued borrower poisoned actual RPC master", err)
	}
	proof, err := bold.GetProofAt(ctx, common.Hash{9}, input, 5)
	if err != nil || len(proof) != 3 || proof[0] != 5 {
		t.Fatal("retained actual RPC master not reusable", err)
	}
	if spawner.calls.Load() != 1 || server.ExperimentalCreationStats().Charged != 1 {
		t.Fatal("actual RPC run duplicated", spawner.calls.Load(), server.ExperimentalCreationStats())
	}
	bold.Stop()
	gl3Await(t, "remote CloseExec not observed", func() bool { return server.ExperimentalCreationStats().Charged == 0 && run.closeCalls.Load() == 1 })
}

func TestGL3IntegrationActualRPCHealthFailureClosesMaster(t *testing.T) {
	entered := make(chan struct{})
	var once sync.Once
	run := &gl3ServerRun{healthErr: errors.New("injected actual RPC health failure"), proofHook: func(ctx context.Context) error { once.Do(func() { close(entered) }); <-ctx.Done(); return ctx.Err() }}
	spawner := &gl3ServerSpawner{factory: func(int64) containers.PromiseInterface[validator.ExecutionRun] {
		return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
	}}
	bold, server := gl3RPCClient(t, spawner)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	started := time.Now()
	_, err := bold.GetProofAt(ctx, common.Hash{9}, &validator.ValidationInput{Id: 88}, 3)
	if err == nil {
		t.Fatal("health-failed query succeeded")
	}
	if time.Since(started) >= 18*time.Second {
		t.Fatal("new pool did not preserve legacy10s health cancellation", err)
	}
	select {
	case <-entered:
	default:
		t.Fatal("test never started actual RPC query")
	}
	gl3Await(t, "health failure did not close remote registered master", func() bool { return server.ExperimentalCreationStats().Charged == 0 && run.closeCalls.Load() == 1 })
}

func TestGL3IntegrationExecServerNullDecodeCannotLeakAdmission(t *testing.T) {
	for _, kind := range []string{"null-input", "null-preimage-group"} {
		t.Run(kind, func(t *testing.T) {
			run := &gl3ServerRun{}
			spawner := &gl3ServerSpawner{factory: func(int64) containers.PromiseInterface[validator.ExecutionRun] {
				return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
			}}
			server := gl3ExecServer(t, spawner, time.Hour)
			var input *server_api.InputJSON
			if kind == "null-preimage-group" {
				input = &server_api.InputJSON{PreimagesB64: map[arbutil.PreimageType]*jsonapi.PreimagesMapJson{0: nil}}
			}
			var panicked any
			var err error
			func() {
				defer func() { panicked = recover() }()
				_, err = server.CreateExecutionRun(context.Background(), common.Hash{9}, input, nil)
			}()
			if panicked != nil {
				t.Errorf("malformed nullable decoded input caused panic: %v", panicked)
			}
			if err == nil {
				t.Errorf("malformed nullable decoded input did not return error")
			}
			if stats := server.ExperimentalCreationStats(); stats.Charged != 0 || stats.Pending != 0 || spawner.calls.Load() != 0 {
				t.Errorf("malformed input retained admission or spawned work: %+v calls=%d", stats, spawner.calls.Load())
			}
		})
	}
}
