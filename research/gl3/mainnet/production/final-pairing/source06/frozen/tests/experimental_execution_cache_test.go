package staker

import (
	"context"
	"errors"
	"net/http/httptest"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/spf13/pflag"

	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/util/rpcclient"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/client"
	"github.com/offchainlabs/nitro/validator/client/redis"
)

type gl3OperatorExec struct {
	validator.ExecutionSpawner
	name        string
	events      *[]string
	startErr    error
	uploadErr   error
	rootErr     error
	roots       []common.Hash
	uploads     int
	onStart     func()
	creates     atomic.Int64
	startedFlag atomic.Bool
	stoppedFlag atomic.Bool
	run         *gl3OperatorRun
}

func (s *gl3OperatorExec) Start(context.Context) error {
	*s.events = append(*s.events, s.name+".start")
	if s.onStart != nil {
		s.onStart()
	}
	if s.startErr == nil {
		s.startedFlag.Store(true)
	}
	return s.startErr
}
func (s *gl3OperatorExec) EnableValidationUploadAdmission() error { s.uploads++; return s.uploadErr }
func (s *gl3OperatorExec) WasmModuleRoots() ([]common.Hash, error) {
	if s.roots != nil {
		return s.roots, s.rootErr
	}
	return []common.Hash{{9}}, s.rootErr
}
func (s *gl3OperatorExec) Started() bool { return s.startedFlag.Load() }
func (s *gl3OperatorExec) Stopped() bool { return s.stoppedFlag.Load() }
func (s *gl3OperatorExec) Stop() {
	s.stoppedFlag.Store(true)
	*s.events = append(*s.events, s.name+".stop")
}
func (s *gl3OperatorExec) StylusArchs() []rawdb.WasmTarget {
	return []rawdb.WasmTarget{rawdb.TargetWavm}
}
func (s *gl3OperatorExec) CreateExecutionRun(common.Hash, *validator.ValidationInput, bool) containers.PromiseInterface[validator.ExecutionRun] {
	s.creates.Add(1)
	return containers.NewReadyPromise[validator.ExecutionRun](s.run, nil)
}

type gl3OperatorBOLD struct {
	validator.BOLDExecutionSpawner
	name                string
	events              *[]string
	startErr, enableErr error
	config              client.ExperimentalRunCacheConfig
	ctx                 context.Context
}

func (s *gl3OperatorBOLD) Start(ctx context.Context) error {
	s.ctx = ctx
	*s.events = append(*s.events, s.name+".start")
	return s.startErr
}
func (s *gl3OperatorBOLD) Stop() { *s.events = append(*s.events, s.name+".stop") }
func (s *gl3OperatorBOLD) EnableExperimentalRunCache(c client.ExperimentalRunCacheConfig) error {
	s.config = c
	*s.events = append(*s.events, s.name+".enable")
	return s.enableErr
}

type gl3UnsupportedBOLD struct{ validator.BOLDExecutionSpawner }
type gl3OperatorRun struct {
	validator.ExecutionRun
	closes atomic.Int64
}

func (r *gl3OperatorRun) CheckAlive(context.Context) error { return nil }
func (r *gl3OperatorRun) GetProofAt(uint64) containers.PromiseInterface[[]byte] {
	return containers.NewReadyPromise([]byte{1, 2, 3}, nil)
}
func (r *gl3OperatorRun) Close() { r.closes.Add(1) }

func gl3OperatorValidator() (*StatelessBlockValidator, *[]string, []*gl3OperatorExec, []*gl3OperatorBOLD) {
	events := []string{}
	config := DefaultBlockValidatorConfig
	config.CurrentModuleRoot = (common.Hash{9}).Hex()
	config.ExperimentalBOLDExecutionCache = DefaultExperimentalBOLDExecutionCacheConfig
	config.ExperimentalBOLDExecutionCache.Enable = true
	v := &StatelessBlockValidator{config: &config, latestWasmModuleRoot: common.Hash{9}}
	var execs []*gl3OperatorExec
	var bolds []*gl3OperatorBOLD
	for _, name := range []string{"0", "1"} {
		x := &gl3OperatorExec{name: "exec" + name, events: &events}
		y := &gl3OperatorBOLD{name: "bold" + name, events: &events}
		execs = append(execs, x)
		bolds = append(bolds, y)
		v.execSpawners = append(v.execSpawners, x)
		v.boldExecSpawners = append(v.boldExecSpawners, y)
	}
	return v, &events, execs, bolds
}

func TestGL3OperatorConfigDefaultsAndFlags(t *testing.T) {
	if DefaultBlockValidatorConfig.ExperimentalBOLDExecutionCache.Enable {
		t.Fatal("default enabled")
	}
	f := pflag.NewFlagSet("operator", pflag.ContinueOnError)
	ExperimentalBOLDExecutionCacheConfigAddOptions("node.block-validator.experimental-bold-execution-cache", f)
	enabled, _ := f.GetBool("node.block-validator.experimental-bold-execution-cache.enable")
	max, _ := f.GetInt("node.block-validator.experimental-bold-execution-cache.max-entries")
	ttl, _ := f.GetDuration("node.block-validator.experimental-bold-execution-cache.idle-timeout")
	if enabled || max != 1 || ttl != 4*time.Hour {
		t.Fatal("flag defaults drift", enabled, max, ttl)
	}
	if err := f.Parse([]string{"--node.block-validator.experimental-bold-execution-cache.enable", "--node.block-validator.experimental-bold-execution-cache.idle-timeout=2h"}); err != nil {
		t.Fatal(err)
	}
	enabled, _ = f.GetBool("node.block-validator.experimental-bold-execution-cache.enable")
	ttl, _ = f.GetDuration("node.block-validator.experimental-bold-execution-cache.idle-timeout")
	if !enabled || ttl != 2*time.Hour {
		t.Fatal("operator flags failed")
	}
	for _, test := range []struct {
		name string
		c    ExperimentalBOLDExecutionCacheConfig
		ok   bool
	}{
		{"off", ExperimentalBOLDExecutionCacheConfig{}, true},
		{"reviewed", ExperimentalBOLDExecutionCacheConfig{true, 1, time.Minute}, true},
		{"zero entries", ExperimentalBOLDExecutionCacheConfig{true, 0, time.Minute}, false},
		{"negative entries", ExperimentalBOLDExecutionCacheConfig{true, -1, time.Minute}, false},
		{"multiple entries", ExperimentalBOLDExecutionCacheConfig{true, 2, time.Minute}, false},
		{"zero TTL", ExperimentalBOLDExecutionCacheConfig{true, 1, 0}, false},
		{"negative TTL", ExperimentalBOLDExecutionCacheConfig{true, 1, -1}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if (test.c.Validate() == nil) != test.ok {
				t.Fatal(test.c)
			}
		})
	}
}

func TestGL3OperatorDisabledPreservesLegacyStart(t *testing.T) {
	v, events, _, _ := gl3OperatorValidator()
	v.config.ExperimentalBOLDExecutionCache = ExperimentalBOLDExecutionCacheConfig{}
	v.latestWasmModuleRoot = common.Hash{}
	if err := v.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(*events, []string{"exec0.start", "exec1.start", "bold0.start", "bold1.start"}) {
		t.Fatal(*events)
	}
	v.Stop()
	if !reflect.DeepEqual((*events)[4:], []string{"exec0.stop", "exec1.stop", "bold0.stop", "bold1.stop"}) {
		t.Fatal("legacy stop order changed", *events)
	}
}

func TestGL3OperatorEnabledStartOrder(t *testing.T) {
	v, events, _, bolds := gl3OperatorValidator()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := v.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(*events, []string{"exec0.start", "exec1.start", "bold0.start", "bold0.enable", "bold1.start", "bold1.enable"}) {
		t.Fatal(*events)
	}
	for _, b := range bolds {
		if b.ctx != ctx || b.config.MaxEntries != 1 || b.config.IdleTimeout != 4*time.Hour {
			t.Fatal("config/context changed", b.config)
		}
	}
	if !reflect.DeepEqual(v.wasmTargets, []rawdb.WasmTarget{rawdb.TargetWavm}) {
		t.Fatal(v.wasmTargets)
	}
	v.Stop()
}

func TestGL3OperatorPreflightFailureStartsNothing(t *testing.T) {
	for _, name := range []string{"root zero", "max entries", "TTL", "no clients", "mismatch", "unsupported", "typed nil bold", "typed nil exec", "Redis"} {
		t.Run(name, func(t *testing.T) {
			v, events, _, _ := gl3OperatorValidator()
			switch name {
			case "root zero":
				v.config.CurrentModuleRoot = (common.Hash{}).Hex()
			case "max entries":
				v.config.ExperimentalBOLDExecutionCache.MaxEntries = 2
			case "TTL":
				v.config.ExperimentalBOLDExecutionCache.IdleTimeout = 0
			case "no clients":
				v.execSpawners = nil
				v.boldExecSpawners = nil
			case "mismatch":
				v.boldExecSpawners = v.boldExecSpawners[:1]
			case "unsupported":
				v.boldExecSpawners[0] = &gl3UnsupportedBOLD{}
			case "typed nil bold":
				v.boldExecSpawners[0] = (*gl3OperatorBOLD)(nil)
			case "typed nil exec":
				v.execSpawners[0] = (*gl3OperatorExec)(nil)
			case "Redis":
				v.redisValidator = &redis.ValidationClient{}
			}
			if err := v.Start(context.Background()); err == nil {
				t.Fatal("invalid startup accepted")
			}
			if len(*events) != 0 {
				t.Fatal("work started before preflight", *events)
			}
		})
	}
}

func TestGL3OperatorStartupFailureRollback(t *testing.T) {
	want := errors.New("injected startup failure")
	for _, name := range []string{"exec0", "exec1", "bold0", "bold1", "enable0", "enable1"} {
		t.Run(name, func(t *testing.T) {
			v, events, execs, bolds := gl3OperatorValidator()
			var expected []string
			switch name {
			case "exec0":
				execs[0].startErr = want
				expected = []string{"exec0.start", "exec0.stop"}
			case "exec1":
				execs[1].startErr = want
				expected = []string{"exec0.start", "exec1.start", "exec1.stop", "exec0.stop"}
			case "bold0":
				bolds[0].startErr = want
				expected = []string{"exec0.start", "exec1.start", "bold0.start", "bold0.stop", "exec1.stop", "exec0.stop"}
			case "bold1":
				bolds[1].startErr = want
				expected = []string{"exec0.start", "exec1.start", "bold0.start", "bold0.enable", "bold1.start", "bold1.stop", "bold0.stop", "exec1.stop", "exec0.stop"}
			case "enable0":
				bolds[0].enableErr = want
				expected = []string{"exec0.start", "exec1.start", "bold0.start", "bold0.enable", "bold0.stop", "exec1.stop", "exec0.stop"}
			case "enable1":
				bolds[1].enableErr = want
				expected = []string{"exec0.start", "exec1.start", "bold0.start", "bold0.enable", "bold1.start", "bold1.enable", "bold1.stop", "bold0.stop", "exec1.stop", "exec0.stop"}
			}
			if err := v.Start(context.Background()); !errors.Is(err, want) {
				t.Fatal("lost cause", err)
			}
			if !reflect.DeepEqual(*events, expected) {
				t.Fatal("bad rollback", *events, expected)
			}
		})
	}
}

func TestGL3OperatorCanceledStartup(t *testing.T) {
	v, events, execs, _ := gl3OperatorValidator()
	ctx, cancel := context.WithCancel(context.Background())
	execs[0].onStart = cancel
	if err := v.Start(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(*events, []string{"exec0.start", "exec0.stop"}) {
		t.Fatal(*events)
	}
}

func TestGL3OperatorRealBOLDClientIsEnabledAfterStart(t *testing.T) {
	events := []string{}
	run := &gl3OperatorRun{}
	exec := &gl3OperatorExec{name: "exec", events: &events, run: run}
	bold := client.NewBOLDExecutionClient(exec)
	config := DefaultBlockValidatorConfig
	config.CurrentModuleRoot = (common.Hash{9}).Hex()
	config.ExperimentalBOLDExecutionCache = DefaultExperimentalBOLDExecutionCacheConfig
	config.ExperimentalBOLDExecutionCache.Enable = true
	v := &StatelessBlockValidator{config: &config, latestWasmModuleRoot: common.Hash{9}, execSpawners: []validator.ExecutionSpawner{exec}, boldExecSpawners: []validator.BOLDExecutionSpawner{bold}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := v.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer v.Stop()
	if bold.ExperimentalRunCacheStats().Creates != 0 {
		t.Fatal("startup launched native work")
	}
	for i := 0; i < 2; i++ {
		data, err := bold.GetProofAt(ctx, common.Hash{9}, &validator.ValidationInput{Id: 3}, 7)
		if err != nil || !reflect.DeepEqual(data, []byte{1, 2, 3}) {
			t.Fatal(data, err)
		}
	}
	if exec.creates.Load() != 1 || bold.ExperimentalRunCacheStats().Hits != 1 {
		t.Fatal("operator hook failed to retain run", bold.ExperimentalRunCacheStats())
	}
	v.Stop()
	v.Stop()
	if run.closes.Load() != 1 {
		t.Fatal("known mock master Close invocation", run.closes.Load())
	}
}

// The actual reviewed client opens RPC transport before checking server name.
// This handshake failure used to escape the successful-start-only rollback.
type gl3EmptyNameAPI struct{}

func (*gl3EmptyNameAPI) Name() string { return "" }
func TestGL3OperatorActualRPCPartialStartIsStopped(t *testing.T) {
	server := rpc.NewServer()
	if err := server.RegisterName("validation", &gl3EmptyNameAPI{}); err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	defer server.Stop()
	conf := rpcclient.DefaultClientConfig
	conf.URL = httpServer.URL
	conf.Timeout = time.Second
	conf.Retries = 0
	exec := client.NewExecutionClient(func() *rpcclient.ClientConfig { return &conf }, nil)
	bold := client.NewBOLDExecutionClient(exec)
	config := DefaultBlockValidatorConfig
	config.CurrentModuleRoot = (common.Hash{9}).Hex()
	config.ExperimentalBOLDExecutionCache = DefaultExperimentalBOLDExecutionCacheConfig
	config.ExperimentalBOLDExecutionCache.Enable = true
	v := &StatelessBlockValidator{config: &config, latestWasmModuleRoot: common.Hash{9}, execSpawners: []validator.ExecutionSpawner{exec}, boldExecSpawners: []validator.BOLDExecutionSpawner{bold}}
	if err := v.Start(context.Background()); err == nil {
		t.Fatal("empty-name handshake unexpectedly succeeded")
	}
	if !exec.Stopped() {
		exec.Stop()
		t.Fatal("failed RPC Start attempt was not stopped")
	}
	if exec.Started() {
		t.Fatal("invalid handshake became a started client")
	}
	if bold.ExperimentalRunCacheStats().Creates != 0 {
		t.Fatal("failed startup admitted native execution")
	}
}

func TestGL3OperatorSharedExecutionIsNotStopped(t *testing.T) {
	for _, state := range []string{"started", "stopped"} {
		t.Run(state, func(t *testing.T) {
			v, events, execs, _ := gl3OperatorValidator()
			if state == "started" {
				execs[0].startedFlag.Store(true)
			} else {
				execs[0].stoppedFlag.Store(true)
			}
			if err := v.Start(context.Background()); err == nil {
				t.Fatal("preowned client accepted")
			}
			if len(*events) != 0 {
				t.Fatal("preflight touched shared resources", *events)
			}
			if state == "started" && execs[0].Stopped() {
				t.Fatal("shared owner was stopped")
			}
		})
	}
}
func TestGL3OperatorConcurrentSecondStartDoesNotStopOwner(t *testing.T) {
	v, events, execs, _ := gl3OperatorValidator()
	entered, release := make(chan struct{}), make(chan struct{})
	execs[0].onStart = func() { close(entered); <-release }
	var wg sync.WaitGroup
	results := make(chan error, 2)
	wg.Add(1)
	go func() { defer wg.Done(); results <- v.Start(context.Background()) }()
	<-entered
	wg.Add(1)
	go func() { defer wg.Done(); results <- v.Start(context.Background()) }()
	close(release)
	wg.Wait()
	close(results)
	successes, failures := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			failures++
		}
	}
	if successes != 1 || failures != 1 {
		t.Fatal("startup admission", successes, failures)
	}
	if len(*events) != 6 || execs[0].Stopped() {
		t.Fatal("concurrent retry disturbed owner", *events)
	}
	if err := v.Start(context.Background()); err == nil {
		t.Fatal("repeated Start accepted")
	}
	v.Stop()
}

func TestGL3OperatorExactModuleSupport(t *testing.T) {
	for _, name := range []string{"empty", "missing", "error", "valid non-latest"} {
		t.Run(name, func(t *testing.T) {
			v, events, execs, _ := gl3OperatorValidator()
			switch name {
			case "empty":
				execs[1].roots = []common.Hash{}
			case "missing":
				execs[1].roots = []common.Hash{{8}}
			case "error":
				execs[1].rootErr = errors.New("module transport failure")
			case "valid non-latest":
				v.latestWasmModuleRoot = common.Hash{7}
			}
			err := v.Start(context.Background())
			if name == "valid non-latest" {
				if err != nil {
					t.Fatal(err)
				}
				if execs[0].uploads != 1 || execs[1].uploads != 1 {
					t.Fatal("not all clients opted in")
				}
				v.Stop()
				return
			}
			if err == nil {
				t.Fatal("unsupported client accepted")
			}
			if !reflect.DeepEqual(*events, []string{"exec0.start", "exec1.start", "exec1.stop", "exec0.stop"}) {
				t.Fatal(*events)
			}
		})
	}
}
func TestGL3OperatorExplicitRootRequired(t *testing.T) {
	for _, root := range []string{"latest", "current", "0x01", "0x" + string(make([]byte, 64)), (common.Hash{}).Hex()} {
		t.Run(root, func(t *testing.T) {
			v, events, _, _ := gl3OperatorValidator()
			v.config.CurrentModuleRoot = root
			if err := v.Start(context.Background()); err == nil {
				t.Fatal("invalid root accepted")
			}
			if len(*events) != 0 {
				t.Fatal(*events)
			}
		})
	}
}
func TestGL3OperatorColdOptionFailurePreservesOwner(t *testing.T) {
	v, events, execs, _ := gl3OperatorValidator()
	execs[1].uploadErr = errors.New("already owned")
	if err := v.Start(context.Background()); err == nil {
		t.Fatal("failed option accepted")
	}
	if !reflect.DeepEqual(*events, []string{"exec0.start", "exec0.stop"}) || execs[1].Stopped() {
		t.Fatal("stopped unowned failing option client", *events)
	}
}
