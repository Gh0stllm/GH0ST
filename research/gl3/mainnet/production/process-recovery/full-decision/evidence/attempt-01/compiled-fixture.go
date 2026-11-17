//go:build gl3_acceptance

// SPDX-License-Identifier: GPL-3.0-or-later
// Isolated process-recovery acceptance fixture; absent from production builds.
package arbtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/offchainlabs/nitro/arbnode"
	"github.com/offchainlabs/nitro/arbos/arbostypes"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
	"github.com/offchainlabs/nitro/cmd/conf"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/statetransfer"
	"github.com/offchainlabs/nitro/util/testhelpers"
	"github.com/offchainlabs/nitro/validator/server_common"
)

const gl3FullCrashRoot = "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086"

type gl3FullCrashManifest struct {
	DataDir, GenesisFile, GenesisSHA256, ParentURL, Machines string
	ChainConfig                                              *params.ChainConfig
	InitMessage                                              *arbostypes.ParsedInitMessage
	Addresses                                                *chaininfo.RollupAddresses
	Owner                                                    common.Address
	Job                                                      [32]byte
	SyncMode                                                 bool
}

type gl3FullCrashSnapshot struct {
	PID                                                int
	HeadHash, StateRoot                                common.Hash
	BlockNumber, HeadMessage, MessageCount, OwnerNonce uint64
	Inspect                                            string
	DBPaths                                            map[string]string
	DBDevices, DBInodes                                map[string]uint64
	ResolvedSync                                       map[string]bool
	ModuleRoot                                         common.Hash
}

type gl3FullCrashReady struct {
	PID                                                        int
	RPC, Control, ManifestSHA256, ExecutableSHA256, StartTicks string
	GenesisHash                                                common.Hash
	Snapshot                                                   gl3FullCrashSnapshot
}

func gl3FullCrashJSON(t *testing.T, path string, value any) {
	t.Helper()
	b, e := json.MarshalIndent(value, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(path, append(b, '\n'), 0600))
}

func gl3FullCrashRead(t *testing.T, path string, v any) {
	t.Helper()
	b, e := os.ReadFile(path)
	Require(t, e)
	Require(t, json.Unmarshal(b, v))
}

// Parent RPC forwarding preserves the actual external Geth mining wrapper.
// Only a loopback fixture endpoint is exposed; no fake chain data is returned.
func gl3FullCrashParentProxy(t *testing.T, client rpc.ClientInterface) *httptest.Server {
	t.Helper()
	type request struct {
		Version string            `json:"jsonrpc"`
		ID      json.RawMessage   `json:"id"`
		Method  string            `json:"method"`
		Params  []json.RawMessage `json:"params"`
	}
	answer := func(ctx context.Context, q request) map[string]any {
		args := make([]any, len(q.Params))
		for i := range q.Params {
			args[i] = q.Params[i]
		}
		var result json.RawMessage
		e := client.CallContext(ctx, &result, q.Method, args...)
		r := map[string]any{"jsonrpc": "2.0", "id": q.ID}
		if e == nil {
			r["result"] = result
			return r
		}
		code := -32000
		if x, ok := e.(rpc.Error); ok {
			code = x.ErrorCode()
		}
		x := map[string]any{"code": code, "message": e.Error()}
		if d, ok := e.(rpc.DataError); ok {
			x["data"] = d.ErrorData()
		}
		r["error"] = x
		return r
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, e := io.ReadAll(io.LimitReader(r.Body, 32<<20))
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if len(body) > 0 && body[0] == '[' {
			var qs []request
			if e = json.Unmarshal(body, &qs); e != nil {
				http.Error(w, e.Error(), 400)
				return
			}
			xs := make([]map[string]any, len(qs))
			for i, q := range qs {
				xs[i] = answer(r.Context(), q)
			}
			_ = json.NewEncoder(w).Encode(xs)
			return
		}
		var q request
		if e = json.Unmarshal(body, &q); e != nil {
			http.Error(w, e.Error(), 400)
			return
		}
		_ = json.NewEncoder(w).Encode(answer(r.Context(), q))
	}))
}

// This test is launched as a distinct executable process by the controller.
func TestGL3FullProcessCrashWorker(t *testing.T) {
	manifestPath := os.Getenv("GL3_CRASH_WORKER_MANIFEST")
	if manifestPath == "" {
		t.Skip("controller-only worker")
	}
	readyPath := os.Getenv("GL3_CRASH_WORKER_READY")
	if readyPath == "" {
		t.Fatal("ready path required")
	}
	var m gl3FullCrashManifest
	gl3FullCrashRead(t, manifestPath, &m)
	if !m.SyncMode {
		t.Fatal("explicit sync-mode profile required")
	}
	manifestBytes, e := os.ReadFile(manifestPath)
	Require(t, e)
	manifestSHA := sha256.Sum256(manifestBytes)
	genesis, e := os.ReadFile(m.GenesisFile)
	Require(t, e)
	sum := sha256.Sum256(genesis)
	if hex.EncodeToString(sum[:]) != m.GenesisSHA256 {
		t.Fatal("genesis import changed")
	}
	var initData statetransfer.ArbosInitializationInfo
	Require(t, json.Unmarshal(genesis, &initData))
	genesis = nil
	locator, e := server_common.NewMachineLocator(m.Machines)
	Require(t, e)
	if locator.LatestWasmModuleRoot() != common.HexToHash(gl3FullCrashRoot) {
		t.Fatal("wrong custom machine")
	}
	// A worker-only process global is consumed by the unchanged database-opening
	// helper for EACH of l2chaindata, wasm and arbitrumdata. No pre-kill flush.
	conf.PersistentConfigDefault.Pebble.SyncMode = true
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := NewNodeBuilder(ctx).DefaultConfig(t, true).WithPreBoldDeployment().DontParalellise().WithArbOSVersion(61).WithDatabase(rawdb.DBPebble).WithWasmRootDir(m.Machines)
	b.RequireScheme(t, rawdb.HashScheme)
	b.takeOwnership = false
	b.dataDir = m.DataDir
	b.l2StackConfig = testhelpers.CreateStackConfigForTest(m.DataDir)
	b.l2StackConfig.DBEngine = rawdb.DBPebble
	b.l2StackConfig.HTTPHost = "127.0.0.1"
	b.l2StackConfig.HTTPPort = 0
	b.chainConfig = m.ChainConfig
	b.initMessage = m.InitMessage
	b.addresses = m.Addresses
	b.L2Info.ArbInitData = initData
	b.execConfig.Sequencer.MaxBlockSpeed = 100 * time.Millisecond
	b.execConfig.Sequencer.MaxRevertGasReject = 0
	b.execConfig.Sequencer.QueueTimeout = 60 * time.Second
	b.execConfig.RPC.RPCEVMTimeout = 60 * time.Second
	b.execConfig.Caching.Archive = true
	b.execConfig.Caching.MaxNumberOfBlocksToSkipStateSaving = 0
	b.execConfig.Caching.MaxAmountOfGasToSkipStateSaving = 0
	b.nodeConfig.BlockValidator.Enable = false
	b.nodeConfig.Staker.Enable = false
	b.nodeConfig.BatchPoster.Enable = false
	b.nodeConfig.MessageExtraction.Enable = false
	b.nodeConfig.ParentChainReader.Enable = true
	b.nodeConfig.ParentChainReader.PollOnly = true
	b.nodeConfig.ParentChainReader.OldHeaderTimeout = 10 * time.Minute
	b.L1 = NewTestClient(ctx)
	b.L1.Client, e = ethclient.DialContext(ctx, m.ParentURL)
	Require(t, e)
	parentConf := arbnode.ConfigDefaultL1Test()
	parentConf.ParentChainReader.PollOnly = true
	parentConf.ParentChainReader.OldHeaderTimeout = 10 * time.Minute
	b.L1.ConsensusConfigFetcher = NewCommonConfigFetcher(parentConf)
	for _, name := range append([]string{"Faucet"}, DefaultChainAccounts...) {
		if !b.L1Info.HasAccount(name) {
			b.L1Info.GenerateAccount(name)
		}
	}
	cleanup := b.BuildL2OnL1(t)
	defer cleanup()
	parsed, e := abi.JSON(strings.NewReader(precompiles.GhostChessSlicesABI))
	Require(t, e)
	address := common.HexToAddress("0xa14")
	snapshot := func(allowMissingJob bool) (gl3FullCrashSnapshot, error) {
		x := gl3FullCrashSnapshot{PID: os.Getpid(), DBPaths: map[string]string{}, DBDevices: map[string]uint64{}, DBInodes: map[string]uint64{}, ResolvedSync: map[string]bool{}, ModuleRoot: locator.LatestWasmModuleRoot()}
		h, e := b.L2.Client.HeaderByNumber(ctx, nil)
		if e != nil {
			return x, e
		}
		x.HeadHash = h.Hash()
		x.StateRoot = h.Root
		x.BlockNumber = h.Number.Uint64()
		count, e := b.L2.ConsensusNode.TxStreamer.GetMessageCount()
		if e != nil {
			return x, e
		}
		x.MessageCount = uint64(count)
		head, e := b.L2.ExecNode.ExecEngine.HeadMessageIndex()
		if e != nil {
			return x, e
		}
		x.HeadMessage = uint64(head)
		x.OwnerNonce, e = b.L2.Client.PendingNonceAt(ctx, m.Owner)
		if e != nil {
			return x, e
		}
		data, e := parsed.Pack("inspect", m.Job)
		if e != nil {
			return x, e
		}
		got, e := b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: m.Owner, To: &address, Data: data}, nil)
		// Before newGame the first ready snapshot legitimately has no inspect.
		if e == nil {
			x.Inspect = hex.EncodeToString(got)
		} else if !allowMissingJob {
			return x, e
		}
		for _, name := range []string{"l2chaindata", "wasm", "arbitrumdata"} {
			path := b.L2.Stack.ResolvePath(name)
			x.DBPaths[name] = path
			var st syscall.Stat_t
			if e = syscall.Stat(path, &st); e != nil {
				return x, e
			}
			x.DBDevices[name] = uint64(st.Dev)
			x.DBInodes[name] = st.Ino
			x.ResolvedSync[name] = PebbleExtraOptionsForTest(t, b.execConfig, name).SyncMode
			if !x.ResolvedSync[name] {
				return x, fmt.Errorf("sync disabled: %s", name)
			}
		}
		return x, nil
	}
	stop := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/snapshot", func(w http.ResponseWriter, r *http.Request) {
		x, e := snapshot(false)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		_ = json.NewEncoder(w).Encode(x)
	})
	mux.HandleFunc("/canonical", func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		bc := b.L2.ExecNode.Backend.ArbInterface().BlockChain()
		head := bc.CurrentBlock()
		saved, e := bc.StateAt(head)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		digest, size, root, deltas, e := precompiles.GhostChessCanonicalForAcceptance(saved, b.chainConfig, head.Number.Uint64(), m.Owner, m.Job)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"sha256": digest, "bytes": size, "imageRoot": hex.EncodeToString(root[:]), "deltaCount": deltas, "seconds": time.Since(started).Seconds(), "scope": "cold authenticated canonical reconstruction in fresh VM, no Begin or Advance"})
	})
	mux.HandleFunc("/stop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		close(stop)
		_, _ = w.Write([]byte("stopping"))
	})
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	Require(t, e)
	server := &http.Server{Handler: mux}
	defer server.Close()
	go server.Serve(listener)
	x, e := snapshot(true)
	Require(t, e)
	exe, e := os.Executable()
	Require(t, e)
	f, e := os.Open(exe)
	Require(t, e)
	h := sha256.New()
	_, e = io.Copy(h, f)
	Require(t, e)
	Require(t, f.Close())
	stat, e := os.ReadFile("/proc/self/stat")
	Require(t, e)
	at := strings.LastIndex(string(stat), ")")
	fields := strings.Fields(string(stat)[at+1:])
	if len(fields) < 20 {
		t.Fatal("missing process start ticks")
	}
	genesisHeader, e := b.L2.Client.HeaderByNumber(ctx, new(big.Int).SetUint64(m.ChainConfig.ArbitrumChainParams.GenesisBlockNum))
	Require(t, e)
	gl3FullCrashJSON(t, readyPath, gl3FullCrashReady{PID: os.Getpid(), RPC: b.L2.Stack.HTTPEndpoint(), Control: "http://" + listener.Addr().String(), ManifestSHA256: hex.EncodeToString(manifestSHA[:]), ExecutableSHA256: hex.EncodeToString(h.Sum(nil)), StartTicks: fields[19], GenesisHash: genesisHeader.Hash(), Snapshot: x})
	<-stop
}

func TestGL3TwoCrashFullDecisionRecovery(t *testing.T) {
	out, machines := os.Getenv("GL3_PROCESS_RECOVERY_OUT"), os.Getenv("GL3_PROCESS_RECOVERY_MACHINES")
	if out == "" || machines == "" {
		t.Fatal("explicit isolated output/custom machine paths required")
	}
	Require(t, os.MkdirAll(out, 0700))
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Minute)
	defer cancel()
	b := NewNodeBuilder(ctx).DefaultConfig(t, true).WithPreBoldDeployment().DontParalellise().WithArbOSVersion(61).WithDatabase(rawdb.DBPebble).WithWasmRootDir(machines)
	b.takeOwnership = false
	b.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	b.chainConfig.ArbitrumChainParams.InitialChainOwner = b.L2Info.GetAddress("Owner")
	for i := range b.L2Info.ArbInitData.Accounts {
		if b.L2Info.ArbInitData.Accounts[i].Addr == b.L2Info.GetAddress("Owner") {
			b.L2Info.ArbInitData.Accounts[i].EthBalance = new(big.Int).Exp(big.NewInt(10), big.NewInt(21), nil)
		}
	}
	r, e := sliced.Shared()
	Require(t, e)
	v, e := r.Instantiate()
	Require(t, e)
	Require(t, v.Init())
	image := v.Image()
	v.Close()
	db, e := state.New(types.EmptyRootHash, state.NewDatabaseForTesting())
	Require(t, e)
	recorder := &chessGenesisRecorder{StateDB: db, accounts: map[common.Address]*statetransfer.AccountInitContractInfo{}}
	Require(t, precompiles.SeedGhostChessSlicesGenesis(recorder, image))
	image = sliced.Image{}
	addresses := make([]common.Address, 0, len(recorder.accounts))
	for a := range recorder.accounts {
		addresses = append(addresses, a)
	}
	sort.Slice(addresses, func(i, j int) bool { return addresses[i].Hex() < addresses[j].Hex() })
	for _, a := range addresses {
		b.L2Info.ArbInitData.Accounts = append(b.L2Info.ArbInitData.Accounts, statetransfer.AccountInitializationInfo{Addr: a, Nonce: 1, EthBalance: new(big.Int), ContractInfo: recorder.accounts[a]})
	}
	b.BuildL1(t)
	defer b.L1.cleanup()
	parentProxy := gl3FullCrashParentProxy(t, b.L1.Client.Client())
	defer parentProxy.Close()
	genesisPath := filepath.Join(out, "genesis-import.json")
	gl3FullCrashJSON(t, genesisPath, b.L2Info.ArbInitData)
	genesisBytes, e := os.ReadFile(genesisPath)
	Require(t, e)
	genesisSum := sha256.Sum256(genesisBytes)
	genesisBytes = nil
	m := gl3FullCrashManifest{DataDir: filepath.Join(out, "persistent-l2"), GenesisFile: genesisPath, GenesisSHA256: hex.EncodeToString(genesisSum[:]), ParentURL: parentProxy.URL, Machines: machines, ChainConfig: b.chainConfig, InitMessage: b.initMessage, Addresses: b.addresses, Owner: b.L2Info.GetAddress("Owner"), Job: [32]byte{54}, SyncMode: true}
	manifest := filepath.Join(out, "worker-manifest.json")
	gl3FullCrashJSON(t, manifest, m)
	startWorker := func(label string) (*exec.Cmd, gl3FullCrashReady) {
		t.Helper()
		readyPath := filepath.Join(out, label+"-ready.json")
		exe, e := os.Executable()
		Require(t, e)
		cmd := exec.CommandContext(ctx, exe, "-test.run=^TestGL3FullProcessCrashWorker$", "-test.v", "-test.timeout=45m")
		cmd.Env = append(os.Environ(), "GL3_CRASH_WORKER_MANIFEST="+manifest, "GL3_CRASH_WORKER_READY="+readyPath)
		log, e := os.Create(filepath.Join(out, label+".log"))
		Require(t, e)
		cmd.Stdout = log
		cmd.Stderr = log
		Require(t, cmd.Start())
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = log.Close() })
		deadline := time.Now().Add(3 * time.Minute)
		for time.Now().Before(deadline) {
			if _, e := os.Stat(readyPath); e == nil {
				var ready gl3FullCrashReady
				gl3FullCrashRead(t, readyPath, &ready)
				if ready.PID != cmd.Process.Pid {
					t.Fatal("worker PID mismatch")
				}
				return cmd, ready
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("worker did not become ready", label)
		return nil, gl3FullCrashReady{}
	}
	workerA, readyA := startWorker("worker-a")
	client, e := ethclient.DialContext(ctx, readyA.RPC)
	Require(t, e)
	defer client.Close()
	auth := b.L2Info.GetDefaultTransactOpts("Owner", ctx)
	auth.GasLimit = 2_000_000
	owner, e := precompilesgen.NewArbOwner(types.ArbOwnerAddress, client)
	Require(t, e)
	ensure := func(tx *types.Transaction, e error) *types.Receipt {
		t.Helper()
		Require(t, e)
		receipt, e := EnsureTxSucceeded(ctx, client, tx)
		Require(t, e)
		return receipt
	}
	ensure(owner.SetMaxTxGasLimit(&auth, 14_000_000))
	ensure(owner.SetMaxBlockGasLimit(&auth, 15_000_000))
	ensure(owner.SetSpeedLimit(&auth, 150_000_000))
	ensure(owner.SetGasPricingConstraints(&auth, [][3]uint64{{150_000_000, 102, 0}, {150_000_000, 600, 0}}))
	parsed, e := abi.JSON(strings.NewReader(precompiles.GhostChessSlicesABI))
	Require(t, e)
	address := common.HexToAddress("0xa14")
	send := func(name string, args ...any) *types.Receipt {
		t.Helper()
		data, e := parsed.Pack(name, args...)
		Require(t, e)
		nonce, e := client.PendingNonceAt(ctx, auth.From)
		Require(t, e)
		b.L2Info.GetInfoWithPrivKey("Owner").Nonce.Store(nonce)
		tx := b.L2Info.PrepareTxTo("Owner", &address, 13_800_000, new(big.Int), data)
		Require(t, client.SendTransaction(ctx, tx))
		return ensure(tx, nil)
	}
	inspect := func() []any {
		t.Helper()
		data, e := parsed.Pack("inspect", m.Job)
		Require(t, e)
		got, e := client.CallContract(ctx, ethereum.CallMsg{From: auth.From, To: &address, Data: data}, nil)
		Require(t, e)
		values, e := parsed.Unpack("inspect", got)
		Require(t, e)
		return values
	}
	snap := func(control string) gl3FullCrashSnapshot {
		t.Helper()
		response, e := http.Get(control + "/snapshot")
		Require(t, e)
		defer response.Body.Close()
		if response.StatusCode != 200 {
			body, _ := io.ReadAll(response.Body)
			t.Fatal("snapshot error", string(body))
		}
		var x gl3FullCrashSnapshot
		Require(t, json.NewDecoder(response.Body).Decode(&x))
		return x
	}
	send("newGame", m.Job)
	send("begin", m.Job, uint64(1), "e2e4")
	currentWorker, currentReady := workerA, readyA
	restarts := []map[string]any{}
	parentHeartbeats := []common.Hash{}
	for step := uint32(1); step <= 2463; step++ {
		if step == 64 || step == 2048 {
			beforeValues := inspect()
			if beforeValues[1] != step || beforeValues[2] != true || beforeValues[4] != "" {
				t.Fatal("wrong pre-crash cursor", step, beforeValues)
			}
			before := snap(currentReady.Control)
			parentBefore, e := b.L1.Client.HeaderByNumber(ctx, nil)
			Require(t, e)
			crashedAt := time.Now()
			Require(t, currentWorker.Process.Kill())
			waitErr := currentWorker.Wait()
			exitError, ok := waitErr.(*exec.ExitError)
			if !ok {
				t.Fatal("missing actual killed-process exit", waitErr)
			}
			status, ok := exitError.Sys().(syscall.WaitStatus)
			gl3FullCrashJSON(t, filepath.Join(out, fmt.Sprintf("cursor-%d-worker-exit.json", step)), map[string]any{"pid": currentReady.PID, "waitError": waitErr.Error(), "exitCode": exitError.ExitCode(), "waitStatus": uint32(status), "signaled": ok && status.Signaled(), "signal": status.Signal().String()})
			if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
				t.Fatal("worker not SIGKILL", step, waitErr)
			}
			if e = syscall.Kill(currentReady.PID, 0); e == nil {
				t.Fatal("old worker still exists")
			}
			probeCtx, probeCancel := context.WithTimeout(ctx, time.Second)
			_, probeError := client.HeaderByNumber(probeCtx, nil)
			probeCancel()
			if probeError == nil {
				t.Fatal("old worker RPC still serves")
			}
			parentAfter, e := b.L1.Client.HeaderByNumber(ctx, nil)
			Require(t, e)
			if parentAfter.Hash() != parentBefore.Hash() {
				t.Fatal("parent changed during child kill")
			}
			nextWorker, nextReady := startWorker(fmt.Sprintf("worker-after-%d", step))
			if nextReady.PID == currentReady.PID || nextReady.ManifestSHA256 != currentReady.ManifestSHA256 || nextReady.ExecutableSHA256 != currentReady.ExecutableSHA256 || nextReady.GenesisHash != currentReady.GenesisHash {
				t.Fatal("fresh PID/identical configuration, binary and genesis failed")
			}
			client.Close()
			client, e = ethclient.DialContext(ctx, nextReady.RPC)
			Require(t, e)
			after := snap(nextReady.Control)
			beforeCompare, afterCompare := before, after
			beforeCompare.PID = 0
			afterCompare.PID = 0
			if !reflect.DeepEqual(beforeCompare, afterCompare) {
				gl3FullCrashJSON(t, filepath.Join(out, fmt.Sprintf("cursor-%d-before.json", step)), before)
				gl3FullCrashJSON(t, filepath.Join(out, fmt.Sprintf("cursor-%d-after.json", step)), after)
				t.Fatal("persisted state/message/nonce/DB profile changed", step)
			}
			resumed := send("advance", m.Job, uint64(1), step)
			values := inspect()
			if values[1] != step+1 || values[2] != true {
				t.Fatal("next advance did not resume exactly", step, values)
			}
			restarts = append(restarts, map[string]any{"cursorBefore": step, "workerBefore": currentReady, "workerAfter": nextReady, "before": before, "after": after, "actualSignal": "SIGKILL", "actualWaitError": waitErr.Error(), "parentHeadBefore": parentBefore.Hash(), "parentHeadAfter": parentAfter.Hash(), "firstResumedReceipt": resumed, "resumedCursor": step + 1, "recoveryAndAdvanceSeconds": time.Since(crashedAt).Seconds(), "persistedStateAndMessagePositionEqual": true})
			gl3FullCrashJSON(t, filepath.Join(out, "restarts-progress.json"), restarts)
			currentWorker, currentReady = nextWorker, nextReady
		} else {
			send("advance", m.Job, uint64(1), step)
		}
		if step%128 == 0 {
			// Seal a real empty block on the actual private parent, as a running parent
			// would naturally progress. No heartbeat runs concurrently with a kill.
			Require(t, b.L1.ExternalL1Mining.AdvanceTime(ctx, time.Second))
			parentHead, e := b.L1.Client.HeaderByNumber(ctx, nil)
			Require(t, e)
			parentHeartbeats = append(parentHeartbeats, parentHead.Hash())
			gl3FullCrashJSON(t, filepath.Join(out, "progress.json"), map[string]any{"cursor": step + 1, "completedComputeTransactions": step + 1, "totalExpectedComputeTransactions": 2464, "restartsCompleted": len(restarts), "scope": "actual private unchanged full decision running, not completion evidence"})
		}
	}
	values := inspect()
	if values[1] != uint32(2464) || values[2] != false || values[4] != "e7e5" || values[5] != uint64(24000033) || values[6] != uint32(38) {
		t.Fatal("full-strength completed result changed", values)
	}
	response, e := http.Get(currentReady.Control + "/canonical")
	Require(t, e)
	if response.StatusCode != 200 {
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		t.Fatal("canonical audit failed", string(body))
	}
	var canonical struct {
		SHA256     string  `json:"sha256"`
		Bytes      int     `json:"bytes"`
		ImageRoot  string  `json:"imageRoot"`
		DeltaCount uint32  `json:"deltaCount"`
		Seconds    float64 `json:"seconds"`
	}
	Require(t, json.NewDecoder(response.Body).Decode(&canonical))
	response.Body.Close()
	if canonical.SHA256 != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" || canonical.Bytes != 163085439 || canonical.DeltaCount != 2464 {
		t.Fatal("full retained canonical state changed", canonical)
	}
	public, e := precompilesgen.NewArbOwnerPublic(types.ArbOwnerPublicAddress, client)
	Require(t, e)
	feature, e := public.GetNativeTokenManagementFrom(&bind.CallOpts{Context: ctx})
	Require(t, e)
	minters, e := public.GetAllNativeTokenOwners(&bind.CallOpts{Context: ctx})
	Require(t, e)
	if feature != 0 || len(minters) != 0 {
		t.Fatal("native mint feature changed")
	}
	report := map[string]any{"passed": true, "scope": "genuine private same-host separate-process SIGKILL/reopen at64and2048 in one unchanged full24m decision over identical sync-mode Pebble DBs; not power loss, production daemon supervision or fault proof", "restarts": restarts, "firstWorker": readyA, "lastWorker": currentReady, "canonical": canonical, "parentRealEmptyBlockHeartbeats": parentHeartbeats, "move": values[4], "nodes": values[5], "depth": values[6], "cursor": values[1], "fullDecisionCompleted": true, "syncMode": true, "archiveMode": true, "saveEveryBlock": true, "nativeTokenManagementFrom": feature, "nativeMintOwners": minters, "allExecutionOnRunpod": true, "enginePolicyChanged": false, "publicDeployment": false, "realChainSpend": 0}
	gl3FullCrashJSON(t, filepath.Join(out, "full-process-recovery-core-result.json"), report)
	response, e = http.Post(currentReady.Control+"/stop", "text/plain", nil)
	Require(t, e)
	response.Body.Close()
	finalExit := currentWorker.Wait()
	var code any
	if finalExit == nil {
		code = 0
	} else if ex, ok := finalExit.(*exec.ExitError); ok {
		code = ex.ExitCode()
	}
	gl3FullCrashJSON(t, filepath.Join(out, "final-worker-exit.json"), map[string]any{"pid": currentReady.PID, "exitCode": code, "waitError": fmt.Sprint(finalExit), "scope": "graceful cleanup after two independently recorded SIGKILL recoveries"})
	Require(t, finalExit)
	gl3FullCrashJSON(t, filepath.Join(out, "full-process-recovery.json"), report)
}
