package client

// Independent bounded ExecutionSpawner model. Its opaque results deliberately
// depend on the captured input bytes, exposing a stale-key/mutable-input alias.
// It is not a chess engine, actual machine proof or performance measurement.
import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/daprovider"
	"github.com/offchainlabs/nitro/util/containers"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/hostcacheidentity"
)

type integrationSpawner struct {
	mu        sync.Mutex
	latest    common.Hash
	runs      []*integrationClientRun
	calls     int
	failNext  bool
	proofHook func(context.Context) error
}
type integrationClientRun struct {
	root       common.Hash
	input      *validator.ValidationInput
	bold       bool
	closed     atomic.Bool
	closeCalls atomic.Int64
	proofHook  func(context.Context) error
}

func (s *integrationSpawner) Start(context.Context) error { return nil }
func (s *integrationSpawner) Stop()                       {}
func (s *integrationSpawner) Name() string                { return "bounded independent client integration model" }
func (s *integrationSpawner) Capacity() int               { return 1 }
func (s *integrationSpawner) StylusArchs() []rawdb.WasmTarget {
	return []rawdb.WasmTarget{rawdb.TargetWavm}
}
func (s *integrationSpawner) Launch(*validator.ValidationInput, common.Hash) validator.ValidationRun {
	panic("unexpected full validation launch in integration model")
}
func (s *integrationSpawner) WasmModuleRoots() ([]common.Hash, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return []common.Hash{s.latest}, nil
}
func (s *integrationSpawner) CreateExecutionRun(root common.Hash, input *validator.ValidationInput, bold bool) containers.PromiseInterface[validator.ExecutionRun] {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.failNext {
		s.failNext = false
		return containers.NewReadyPromise[validator.ExecutionRun](nil, errors.New("injected factory failure"))
	}
	if root == (common.Hash{}) {
		root = s.latest
	}
	run := &integrationClientRun{root: root, input: input, bold: bold, proofHook: s.proofHook}
	s.runs = append(s.runs, run)
	return containers.NewReadyPromise[validator.ExecutionRun](run, nil)
}
func (r *integrationClientRun) hash(position uint64) (common.Hash, error) {
	if r.closed.Load() {
		return common.Hash{}, errors.New("model run closed")
	}
	digest, err := hostcacheidentity.Digest(r.input)
	if err != nil {
		return common.Hash{}, err
	}
	data := append([]byte("GL3_CLIENT_INTERFACE_MODEL_NOT_SELECTED_ENGINE"), r.root[:]...)
	data = append(data, digest[:]...)
	if r.bold {
		data = append(data, 1)
	} else {
		data = append(data, 0)
	}
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], position)
	data = append(data, b[:]...)
	return common.Hash(sha256.Sum256(data)), nil
}
func (r *integrationClientRun) GetStepAt(position uint64) containers.PromiseInterface[*validator.MachineStepResult] {
	if position > 31 {
		position = 31
	}
	h, err := r.hash(position)
	if err != nil {
		return containers.NewReadyPromise[*validator.MachineStepResult](nil, err)
	}
	status := validator.MachineStatus(0)
	if position == 31 {
		status = validator.MachineStatus(1)
	}
	return containers.NewReadyPromise(&validator.MachineStepResult{Position: position, Hash: h, Status: status, GlobalState: r.input.StartState}, nil)
}
func (r *integrationClientRun) GetLastStep() containers.PromiseInterface[*validator.MachineStepResult] {
	return r.GetStepAt(31)
}
func (r *integrationClientRun) GetProofAt(position uint64) containers.PromiseInterface[[]byte] {
	if r.proofHook != nil {
		return containers.DoPromise(context.Background(), func(ctx context.Context) ([]byte, error) {
			if err := r.proofHook(ctx); err != nil {
				return nil, err
			}
			h, err := r.hash(position)
			return append([]byte("OPAQUE_CLIENT_MODEL_PROOF"), h[:]...), err
		})
	}
	if position > 31 {
		position = 31
	}
	h, err := r.hash(position)
	if err != nil {
		return containers.NewReadyPromise[[]byte](nil, err)
	}
	return containers.NewReadyPromise(append([]byte("OPAQUE_CLIENT_MODEL_PROOF"), h[:]...), nil)
}
func (r *integrationClientRun) GetMachineHashesWithStepSize(start, stride, count uint64) containers.PromiseInterface[[]common.Hash] {
	if stride == 0 || count == 0 || count > 128 {
		return containers.NewReadyPromise[[]common.Hash](nil, errors.New("bounded model query rejected"))
	}
	position := start
	if position > 31 {
		position = 31
	}
	hash, err := r.hash(position)
	if err != nil {
		return containers.NewReadyPromise[[]common.Hash](nil, err)
	}
	rows := []common.Hash{hash}
	for uint64(len(rows)) < count {
		if stride > 31-position {
			position = 31
		} else {
			position += stride
		}
		hash, err = r.hash(position)
		if err != nil {
			return containers.NewReadyPromise[[]common.Hash](nil, err)
		}
		rows = append(rows, hash)
		if position == 31 {
			break
		}
	}
	return containers.NewReadyPromise(rows, nil)
}
func (r *integrationClientRun) PrepareRange(start, end uint64) containers.PromiseInterface[struct{}] {
	if start > end || end > 31 {
		return containers.NewReadyPromise(struct{}{}, errors.New("invalid bounded model range"))
	}
	return containers.NewReadyPromise(struct{}{}, r.CheckAlive(context.Background()))
}
func (r *integrationClientRun) CheckAlive(context.Context) error {
	if r.closed.Load() {
		return errors.New("model run closed")
	}
	return nil
}
func (r *integrationClientRun) Close() { r.closeCalls.Add(1); r.closed.Store(true) }

var _ validator.ExecutionSpawner = (*integrationSpawner)(nil)

func integrationInput(reverse bool) *validator.ValidationInput {
	a, b := common.Hash{1}, common.Hash{2}
	pre := map[common.Hash][]byte{}
	wasm := map[common.Hash][]byte{}
	if reverse {
		pre[b] = []byte{20, 21}
		pre[a] = []byte{10, 11}
		wasm[b] = []byte{40, 41}
		wasm[a] = []byte{30, 31}
	} else {
		pre[a] = []byte{10, 11}
		pre[b] = []byte{20, 21}
		wasm[a] = []byte{30, 31}
		wasm[b] = []byte{40, 41}
	}
	return &validator.ValidationInput{Id: 7, HasDelayedMsg: true, DelayedMsgNr: 3, Preimages: daprovider.PreimagesMap{arbutil.PreimageType(0): pre}, UserWasms: map[rawdb.WasmTarget]map[common.Hash][]byte{rawdb.TargetWavm: wasm}, BatchInfo: []validator.BatchInfo{{Number: 5, Data: []byte{50, 51}}, {Number: 6, Data: []byte{60, 61}}}, DelayedMsg: []byte{70, 71}, StartState: validator.GoGlobalState{BlockHash: common.Hash{3}, SendRoot: common.Hash{4}, Batch: 5, PosInBatch: 6}, DebugChain: false}
}
func integrationCachedClient(t *testing.T, s *integrationSpawner, entries int, idle time.Duration) *BOLDExecutionClient {
	t.Helper()
	client := NewBOLDExecutionClient(s)
	if err := client.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := client.EnableExperimentalRunCache(ExperimentalRunCacheConfig{MaxEntries: entries, IdleTimeout: idle}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Stop)
	return client
}

func TestGL3IntegrationClientCanonicalSeparationAndOwnership(t *testing.T) {
	s := &integrationSpawner{latest: common.Hash{9}}
	c := integrationCachedClient(t, s, 16, time.Hour)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	root := common.Hash{9}
	original := integrationInput(false)
	first, err := c.GetMachineHashesWithStepSize(ctx, root, original, 0, 1, 4)
	if err != nil {
		t.Fatal(err)
	}
	if s.calls != 1 {
		t.Fatal("initial factory count")
	}
	again, err := c.GetMachineHashesWithStepSize(ctx, root, integrationInput(true), 0, 1, 4)
	if err != nil || again[1] != first[1] || s.calls != 1 {
		t.Fatal("equivalent ordered maps failed reuse", err, s.calls)
	}
	original.Preimages[arbutil.PreimageType(0)][common.Hash{1}][0] ^= 1
	owned, err := c.GetMachineHashesWithStepSize(ctx, root, integrationInput(false), 0, 1, 4)
	if err != nil || owned[1] != first[1] || s.calls != 1 {
		t.Fatal("caller mutation changed previously owned execution", err, s.calls)
	}
	cases := map[string]func(*validator.ValidationInput){"id": func(x *validator.ValidationInput) { x.Id++ }, "start-state": func(x *validator.ValidationInput) { x.StartState.Batch++ }, "debug": func(x *validator.ValidationInput) { x.DebugChain = true }, "preimage-bytes": func(x *validator.ValidationInput) { x.Preimages[arbutil.PreimageType(0)][common.Hash{1}][0] ^= 1 }, "wasm-bytes": func(x *validator.ValidationInput) { x.UserWasms[rawdb.TargetWavm][common.Hash{1}][0] ^= 1 }, "batch-data": func(x *validator.ValidationInput) { x.BatchInfo[0].Data[0] ^= 1 }, "delayed-bytes": func(x *validator.ValidationInput) { x.DelayedMsg[0] ^= 1 }}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			input := integrationInput(false)
			change(input)
			before := s.calls
			value, err := c.GetMachineHashesWithStepSize(ctx, root, input, 0, 1, 4)
			if err != nil || s.calls != before+1 || value[1] == first[1] {
				t.Fatal("different canonical execution reused", err, s.calls, before)
			}
		})
	}
	before := s.calls
	if _, err = c.GetProofAt(ctx, common.Hash{8}, integrationInput(false), 3); err != nil || s.calls != before+1 {
		t.Fatal("module root failed separation", err)
	}
}

func TestGL3IntegrationClientFactoryFailureAndFinalClose(t *testing.T) {
	s := &integrationSpawner{latest: common.Hash{9}, failNext: true}
	c := integrationCachedClient(t, s, 2, time.Hour)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := c.GetProofAt(ctx, s.latest, integrationInput(false), 3); err == nil {
		t.Fatal("factory error became success")
	}
	if _, err := c.GetProofAt(ctx, s.latest, integrationInput(false), 3); err != nil {
		t.Fatal("failed factory poisoned retry", err)
	}
	if len(s.runs) != 1 || s.runs[0].closeCalls.Load() != 0 {
		t.Fatal("borrower closed retained run")
	}
	c.Stop()
	c.Stop()
	if s.runs[0].closeCalls.Load() != 1 {
		t.Fatal("underlying final close count", s.runs[0].closeCalls.Load())
	}
}

func TestGL3IntegrationClientUnresolvedRootCannotSpanUpgrade(t *testing.T) {
	s := &integrationSpawner{latest: common.Hash{9}}
	c := integrationCachedClient(t, s, 4, time.Hour)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	first, err := c.GetProofAt(ctx, common.Hash{}, integrationInput(false), 3)
	if err != nil {
		if s.calls != 0 {
			t.Fatal("unresolved root rejected after starting an unkeyed run")
		}
		return
	} // Explicit-root-only policy is safe.
	s.mu.Lock()
	s.latest = common.Hash{8}
	s.mu.Unlock()
	second, err := c.GetProofAt(ctx, common.Hash{}, integrationInput(false), 3)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) == string(second) || s.calls != 2 {
		t.Fatal("zero/default root reused across upgrade", s.calls)
	}
}

func TestGL3IntegrationClientQueuedCancelAndCapacity(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var first atomic.Bool
	first.Store(true)
	var once sync.Once
	s := &integrationSpawner{latest: common.Hash{9}, proofHook: func(ctx context.Context) error {
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
	c := integrationCachedClient(t, s, 1, time.Hour)
	defer once.Do(func() { close(release) })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	active := make(chan error, 1)
	go func() { _, err := c.GetProofAt(ctx, s.latest, integrationInput(false), 3); active <- err }()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("active query did not start")
	}
	changed := integrationInput(false)
	changed.Id++
	if _, err := c.GetProofAt(ctx, s.latest, changed, 3); err == nil {
		t.Fatal("active max-entry bound bypassed")
	}
	queuedCtx, cancelQueued := context.WithCancel(ctx)
	queued := make(chan error, 1)
	go func() { _, err := c.GetProofAt(queuedCtx, s.latest, integrationInput(false), 4); queued <- err }()
	deadline := time.Now().Add(time.Second)
	for c.ExperimentalRunCacheStats().Leases < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if c.ExperimentalRunCacheStats().Leases < 2 {
		t.Fatal("second borrower never queued")
	}
	cancelQueued()
	if err := <-queued; !errors.Is(err, context.Canceled) {
		t.Fatal("queued cancellation not returned", err)
	}
	if c.ExperimentalRunCacheStats().Invalidations != 0 {
		t.Fatal("queued borrower invalidated active master")
	}
	once.Do(func() { close(release) })
	if err := <-active; err != nil {
		t.Fatal("queued cancellation poisoned active result", err)
	}
	if _, err := c.GetProofAt(ctx, s.latest, integrationInput(false), 5); err != nil {
		t.Fatal("master not reusable", err)
	}
	s.mu.Lock()
	calls := s.calls
	s.mu.Unlock()
	if calls != 1 {
		t.Fatal("queued cancellation forced repeated creation", calls)
	}
	c.Stop()
	if stats := c.ExperimentalRunCacheStats(); stats.Entries != 0 || stats.Leases != 0 {
		t.Fatal("stop left logical owners", stats)
	}
}

func TestGL3IntegrationClientIdleEvictionClosesKnownMaster(t *testing.T) {
	s := &integrationSpawner{latest: common.Hash{9}}
	c := integrationCachedClient(t, s, 2, 30*time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := c.GetProofAt(ctx, s.latest, integrationInput(false), 3); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for c.ExperimentalRunCacheStats().Entries != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if c.ExperimentalRunCacheStats().Entries != 0 {
		t.Fatal("idle logical entry not evicted")
	}
	s.mu.Lock()
	run := s.runs[0]
	s.mu.Unlock()
	if run.closeCalls.Load() != 1 {
		t.Fatal("idle eviction failed exactly-once Close invocation", run.closeCalls.Load())
	}
	if _, err := c.GetProofAt(ctx, s.latest, integrationInput(false), 3); err != nil {
		t.Fatal("expired key could not recreate", err)
	}
	s.mu.Lock()
	calls := s.calls
	s.mu.Unlock()
	if calls != 2 {
		t.Fatal("expired key stale reused", calls)
	}
}
