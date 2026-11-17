//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/log"
	"github.com/ethereum/go-ethereum/node"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/gorilla/websocket"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/util/rpcclient"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/server_arb"
	"github.com/offchainlabs/nitro/validator/server_common"
	"github.com/offchainlabs/nitro/validator/valnode"
)

const gl3TransportRoot = "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086"
const gl3OriginalInputSHA = "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90"
const gl3PrivateRequestCap int64 = 3 * 1024 * 1024 * 1024

func gl3PayloadMethod(method string) bool {
	switch method {
	case "validation_createExecutionRun", "validation_validate", "validation_writeToFile":
		return true
	}
	return false
}

// Attributes stay lazy until Handle. In particular, WithAttrs must not delegate
// raw bound attributes to a formatter before the method is known.
type gl3PayloadFilter struct {
	next   slog.Handler
	attrs  []slog.Attr
	groups []string
}

func (h *gl3PayloadFilter) Enabled(ctx context.Context, l slog.Level) bool {
	return h.next.Enabled(ctx, l)
}
func (h *gl3PayloadFilter) WithAttrs(a []slog.Attr) slog.Handler {
	c := *h
	c.attrs = append(append([]slog.Attr{}, h.attrs...), a...)
	return &c
}
func (h *gl3PayloadFilter) WithGroup(g string) slog.Handler {
	c := *h
	c.groups = append(append([]string{}, h.groups...), g)
	return &c
}
func (h *gl3PayloadFilter) Handle(ctx context.Context, r slog.Record) error {
	a := append([]slog.Attr{}, h.attrs...)
	r.Attrs(func(v slog.Attr) bool { a = append(a, v); return true })
	method := ""
	for _, v := range a {
		if v.Key == "method" && v.Value.Kind() == slog.KindString {
			method = v.Value.String()
		}
	}
	drop := gl3PayloadMethod(method) && (r.Message == "rpc response" || r.Message == "sending RPC request")
	out := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	for _, v := range a {
		if drop && (v.Key == "args" || v.Key == "result" || v.Key == "errorData") {
			continue
		}
		out.AddAttrs(v)
	}
	if drop {
		out.AddAttrs(slog.Bool("payloadOmitted", true))
	}
	next := h.next
	for _, g := range h.groups {
		next = next.WithGroup(g)
	}
	return next.Handle(ctx, out)
}

// This gate covers our controlled upload caller, from before typed conversion
// and serialization through response/error/cancellation. It is not endpoint-wide
// admission for an arbitrary client bypassing this helper.
type gl3UploadGate struct {
	slot   chan struct{}
	active atomic.Int64
	peak   atomic.Int64
}

func gl3NewUploadGate() *gl3UploadGate { return &gl3UploadGate{slot: make(chan struct{}, 1)} }
func (g *gl3UploadGate) do(ctx context.Context, f func() error) error {
	select {
	case g.slot <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	n := g.active.Add(1)
	for old := g.peak.Load(); n > old && !g.peak.CompareAndSwap(old, n); old = g.peak.Load() {
	}
	defer func() { g.active.Add(-1); <-g.slot }()
	if err := ctx.Err(); err != nil {
		return err
	}
	return f()
}

type gl3UnsafeLogValue struct{ calls *atomic.Int64 }

func (p gl3UnsafeLogValue) String() string { p.calls.Add(1); panic("payload String invoked") }
func (p gl3UnsafeLogValue) MarshalJSON() ([]byte, error) {
	p.calls.Add(1)
	panic("payload Marshal invoked")
}

func TestGL3PayloadLoggingAndAdmission(t *testing.T) {
	for _, method := range []string{"validation_createExecutionRun", "validation_validate", "validation_writeToFile"} {
		for _, msg := range []string{"rpc response", "sending RPC request"} {
			for _, bound := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/bound-%t", method, msg, bound), func(t *testing.T) {
					var output bytes.Buffer
					var calls atomic.Int64
					var h slog.Handler = &gl3PayloadFilter{next: slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: log.LevelTrace})}
					attrs := []slog.Attr{slog.String("method", method), slog.Any("args", gl3UnsafeLogValue{&calls}), slog.Any("result", gl3UnsafeLogValue{&calls}), slog.Any("errorData", gl3UnsafeLogValue{&calls})}
					r := slog.NewRecord(time.Now(), slog.LevelInfo, msg, 0)
					if bound {
						h = h.WithAttrs(attrs)
					} else {
						r.AddAttrs(attrs...)
					}
					r.AddAttrs(slog.String("err", "exact-short-test-error"), slog.Int("logId", 7), slog.Int("attempt", 0))
					Require(t, h.Handle(context.Background(), r))
					if calls.Load() != 0 || !strings.Contains(output.String(), "exact-short-test-error") || !strings.Contains(output.String(), `"payloadOmitted":true`) || output.Len() > 2048 {
						t.Fatal("unsafe or incomplete filter", calls.Load(), output.Len())
					}
				})
			}
		}
	}
	t.Run("admission-error-cancel-release", func(t *testing.T) {
		g := gl3NewUploadGate()
		entered, release := make(chan struct{}), make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := g.do(context.Background(), func() error { close(entered); <-release; return errors.New("expected") })
			if err == nil {
				t.Error("missing error")
			}
		}()
		<-entered
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if !errors.Is(g.do(ctx, func() error { t.Error("canceled call entered"); return nil }), context.Canceled) {
			t.Fatal("cancellation not returned")
		}
		close(release)
		wg.Wait()
		Require(t, g.do(context.Background(), func() error { return nil }))
		activeCtx, activeCancel := context.WithCancel(context.Background())
		activeEntered, activeDone := make(chan struct{}), make(chan error, 1)
		go func() {
			activeDone <- g.do(activeCtx, func() error { close(activeEntered); <-activeCtx.Done(); return activeCtx.Err() })
		}()
		<-activeEntered
		activeCancel()
		if !errors.Is(<-activeDone, context.Canceled) {
			t.Fatal("active cancellation was lost")
		}
		Require(t, g.do(context.Background(), func() error { return nil }))
		if g.active.Load() != 0 || g.peak.Load() != 1 {
			t.Fatal("admission not released or concurrent")
		}
	})
}

type gl3ReadLimitProbe struct{ calls atomic.Int64 }

func (p *gl3ReadLimitProbe) Echo(s string) int { p.calls.Add(1); return len(s) }
func TestGL3ValidationWSReadLimits(t *testing.T) {
	for _, tc := range []struct {
		name  string
		limit int64
		size  int
		want  bool
	}{
		{"default32MiB-rejects33MiB", 0, 33 * 1024 * 1024, false},
		{"explicit256-rejects512", 256, 512, false},
		{"explicit256-accepts64", 256, 64, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conf := node.DefaultConfig
			conf.DataDir = ""
			conf.HTTPHost = ""
			conf.WSHost = "127.0.0.1"
			conf.WSPort = 0
			conf.WSModules = []string{"gl3probe"}
			conf.WSReadLimit = tc.limit
			conf.P2P.NoDiscovery = true
			conf.P2P.ListenAddr = ""
			conf.P2P.MaxPeers = 0
			stack, e := node.New(&conf)
			Require(t, e)
			defer stack.Close()
			probe := &gl3ReadLimitProbe{}
			stack.RegisterAPIs([]rpc.API{{Namespace: "gl3probe", Service: probe, Public: true}})
			Require(t, stack.Start())
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			client, e := rpc.DialContext(ctx, stack.WSEndpoint())
			Require(t, e)
			defer client.Close()
			var result int
			err := client.CallContext(ctx, &result, "gl3probe_echo", strings.Repeat("x", tc.size))
			if tc.want {
				Require(t, err)
				if result != tc.size || probe.calls.Load() != 1 {
					t.Fatal("accepted probe mismatch")
				}
			} else if err == nil || probe.calls.Load() != 0 {
				t.Fatal("oversized request reached API")
			}
		})
	}
}

// This fingerprint covers every field of validator.ValidationInput. Variable
// bytes are streamed into SHA-256 with length/domain separators; maps are sorted.
func gl3TypedInputIdentity(in *validator.ValidationInput) (string, uint64, uint64) {
	h := sha256.New()
	put := func(b []byte) {
		var n [8]byte
		binary.BigEndian.PutUint64(n[:], uint64(len(b)))
		h.Write(n[:])
		h.Write(b)
	}
	header, _ := json.Marshal(struct {
		ID         uint64
		HasDelayed bool
		DelayedNr  uint64
		Start      validator.GoGlobalState
		Debug      bool
	}{in.Id, in.HasDelayedMsg, in.DelayedMsgNr, in.StartState, in.DebugChain})
	put([]byte("GL3_TYPED_VALIDATION_INPUT_V1"))
	put(header)
	var types []int
	for ty := range in.Preimages {
		types = append(types, int(ty))
	}
	sort.Ints(types)
	var count, total uint64
	for _, ty := range types {
		put([]byte(fmt.Sprintf("preimage-type:%d", ty)))
		var keys []common.Hash
		for k := range in.Preimages[arbutil.PreimageType(ty)] {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return bytes.Compare(keys[i][:], keys[j][:]) < 0 })
		for _, k := range keys {
			data := in.Preimages[arbutil.PreimageType(ty)][k]
			put(k[:])
			put(data)
			count++
			total += uint64(len(data))
		}
	}
	put([]byte("batches"))
	for _, v := range in.BatchInfo {
		put([]byte(fmt.Sprintf("batch:%d", v.Number)))
		put(v.Data)
	}
	put([]byte("delayed"))
	put(in.DelayedMsg)
	var targets []string
	for target := range in.UserWasms {
		targets = append(targets, string(target))
	}
	sort.Strings(targets)
	for _, target := range targets {
		put([]byte("wasm:" + target))
		var keys []common.Hash
		for k := range in.UserWasms[rawdb.WasmTarget(target)] {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return bytes.Compare(keys[i][:], keys[j][:]) < 0 })
		for _, k := range keys {
			put(k[:])
			put(in.UserWasms[rawdb.WasmTarget(target)][k])
		}
	}
	return hex.EncodeToString(h.Sum(nil)), count, total
}

type gl3StepZeroGuard struct {
	server_arb.MachineInterface
	init   chan map[string]any
	once   *sync.Once
	denied *atomic.Int64
}

func (m *gl3StepZeroGuard) CloneMachineInterface() server_arb.MachineInterface {
	return &gl3StepZeroGuard{m.MachineInterface.CloneMachineInterface(), m.init, m.once, m.denied}
}
func (m *gl3StepZeroGuard) Step(ctx context.Context, n uint64) error {
	m.denied.Add(1)
	return errors.New("GL3_PREFLIGHT_POSITIVE_STEPS_DISABLED")
}

type gl3AuditedTransportAPI struct {
	api      *valnode.ExecServerAPI
	expected string
	decoded  chan map[string]any
}

func (a *gl3AuditedTransportAPI) CreateExecutionRun(ctx context.Context, root common.Hash, input *server_api.InputJSON, bold *bool) (uint64, error) {
	typed, err := server_api.ValidationInputFromJson(input)
	if err != nil {
		return 0, err
	}
	digest, count, size := gl3TypedInputIdentity(typed)
	if digest != a.expected || root != common.HexToHash(gl3TransportRoot) || bold == nil || !*bold {
		return 0, errors.New("typed input identity/root/BoLD mismatch")
	}
	a.decoded <- map[string]any{"typedInputSHA256": digest, "preimageCount": count, "preimageBytes": size, "startState": typed.StartState, "batches": len(typed.BatchInfo), "inputID": typed.Id, "moduleRoot": root, "useBoldMachine": *bold, "everyTypedFieldMatches": true}
	return a.api.CreateExecutionRun(ctx, root, input, bold)
}
func (a *gl3AuditedTransportAPI) CloseExec(id uint64) { a.api.CloseExec(id) }
func (a *gl3AuditedTransportAPI) GetStepAt(ctx context.Context, id, position uint64) (*server_api.MachineStepResultJson, error) {
	return a.api.GetStepAt(ctx, id, position)
}

func gl3TransportWrite(t *testing.T, out, name string, v any) {
	t.Helper()
	b, e := json.MarshalIndent(v, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(out, name), append(b, '\n'), 0600))
}

type gl3CountWriter struct{ n int64 }

func (w *gl3CountWriter) Write(b []byte) (int, error) { w.n += int64(len(b)); return len(b), nil }

// The private proxy measures the actual complete JSON text message while
// forwarding in bounded chunks. It never buffers or parses the input payload.
func gl3MeasuredWSProxy(t *testing.T, backendURL string) (string, <-chan map[string]any, func()) {
	t.Helper()
	observed := make(chan map[string]any, 8)
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		incoming, e := upgrader.Upgrade(w, r, nil)
		if e != nil {
			return
		}
		defer incoming.Close()
		incoming.SetReadLimit(gl3PrivateRequestCap)
		backend, _, e := websocket.DefaultDialer.Dial(backendURL, nil)
		if e != nil {
			return
		}
		defer backend.Close()
		backend.SetReadLimit(256 * 1024 * 1024)
		go func() {
			defer incoming.Close()
			for {
				ty, reader, e := backend.NextReader()
				if e != nil {
					return
				}
				writer, e := incoming.NextWriter(ty)
				if e != nil {
					return
				}
				_, e = io.Copy(writer, reader)
				closeErr := writer.Close()
				if e != nil || closeErr != nil {
					return
				}
			}
		}()
		for {
			ty, reader, e := incoming.NextReader()
			if e != nil {
				return
			}
			writer, e := backend.NextWriter(ty)
			if e != nil {
				return
			}
			h := sha256.New()
			count := &gl3CountWriter{}
			_, e = io.Copy(io.MultiWriter(writer, h, count), reader)
			closeErr := writer.Close()
			if e != nil || closeErr != nil {
				return
			}
			observed <- map[string]any{"bytes": count.n, "SHA256": hex.EncodeToString(h.Sum(nil)), "complete": true, "boundedForwardBuffer": true}
		}
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http"), observed, server.Close
}

func TestGL3OriginalFullInputValidationTransport(t *testing.T) {
	inputPath, out, machines := os.Getenv("GL3_TRANSPORT_INPUT"), os.Getenv("GL3_TRANSPORT_EVIDENCE"), os.Getenv("GL3_TRANSPORT_MACHINES")
	if inputPath == "" || out == "" || machines == "" {
		t.Fatal("explicit original input/evidence/machines paths required")
	}
	Require(t, os.MkdirAll(out, 0700))
	logFile, e := os.OpenFile(filepath.Join(out, "rpc-metadata.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	Require(t, e)
	defer logFile.Close()
	previous := log.Root()
	log.SetDefault(log.NewLogger(&gl3PayloadFilter{next: slog.NewJSONHandler(logFile, &slog.HandlerOptions{Level: log.LevelTrace})}))
	defer log.SetDefault(previous)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	started := time.Now()
	f, e := os.Open(inputPath)
	Require(t, e)
	h := sha256.New()
	n, e := io.Copy(h, f)
	Require(t, e)
	if hex.EncodeToString(h.Sum(nil)) != gl3OriginalInputSHA {
		t.Fatal("original file hash mismatch")
	}
	_, e = f.Seek(0, 0)
	Require(t, e)
	var encoded server_api.InputJSON
	Require(t, json.NewDecoder(f).Decode(&encoded))
	Require(t, f.Close())
	typed, e := server_api.ValidationInputFromJson(&encoded)
	Require(t, e)
	expected, count, total := gl3TypedInputIdentity(typed)
	// Exact JSON-RPC encoding measurement uses the pinned client's envelope and
	// first request ID. This is not the saved artifact's hash.
	params, e := json.Marshal([]any{common.HexToHash(gl3TransportRoot), server_api.ValidationInputToJson(typed), true})
	Require(t, e)
	requestPrefix := []byte(`{"jsonrpc":"2.0","id":1,"method":"validation_createExecutionRun","params":`)
	requestBytes := int64(len(requestPrefix) + len(params) + 1)
	params = nil
	if requestBytes >= gl3PrivateRequestCap {
		t.Fatal("request does not fit explicit private cap")
	}
	gl3TransportWrite(t, out, "input-transport-manifest.json", map[string]any{"file": inputPath, "fileBytes": n, "fileSHA256": gl3OriginalInputSHA, "typedInputSHA256": expected, "preimageCount": count, "preimageBytes": total, "moduleRoot": gl3TransportRoot, "expectedSerializedRequestBytes": requestBytes, "wireMapOrderCanonical": false, "requestID": 1, "privateWSReadLimit": gl3PrivateRequestCap, "requestMarginBytes": gl3PrivateRequestCap - requestBytes, "clientTimeout": 0, "clientRetries": 0, "clientArgLogLimit": 2048, "runIdleEviction": "4h", "startState": typed.StartState, "onlyInitializationNoReplay": true})
	encoded = server_api.InputJSON{}
	runtime.GC()
	locator, e := server_common.NewMachineLocator(machines)
	Require(t, e)
	if locator.LatestWasmModuleRoot() != common.HexToHash(gl3TransportRoot) {
		t.Fatal("wrong selected machine locator")
	}
	conf := server_arb.DefaultArbitratorSpawnerConfig
	conf.Workers = 1
	conf.Execution.CachedChallengeMachines = 2
	conf.ExecutionRunTimeout = 4 * time.Hour
	fetch := func() *server_arb.ArbitratorSpawnerConfig { return &conf }
	init := make(chan map[string]any, 1)
	var once sync.Once
	var denied atomic.Int64
	spawner, e := server_arb.NewArbitratorSpawner(locator, fetch, server_arb.WithWrapper(func(m server_arb.MachineInterface) server_arb.MachineInterface {
		once.Do(func() {
			init <- map[string]any{"position": m.GetStepCount(), "hash": m.Hash(), "status": m.Status(), "globalState": m.GetGlobalState(), "realBackendInitialized": true, "positiveStepsPermitted": false}
		})
		return &gl3StepZeroGuard{m, init, &once, &denied}
	}))
	Require(t, e)
	Require(t, spawner.Start(ctx))
	defer spawner.Stop()
	exec := valnode.NewExecServer(spawner, fetch)
	exec.Start(ctx)
	defer exec.StopAndWait()
	audit := &gl3AuditedTransportAPI{valnode.NewExecServerAPI(spawner, exec), expected, make(chan map[string]any, 1)}
	stackConf := node.DefaultConfig
	stackConf.DataDir = ""
	stackConf.HTTPHost = ""
	stackConf.WSHost = "127.0.0.1"
	stackConf.WSPort = 0
	stackConf.WSModules = []string{"validation"}
	stackConf.WSReadLimit = gl3PrivateRequestCap
	stackConf.P2P.NoDiscovery = true
	stackConf.P2P.ListenAddr = ""
	stackConf.P2P.MaxPeers = 0
	stack, e := node.New(&stackConf)
	Require(t, e)
	defer stack.Close()
	stack.RegisterAPIs([]rpc.API{{Namespace: "validation", Version: "1.0", Service: audit, Public: true}})
	Require(t, stack.Start())
	proxyURL, wireObserved, closeProxy := gl3MeasuredWSProxy(t, stack.WSEndpoint())
	defer closeProxy()
	cfg := rpcclient.TestClientConfig
	cfg.URL = proxyURL
	cfg.ArgLogLimit = 2048
	cfg.Timeout = 0
	cfg.Retries = 0
	client := rpcclient.NewRpcClient(func() *rpcclient.ClientConfig { return &cfg }, nil)
	Require(t, client.Start(ctx))
	defer client.Close()
	gate := gl3NewUploadGate()
	var runID uint64
	uploadStarted := time.Now()
	Require(t, gate.do(ctx, func() error {
		return client.CallContext(ctx, &runID, "validation_createExecutionRun", common.HexToHash(gl3TransportRoot), server_api.ValidationInputToJson(typed), true)
	}))
	if runID == 0 {
		t.Fatal("zero run response")
	}
	var observed map[string]any
	select {
	case observed = <-wireObserved:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	gl3TransportWrite(t, out, "actual-wire-request.json", observed)
	if observed["bytes"].(int64) != requestBytes {
		t.Fatal("actual wire byte count differs from recorded exact encoding size")
	}
	var decoded, initial map[string]any
	select {
	case decoded = <-audit.decoded:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case initial = <-init:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if initial["position"].(uint64) != 0 {
		t.Fatal("initial machine is not step zero")
	}
	Require(t, client.CallContext(ctx, nil, "validation_closeExec", runID))
	var zero server_api.MachineStepResultJson
	err := client.CallContext(ctx, &zero, "validation_getStepAt", runID, uint64(0))
	if err == nil {
		t.Fatal("closed execution run remained accessible")
	}
	gl3TransportWrite(t, out, "transport-result.json", map[string]any{"passed": true, "validRunID": runID, "loopbackEndpoint": stack.WSEndpoint(), "measuringProxyEndpoint": proxyURL, "actualWireRequest": observed, "serverDecoded": decoded, "backendInitialization": initial, "uploadSeconds": time.Since(uploadStarted).Seconds(), "totalSeconds": time.Since(started).Seconds(), "peakConcurrentUploads": gate.peak.Load(), "activeUploadsAfter": gate.active.Load(), "closedRunRejected": true, "closedRunError": err.Error(), "positiveStepCallsRejected": denied.Load(), "fullReplayExecuted": false, "fullLifecycleExecuted": false, "productionAccepted": false})
}
