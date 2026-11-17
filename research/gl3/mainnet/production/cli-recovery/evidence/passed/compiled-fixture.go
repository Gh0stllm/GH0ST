//go:build gl3_acceptance

// SPDX-License-Identifier: GPL-3.0-or-later
// Controller only. The node under test is the frozen ordinary cmd/nitro binary.
package arbtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
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
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/statetransfer"
)

const gl3CLIBinarySHA = "13ba3c913c260c453628f273cfd8dc86f742f291d87e9a9887531e039d351f38"

type gl3CLISnapshot struct {
	PID                                  int
	HeadHash, StateRoot                  common.Hash
	BlockNumber, HeadMessage, OwnerNonce uint64
	Inspect                              string
	DBPaths                              map[string]string
	DBDevices, DBInodes                  map[string]uint64
	ConfiguredSync                       bool
	LiveMessageCountAvailable            bool
}
type gl3CLIReady struct {
	PID                                                  int
	RPC, IPC, ExecutableSHA256, StartTicks, ConfigSHA256 string
	Command                                              []string
	GenesisHash                                          common.Hash
	Snapshot                                             gl3CLISnapshot
}

func gl3CLIJSON(t *testing.T, path string, value any) {
	t.Helper()
	b, e := json.MarshalIndent(value, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(path, append(b, '\n'), 0600))
}

func gl3CLIRead(t *testing.T, path string, v any) {
	t.Helper()
	b, e := os.ReadFile(path)
	Require(t, e)
	Require(t, json.Unmarshal(b, v))
}

// Parent RPC forwarding preserves the actual external Geth mining wrapper.
// Only a loopback fixture endpoint is exposed; no fake chain data is returned.
func gl3CLIParentProxy(t *testing.T, client rpc.ClientInterface) *httptest.Server {
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

func gl3CLIHash(t *testing.T, path string) string {
	t.Helper()
	f, e := os.Open(path)
	Require(t, e)
	defer f.Close()
	h := sha256.New()
	_, e = io.Copy(h, f)
	Require(t, e)
	return hex.EncodeToString(h.Sum(nil))
}
func gl3CLIIdentity(t *testing.T, pid int, command []string) (string, string) {
	t.Helper()
	data, e := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	Require(t, e)
	if string(data) != strings.Join(command, "\x00")+"\x00" {
		t.Fatal("CLI command differs", string(data), command)
	}
	sha := gl3CLIHash(t, fmt.Sprintf("/proc/%d/exe", pid))
	if sha != gl3CLIBinarySHA {
		t.Fatal("CLI executable changed", sha)
	}
	stat, e := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	Require(t, e)
	fields := strings.Fields(string(stat[strings.LastIndex(string(stat), ")")+1:]))
	if len(fields) < 20 {
		t.Fatal("missing CLI start ticks")
	}
	return sha, fields[19]
}
func gl3CLIDBPaths(t *testing.T, dataDir string, pid int) (map[string]string, map[string]uint64, map[string]uint64) {
	t.Helper()
	paths := map[string]string{}
	devs := map[string]uint64{}
	inodes := map[string]uint64{}
	Require(t, filepath.WalkDir(dataDir, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			switch d.Name() {
			case "l2chaindata", "wasm", "arbitrumdata":
				if paths[d.Name()] != "" {
					return fmt.Errorf("ambiguous DB directory %s", d.Name())
				}
				paths[d.Name()] = path
				var stat syscall.Stat_t
				if e = syscall.Stat(path, &stat); e != nil {
					return e
				}
				devs[d.Name()] = uint64(stat.Dev)
				inodes[d.Name()] = stat.Ino
				return filepath.SkipDir
			}
		}
		return nil
	}))
	fds, e := os.ReadDir(fmt.Sprintf("/proc/%d/fd", pid))
	Require(t, e)
	for _, name := range []string{"l2chaindata", "wasm", "arbitrumdata"} {
		if paths[name] == "" {
			t.Fatal("missing actual DB directory", name)
		}
		owned := false
		for _, fd := range fds {
			target, e := os.Readlink(fmt.Sprintf("/proc/%d/fd/%s", pid, fd.Name()))
			if e == nil && strings.HasPrefix(target, paths[name]+string(os.PathSeparator)) {
				owned = true
				break
			}
		}
		if !owned {
			t.Fatal("CLI has no open file in required DB", name, paths[name])
		}
	}
	return paths, devs, inodes
}
func TestGL3Cursor64CLIProcessCrashRecovery(t *testing.T) {
	out, machines, cli := os.Getenv("GL3_CLI_RECOVERY_OUT"), os.Getenv("GL3_CLI_RECOVERY_MACHINES"), os.Getenv("GL3_CLI_RECOVERY_BINARY")
	if out == "" || machines == "" || cli == "" {
		t.Fatal("explicit private CLI rehearsal paths required")
	}
	Require(t, os.MkdirAll(out, 0700))
	if gl3CLIHash(t, cli) != gl3CLIBinarySHA {
		t.Fatal("frozen ordinary CLI changed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
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
	parentProxy := gl3CLIParentProxy(t, b.L1.Client.Client())
	defer parentProxy.Close()
	// Official JsonInitDataReader expects newline-delimited account objects, a
	// Balance string, and a descriptor pointing to them; not ArbosInitData JSON.
	accountsPath := filepath.Join(out, "accounts.ndjson")
	f, e := os.OpenFile(accountsPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	Require(t, e)
	enc := json.NewEncoder(f)
	for _, a := range b.L2Info.ArbInitData.Accounts {
		balance := "0x0"
		if a.EthBalance != nil {
			balance = "0x" + a.EthBalance.Text(16)
		}
		Require(t, enc.Encode(statetransfer.AccountInitializationInfoJson{Addr: a.Addr, Nonce: a.Nonce, Balance: balance, ContractInfo: a.ContractInfo, ClassicHash: a.ClassicHash}))
	}
	Require(t, f.Close())
	importPath := filepath.Join(out, "import.json")
	gl3CLIJSON(t, importPath, statetransfer.ArbosInitFileContents{NextBlockNumber: b.L2Info.ArbInitData.NextBlockNumber, AccountsPath: "accounts.ndjson"})
	// Prove the actual official reader sees every account before CLI startup.
	reader, e := statetransfer.NewJsonInitDataReader(importPath)
	Require(t, e)
	ar, e := reader.GetAccountDataReader()
	Require(t, e)
	count := 0
	for ar.More() {
		_, e = ar.GetNext()
		Require(t, e)
		count++
	}
	Require(t, ar.Close())
	Require(t, reader.Close())
	if count != len(b.L2Info.ArbInitData.Accounts) {
		t.Fatal("official import count mismatch", count)
	}
	parentID, e := b.L1.Client.ChainID(ctx)
	Require(t, e)
	parentIsArbitrum := false
	chainPath := filepath.Join(out, "chain-info.json")
	gl3CLIJSON(t, chainPath, []chaininfo.ChainInfo{{ChainName: "gl3-private-cli64", ParentChainId: parentID.Uint64(), ParentChainIsArbitrum: &parentIsArbitrum, HasGenesisState: true, ChainConfig: b.chainConfig, RollupAddresses: b.addresses}})
	dataDir := filepath.Join(out, "persistent-l2")
	ipc := filepath.Join(out, "nitro.ipc")
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	Require(t, e)
	port := listener.Addr().(*net.TCPAddr).Port
	Require(t, listener.Close())
	rpcURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	config := map[string]any{
		"chain":        map[string]any{"id": b.chainConfig.ChainID.Uint64(), "info-files": []string{chainPath}},
		"parent-chain": map[string]any{"id": parentID.Uint64(), "connection": map[string]any{"url": parentProxy.URL}},
		"persistent":   map[string]any{"chain": dataDir, "db-engine": "pebble", "pebble": map[string]any{"sync-mode": true, "max-concurrent-compactions": 2}},
		"init":         map[string]any{"import-file": importPath, "validate-genesis-assertion": true, "accounts-per-sync": 10000},
		"node":         map[string]any{"dangerous": map[string]any{"disable-blob-reader": true, "no-sequencer-coordinator": true}, "sequencer": true, "seq-coordinator": map[string]any{"enable": false}, "block-validator": map[string]any{"enable": false}, "staker": map[string]any{"enable": false}, "batch-poster": map[string]any{"enable": false}, "message-extraction": map[string]any{"enable": false}, "parent-chain-reader": map[string]any{"enable": true, "poll-only": true, "old-header-timeout": "10m"}, "delayed-sequencer": map[string]any{"enable": false}, "feed": map[string]any{"input": map[string]any{"url": []string{}}, "output": map[string]any{"enable": false, "signed": false}}},
		"execution":    map[string]any{"sequencer": map[string]any{"enable": true, "max-tx-data-size": 95000, "max-block-speed": "100ms", "max-revert-gas-reject": 0, "queue-timeout": "60s"}, "caching": map[string]any{"archive": true, "state-scheme": "hash", "max-number-of-blocks-to-skip-state-saving": 0, "max-amount-of-gas-to-skip-state-saving": 0}, "rpc": map[string]any{"evm-timeout": "60s"}, "rpc-server": map[string]any{"enable": true, "authenticated": false, "public": false}},
		"validation":   map[string]any{"wasm": map[string]any{"root-path": machines}},
		"http":         map[string]any{"addr": "127.0.0.1", "port": port, "api": []string{"eth", "net", "web3", "arb"}, "vhosts": []string{"127.0.0.1", "localhost"}}, "ipc": map[string]any{"path": ipc}, "auth": map[string]any{"addr": ""}, "ws": map[string]any{"addr": ""}, "version-alerter": map[string]any{"enable": false}, "ensure-rollup-deployment": false, "log-level": "INFO",
	}
	configPath := filepath.Join(out, "node-config.json")
	gl3CLIJSON(t, configPath, config)
	configSHA := gl3CLIHash(t, configPath)
	command := []string{cli, "--conf.file", configPath}
	dump := exec.CommandContext(ctx, cli, "--conf.file", configPath, "--conf.dump")
	dumpOut, e := dump.CombinedOutput()
	Require(t, os.WriteFile(filepath.Join(out, "effective-config.json"), dumpOut, 0600))
	Require(t, e)
	var effective map[string]any
	Require(t, json.Unmarshal(dumpOut, &effective))
	persist := effective["persistent"].(map[string]any)
	if persist["pebble"].(map[string]any)["sync-mode"] != true {
		t.Fatal("effective CLI sync-mode not enabled")
	}
	gl3CLIJSON(t, filepath.Join(out, "bootstrap-manifest.json"), map[string]any{"ordinaryCLISHA256": gl3CLIBinarySHA, "command": command, "configurationSHA256": configSHA, "effectiveConfigurationSHA256": gl3CLIHash(t, filepath.Join(out, "effective-config.json")), "importDescriptorSHA256": gl3CLIHash(t, importPath), "accountsSHA256": gl3CLIHash(t, accountsPath), "importedAccountCount": count, "chainInfoSHA256": gl3CLIHash(t, chainPath), "moduleRoot": "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086", "parentURL": parentProxy.URL, "parentChainID": parentID, "childChainID": b.chainConfig.ChainID, "noWalletConfiguration": true, "scope": "private pre-BoLD parent plus ordinary CLI, not production genesis/backing/fault-proof acceptance"})
	var client *ethclient.Client
	var ipcClient *rpc.Client
	address := common.HexToAddress("0xa14")
	job := [32]byte{56}
	parsed, e := abi.JSON(strings.NewReader(precompiles.GhostChessSlicesABI))
	Require(t, e)
	snapshot := func(pid int, allowMissing bool) gl3CLISnapshot {
		t.Helper()
		x := gl3CLISnapshot{PID: pid, ConfiguredSync: true, LiveMessageCountAvailable: false}
		h, e := client.HeaderByNumber(ctx, nil)
		Require(t, e)
		x.HeadHash = h.Hash()
		x.StateRoot = h.Root
		x.BlockNumber = h.Number.Uint64()
		Require(t, ipcClient.CallContext(ctx, &x.HeadMessage, "nitroexecution_headMessageIndex"))
		x.OwnerNonce, e = client.PendingNonceAt(ctx, b.L2Info.GetAddress("Owner"))
		Require(t, e)
		data, e := parsed.Pack("inspect", job)
		Require(t, e)
		got, e := client.CallContract(ctx, ethereum.CallMsg{From: b.L2Info.GetAddress("Owner"), To: &address, Data: data}, nil)
		if e == nil {
			x.Inspect = hex.EncodeToString(got)
		} else if !allowMissing {
			Require(t, e)
		}
		x.DBPaths, x.DBDevices, x.DBInodes = gl3CLIDBPaths(t, dataDir, pid)
		return x
	}
	start := func(label string) (*exec.Cmd, gl3CLIReady) {
		t.Helper()
		log, e := os.Create(filepath.Join(out, label+".log"))
		Require(t, e)
		cmd := exec.CommandContext(ctx, command[0], command[1:]...)
		cmd.Stdout = log
		cmd.Stderr = log
		Require(t, cmd.Start())
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = log.Close() })
		deadline := time.Now().Add(3 * time.Minute)
		var ready gl3CLIReady
		for time.Now().Before(deadline) {
			if cmd.ProcessState != nil {
				t.Fatal("CLI exited before readiness")
			}
			stat, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", cmd.Process.Pid))
			if err != nil || strings.HasPrefix(strings.TrimSpace(string(stat[strings.LastIndex(string(stat), ")")+1:])), "Z ") {
				wait := cmd.Wait()
				gl3CLIJSON(t, filepath.Join(out, label+"-startup-exit.json"), map[string]any{"pid": cmd.Process.Pid, "waitError": fmt.Sprint(wait), "exitCode": cmd.ProcessState.ExitCode()})
				t.Fatal("CLI exited before readiness", label, wait)
			}
			c, er := ethclient.DialContext(ctx, rpcURL)
			if er == nil {
				_, er = c.HeaderByNumber(ctx, nil)
				if er == nil {
					ic, er := rpc.DialIPC(ctx, ipc)
					if er == nil {
						if client != nil {
							client.Close()
						}
						if ipcClient != nil {
							ipcClient.Close()
						}
						client = c
						ipcClient = ic
						sha, ticks := gl3CLIIdentity(t, cmd.Process.Pid, command)
						g, e := client.HeaderByNumber(ctx, new(big.Int))
						Require(t, e)
						ready = gl3CLIReady{PID: cmd.Process.Pid, RPC: rpcURL, IPC: ipc, ExecutableSHA256: sha, StartTicks: ticks, ConfigSHA256: configSHA, Command: command, GenesisHash: g.Hash(), Snapshot: snapshot(cmd.Process.Pid, true)}
						gl3CLIJSON(t, filepath.Join(out, label+"-ready.json"), ready)
						return cmd, ready
					}
				}
				c.Close()
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("CLI did not become ready", label)
		return nil, ready
	}
	workerA, readyA := start("cli-a")
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
		data, e := parsed.Pack("inspect", job)
		Require(t, e)
		got, e := client.CallContract(ctx, ethereum.CallMsg{From: auth.From, To: &address, Data: data}, nil)
		Require(t, e)
		vals, e := parsed.Unpack("inspect", got)
		Require(t, e)
		return vals
	}
	send("newGame", job)
	send("begin", job, uint64(1), "e2e4")
	var last *types.Receipt
	for step := uint32(1); step < 64; step++ {
		last = send("advance", job, uint64(1), step)
	}
	values := inspect()
	if values[1] != uint32(64) || values[2] != true || values[4] != "" {
		t.Fatal("not pending cursor64", values)
	}
	before := snapshot(readyA.PID, false)
	if before.HeadHash != last.BlockHash {
		t.Fatal("acknowledged head differs from last receipt")
	}
	gl3CLIJSON(t, filepath.Join(out, "before.json"), before)
	parentBefore, e := b.L1.Client.HeaderByNumber(ctx, nil)
	Require(t, e)
	crashedAt := time.Now()
	// Primary failure is direct SIGKILL: no SIGSTOP, copy, flush or serialization.
	Require(t, workerA.Process.Kill())
	waitErr := workerA.Wait()
	ex, ok := waitErr.(*exec.ExitError)
	if !ok {
		t.Fatal("no actual killed CLI exit", waitErr)
	}
	status, ok := ex.Sys().(syscall.WaitStatus)
	gl3CLIJSON(t, filepath.Join(out, "cli-a-exit.json"), map[string]any{"pid": readyA.PID, "exitCode": ex.ExitCode(), "waitError": waitErr.Error(), "signaled": ok && status.Signaled(), "signal": status.Signal().String()})
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatal("CLI not actually SIGKILLed")
	}
	if syscall.Kill(readyA.PID, 0) == nil {
		t.Fatal("old CLI still exists")
	}
	probe, stopProbe := context.WithTimeout(ctx, time.Second)
	_, probeErr := client.HeaderByNumber(probe, nil)
	stopProbe()
	if probeErr == nil {
		t.Fatal("old CLI RPC still serves")
	}
	parentAfter, e := b.L1.Client.HeaderByNumber(ctx, nil)
	Require(t, e)
	if parentAfter.Hash() != parentBefore.Hash() {
		t.Fatal("parent changed across CLI crash")
	}
	workerB, readyB := start("cli-b")
	after := snapshot(readyB.PID, false)
	gl3CLIJSON(t, filepath.Join(out, "after.json"), after)
	if readyB.PID == readyA.PID || readyB.StartTicks == readyA.StartTicks || readyB.GenesisHash != readyA.GenesisHash || readyB.ExecutableSHA256 != readyA.ExecutableSHA256 || readyB.ConfigSHA256 != readyA.ConfigSHA256 {
		t.Fatal("CLI identity/genesis/config mismatch")
	}
	bc, ac := before, after
	bc.PID = 0
	ac.PID = 0
	if !reflect.DeepEqual(bc, ac) {
		t.Fatal("persisted CLI head/root/message-index/nonce/inspect/DB identity mismatch")
	}
	resumed := send("advance", job, uint64(1), uint32(64))
	values = inspect()
	if values[1] != uint32(65) || values[2] != true {
		t.Fatal("real next advance not65", values)
	}
	public, e := precompilesgen.NewArbOwnerPublic(types.ArbOwnerPublicAddress, client)
	Require(t, e)
	feature, e := public.GetNativeTokenManagementFrom(&bind.CallOpts{Context: ctx})
	Require(t, e)
	minters, e := public.GetAllNativeTokenOwners(&bind.CallOpts{Context: ctx})
	Require(t, e)
	if feature != 0 || len(minters) != 0 {
		t.Fatal("mint controls changed")
	}
	report := map[string]any{"passed": true, "scope": "ordinary frozen cmd/nitro CLI SIGKILL/restart at pending cursor64 on same host; not power loss, complete decision, BoLD, async-default durability or hosting acceptance", "workerA": readyA, "workerB": readyB, "before": before, "after": after, "lastAcknowledgedReceipt": last, "firstResumedReceipt": resumed, "resumedCursor": 65, "nativeTokenManagementFrom": feature, "nativeMintOwners": minters, "parentHeadBefore": parentBefore.Hash(), "parentHeadAfter": parentAfter.Hash(), "parentUnchangedAndAlive": true, "recoveryAndAdvanceSeconds": time.Since(crashedAt).Seconds(), "exactLiveConsensusMessageCountAvailable": false, "exactLiveConsensusMessageCountScope": "Not exposed by ordinary CLI RPC; constructor-based recovery count is separate evidence", "noPreKillPauseCopyFlush": true, "ordinaryCLIUnmodified": true, "enginePolicyChanged": false, "fullDecisionCompleted": false, "allExecutionOnRunpod": true, "publicDeployment": false, "realChainSpend": 0}
	gl3CLIJSON(t, filepath.Join(out, "cli64-core-result.json"), report)
	Require(t, workerB.Process.Signal(syscall.SIGTERM))
	exitB := workerB.Wait()
	code := 0
	if exitB != nil {
		code = -999
		if x, ok := exitB.(*exec.ExitError); ok {
			code = x.ExitCode()
		}
	}
	gl3CLIJSON(t, filepath.Join(out, "cli-b-exit.json"), map[string]any{"pid": readyB.PID, "exitCode": code, "waitError": fmt.Sprint(exitB), "scope": "final graceful cleanup only; primary A exit was SIGKILL"})
	Require(t, exitB)
	gl3CLIJSON(t, filepath.Join(out, "cli64-result.json"), report)
}
