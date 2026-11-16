//go:build gl3_acceptance && challengetest

// SPDX-License-Identifier: GPL-3.0-or-later
package arbtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
	"github.com/offchainlabs/nitro/arbnode/parent"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/statetransfer"
	"github.com/offchainlabs/nitro/util/headerreader"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/server_common"
	"github.com/offchainlabs/nitro/validator/valnode"
)

// This fixture is derived from the accepted full-strength native capture.
// Only the test-chain deployment and subsequent challenge lifecycle differ.
func TestGL3TerminalResultBoLDLifecycle(t *testing.T) {
	blockChallengeLeafHeight = 8192
	runGL3DisputeNodeFixture(t, false)
}

func runGL3DisputeNodeFixture(t *testing.T, restartDuringSearch bool) {
	out, wasm := os.Getenv("GL3_RESTART_EVIDENCE"), os.Getenv("GL3_SLICES_WASM_ROOT")
	if out == "" || wasm == "" {
		t.Fatal("explicit evidence and custom-machine root paths required")
	}
	Require(t, os.MkdirAll(out, 0700))
	captureTerminal := os.Getenv("GL3_RESTART_CAPTURE_TERMINAL") == "1"
	locator, e := server_common.NewMachineLocator(wasm)
	Require(t, e)
	moduleRoot := locator.LatestWasmModuleRoot()
	if captureTerminal && moduleRoot != common.HexToHash("0xc03cf6f44fe1ca3c0826064ba7e5a3c134dc0013a9b994f3355f2ba185116c00") {
		t.Fatal("terminal dispute capture requires the reviewed lazy proof machine", moduleRoot)
	}
	started := time.Now()
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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := NewNodeBuilder(ctx).DefaultConfig(t, true).DontParalellise().WithArbOSVersion(61).WithDatabase(rawdb.DBPebble).WithWasmRootDir(wasm)
	b.RequireScheme(t, rawdb.HashScheme)
	b.takeOwnership = false
	b.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	b.chainConfig.ArbitrumChainParams.InitialChainOwner = b.L2Info.GetAddress("Owner")
	for i := range b.L2Info.ArbInitData.Accounts {
		if b.L2Info.ArbInitData.Accounts[i].Addr == b.L2Info.GetAddress("Owner") {
			b.L2Info.ArbInitData.Accounts[i].EthBalance = new(big.Int).Exp(big.NewInt(10), big.NewInt(21), nil)
		}
	}
	b.execConfig.Sequencer.MaxBlockSpeed = 100 * time.Millisecond
	b.execConfig.Sequencer.MaxRevertGasReject = 0
	b.execConfig.Sequencer.QueueTimeout = 60 * time.Second
	b.execConfig.RPC.RPCEVMTimeout = 60 * time.Second
	b.execConfig.Caching.Archive = true
	b.nodeConfig.BlockValidator.Enable = false
	b.nodeConfig.Staker.Enable = false
	b.nodeConfig.BatchPoster.Enable = false
	b.nodeConfig.ParentChainReader.Enable = true
	b.nodeConfig.ParentChainReader.OldHeaderTimeout = 10 * time.Minute
	if captureTerminal {
		b.nodeConfig.MessageExtraction.Enable = false
		b.WithLegacyBlockRecorder()
		b.nodeConfig.Staker.Enable = false
		b.nodeConfig.BatchPoster.Enable = true
		valConf := valnode.TestValidationConfig
		valConf.UseJit = false
		valConf.Arbitrator.Workers = 1
		valConf.Arbitrator.Execution.CachedChallengeMachines = 2
		valConf.Arbitrator.ExecutionRunTimeout = 4 * time.Hour
		valConf.Wasm.RootPath = wasm
		_, valStack := createTestValidationNode(t, ctx, &valConf)
		configByValidationNode(b.nodeConfig, valStack)
	}
	addresses := make([]common.Address, 0, len(recorder.accounts))
	for a := range recorder.accounts {
		addresses = append(addresses, a)
	}
	sort.Slice(addresses, func(i, j int) bool { return addresses[i].Hex() < addresses[j].Hex() })
	for _, a := range addresses {
		b.L2Info.ArbInitData.Accounts = append(b.L2Info.ArbInitData.Accounts, statetransfer.AccountInitializationInfo{Addr: a, Nonce: 1, EthBalance: new(big.Int), ContractInfo: recorder.accounts[a]})
	}
	cleanup := b.Build(t)
	defer cleanup()
	go keepChainMoving(t, 500*time.Millisecond, ctx, b.L1Info, b.L1.Client)
	auth := b.L2Info.GetDefaultTransactOpts("Owner", ctx)
	auth.GasLimit = 2_000_000
	owner, e := precompilesgen.NewArbOwner(common.HexToAddress("0x70"), b.L2.Client)
	Require(t, e)
	ensure := func(tx *types.Transaction, e error) *types.Receipt {
		t.Helper()
		Require(t, e)
		receipt, e := EnsureTxSucceeded(ctx, b.L2.Client, tx)
		Require(t, e)
		return receipt
	}
	ensure(owner.SetMaxTxGasLimit(&auth, 14_000_000))
	ensure(owner.SetMaxBlockGasLimit(&auth, 15_000_000))
	ensure(owner.SetSpeedLimit(&auth, 150_000_000))
	ensure(owner.SetGasPricingConstraints(&auth, [][3]uint64{{150_000_000, 102, 0}, {150_000_000, 600, 0}}))
	parsed, e := abi.JSON(strings.NewReader(precompiles.GhostChessSlicesABI))
	Require(t, e)
	address, job := common.HexToAddress("0xa14"), [32]byte{51}
	backingChecks := []map[string]any{}
	assertBackingControls := func(label string) {
		t.Helper()
		public, e := precompilesgen.NewArbOwnerPublic(types.ArbOwnerPublicAddress, b.L2.Client)
		Require(t, e)
		enabled, e := public.GetNativeTokenManagementFrom(&bind.CallOpts{Context: ctx})
		Require(t, e)
		minters, e := public.GetAllNativeTokenOwners(&bind.CallOpts{Context: ctx})
		Require(t, e)
		if enabled != 0 || len(minters) != 0 {
			t.Fatal("unbacked native supply control enabled", enabled, minters)
		}
		ownerABI, e := precompilesgen.ArbOwnerMetaData.GetAbi()
		Require(t, e)
		mintABI, e := precompilesgen.ArbNativeTokenManagerMetaData.GetAbi()
		Require(t, e)
		head, e := b.L2.Client.HeaderByNumber(ctx, nil)
		Require(t, e)
		mint, e := mintABI.Pack("mintNativeToken", big.NewInt(1))
		Require(t, e)
		addMinter, e := ownerABI.Pack("addNativeTokenOwner", auth.From)
		Require(t, e)
		immediate, e := ownerABI.Pack("setNativeTokenManagementFrom", head.Time)
		Require(t, e)
		future, e := ownerABI.Pack("setNativeTokenManagementFrom", head.Time+8*24*60*60)
		Require(t, e)
		checks := []struct {
			name string
			from common.Address
			to   common.Address
			data []byte
		}{
			{"owner_mint_disabled", auth.From, types.ArbNativeTokenManagerAddress, mint},
			{"unauthorized_mint_disabled", b.L2Info.GetAddress("Faucet"), types.ArbNativeTokenManagerAddress, mint},
			{"owner_cannot_add_minter_while_disabled", auth.From, types.ArbOwnerAddress, addMinter},
			{"owner_cannot_enable_without_delay", auth.From, types.ArbOwnerAddress, immediate},
			{"unauthorized_cannot_schedule_enable", b.L2Info.GetAddress("Faucet"), types.ArbOwnerAddress, future},
		}
		executionRejections := []map[string]any{}
		for _, check := range checks {
			_, callErr := b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: check.from, To: &check.to, Gas: 30_000_000, Data: check.data}, nil)
			classified, classErr := gl3ClassifyExecutionRejection(callErr, check.name == "unauthorized_cannot_schedule_enable")
			if classErr != nil {
				t.Fatal("native supply control lacked an actual execution rejection", check.name, classErr)
			}
			classified["case"] = check.name
			classified["selector"] = "0x" + hex.EncodeToString(check.data[:4])
			executionRejections = append(executionRejections, classified)
		}
		backingChecks = append(backingChecks, map[string]any{"label": label, "nativeTokenManagementFrom": enabled, "nativeMintOwners": minters, "ownerAndUnauthorizedMintRejected": true, "disabledAddMinterRejected": true, "immediateOwnerEnableRejected": true, "unauthorizedFutureEnableRejected": true, "executionRejections": executionRejections, "scope": "research genesis with mint feature disabled; privileged owner still has delayed configuration/upgrade powers, and research balances are artificial"})
	}
	assertBackingControls("before_search")
	var lastReceipt *types.Receipt
	send := func(name string, args ...any) *types.Receipt {
		t.Helper()
		data, e := parsed.Pack(name, args...)
		Require(t, e)
		tx := b.L2Info.PrepareTxTo("Owner", &address, 13_800_000, new(big.Int), data)
		Require(t, b.L2.Client.SendTransaction(ctx, tx))
		lastReceipt = ensure(tx, nil)
		return lastReceipt
	}
	inspect := func() []any {
		t.Helper()
		data, e := parsed.Pack("inspect", job)
		Require(t, e)
		got, e := b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: auth.From, To: &address, Data: data}, nil)
		Require(t, e)
		values, e := parsed.Unpack("inspect", got)
		Require(t, e)
		return values
	}
	send("newGame", job)
	send("begin", job, uint64(1), "e2e4")
	restarts := []map[string]any{}
	for step := uint32(1); step <= 2463; step++ {
		// Both an early pending frame and a late, long-delta-chain pending frame
		// must survive lifecycle closure without a retained native engine VM.
		if restartDuringSearch && (step == 64 || step == 2048) {
			before := inspect()
			header, e := b.L2.Client.HeaderByNumber(ctx, nil)
			Require(t, e)
			if before[1] != step || before[2] != true || before[4] != "" {
				t.Fatal("unexpected pending cursor", before, step)
			}
			oldDataDir := b.dataDir
			restartStarted := time.Now()
			b.StopL2ForRestart(ctx)
			cleared := precompiles.GhostChessDropCachesForAcceptance()
			if cleared == 0 {
				t.Fatal("no live VM cache discarded at restart")
			}
			b.L2.cleanup = func() {}
			// The upstream RestartL2Node helper is documented L2-only. Its old
			// parent poller was stopped by cleanup and must not be reused here.
			b.L1.ctx = b.ctx
			arbSys, e := precompilesgen.NewArbSys(types.ArbSysAddress, b.L1.Client)
			Require(t, e)
			reader, e := headerreader.New(b.ctx, b.L1.Client, func() *headerreader.Config { return &headerreader.TestConfig }, arbSys)
			Require(t, e)
			reader.Start(b.ctx)
			t.Cleanup(reader.StopAndWait)
			freshParent := parent.NewParentChain(b.ctx, big.NewInt(1337), reader)
			b.L2.ExecNode.ParentChain = freshParent
			b.L2.ConsensusNode.ParentChain = freshParent
			b.RestartL2Node(t)
			assertBackingControls("after_restart")
			if b.dataDir != oldDataDir {
				t.Fatal("restart used a different database directory")
			}
			reopened, e := b.L2.Client.HeaderByNumber(ctx, nil)
			Require(t, e)
			if reopened.Hash() != header.Hash() || reopened.Root != header.Root {
				t.Fatal("persisted head/root changed during restart", header.Hash(), reopened.Hash())
			}
			after := inspect()
			b0, _ := json.Marshal(before)
			b1, _ := json.Marshal(after)
			if string(b0) != string(b1) {
				t.Fatal("persisted chess cursor/result/root changed", before, after)
			}
			// The first real post-restart advance must reconstruct committed pages
			// and continue at exactly the old cursor, with debug writers disabled.
			receipt := send("advance", job, uint64(1), step)
			restarts = append(restarts, map[string]any{"cursorBefore": step, "headHash": header.Hash(), "stateRoot": header.Root, "sameDatabaseReopened": true, "discardedNativeVMs": cleared, "persistedInspectMatches": true, "firstResumedTx": receipt.TxHash, "resumeIncludingRestartSeconds": time.Since(restartStarted).Seconds()})
			continue
		}
		send("advance", job, uint64(1), step)
		if step%128 == 0 {
			progress := map[string]any{"cursor": step + 1, "completedComputeTransactions": step + 1, "totalExpectedComputeTransactions": 2464, "scope": "actual mined research fixture progress; not a completed decision"}
			encoded, _ := json.Marshal(progress)
			Require(t, os.WriteFile(filepath.Join(out, "progress.json"), append(encoded, '\n'), 0600))
			t.Logf("Mined compute cursor %d/2464", step+1)
		}
	}
	status := inspect()
	assertBackingControls("after_complete_decision")
	if status[1] != uint32(2464) || status[2] != false || status[4] != "e7e5" || status[5] != uint64(24000033) || status[6] != uint32(38) {
		t.Fatal("fixed full-strength result changed", status)
	}
	bc := b.L2.ExecNode.Backend.ArbInterface().BlockChain()
	header := bc.CurrentBlock()
	saved, e := bc.StateAt(header)
	Require(t, e)
	canonicalStarted := time.Now()
	canonicalSHA, canonicalBytes, imageRoot, deltaCount, e := precompiles.GhostChessCanonicalForAcceptance(saved, b.chainConfig, header.Number.Uint64(), auth.From, job)
	Require(t, e)
	if canonicalSHA != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" || canonicalBytes != 163085439 {
		t.Fatal("complete retained state changed after recovery", canonicalSHA, canonicalBytes)
	}
	canonicalSeconds := time.Since(canonicalStarted).Seconds()
	terminalCapture := map[string]any{"requested": captureTerminal, "completed": false}
	if captureTerminal {
		pos, e := arbutil.BlockNumberToMessageIndex(lastReceipt.BlockNumber.Uint64(), b.chainConfig.ArbitrumChainParams.GenesisBlockNum)
		Require(t, e)
		waitForBatchContainingMessage(t, b.L2.ConsensusNode, pos, 120*time.Second, 250*time.Millisecond)
		batch, found, e := b.L2.ConsensusNode.InboxTracker.FindInboxBatchContainingMessage(pos)
		Require(t, e)
		if !found {
			t.Fatal("terminal block not included in actual private parent batch")
		}
		batchMeta, e := b.L2.ConsensusNode.InboxTracker.GetBatchMetadata(batch)
		Require(t, e)
		captureStarted := time.Now()
		input, e := b.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, pos, rawdb.LocalTarget(), rawdb.TargetWasm)
		Require(t, e)
		if input.ExpectedEndState == nil || input.ExpectedEndState.BlockHash != lastReceipt.BlockHash {
			t.Fatal("terminal capture expected block differs from terminal compute receipt")
		}
		encoded, e := input.Marshal()
		Require(t, e)
		sum := sha256.Sum256(encoded)
		Require(t, os.WriteFile(filepath.Join(out, "terminal-input.json"), encoded, 0600))
		terminalCapture = map[string]any{"requested": true, "completed": true, "file": "terminal-input.json", "bytes": len(encoded), "SHA256": hex.EncodeToString(sum[:]), "seconds": time.Since(captureStarted).Seconds(), "blockNumber": lastReceipt.BlockNumber, "blockHash": lastReceipt.BlockHash, "terminalComputeTx": lastReceipt.TxHash, "parentBatch": batch, "parentBatchMetadata": batchMeta, "startState": input.StartState, "expectedEndState": input.ExpectedEndState, "moduleRoot": moduleRoot}
		manifest, e := json.MarshalIndent(terminalCapture, "", "  ")
		Require(t, e)
		Require(t, os.WriteFile(filepath.Join(out, "terminal-input-manifest.json"), append(manifest, '\n'), 0600))
	}
	scope := "actual private Nitro execution+consensus lifecycle close/reopen over the same Pebble database, with explicit VM cache destruction during an unchanged full24m decision; same OS process, not crash/power-loss or separate-process daemon recovery"
	if !restartDuringSearch {
		scope = "actual private Nitro full-strength terminal compute block capture and backing-control checks; no node restart or full dispute executed"
	}
	report := map[string]any{"passed": true, "scope": scope, "gracefulNodeRestartTest": restartDuringSearch, "restarts": restarts, "backingControlChecks": backingChecks, "researchGenesisBalancesArtificial": true, "fullDecision": true, "canonicalCheckpointSHA256": canonicalSHA, "canonicalBytes": canonicalBytes, "portableImageRoot": imageRoot, "deltaCount": deltaCount, "canonicalColdReconstructionSeconds": canonicalSeconds, "fixtureSeconds": time.Since(started).Seconds(), "move": status[4], "nodes": status[5], "depth": status[6], "blockTargetMS": 100, "databaseEngine": "pebble", "stateScheme": "hash", "archiveFixture": true, "debugPrecompilesEnabled": false, "terminalBlockCapture": terminalCapture, "moduleRoot": moduleRoot, "publicDeployment": false, "realChainSpend": 0}
	encoded, e := json.MarshalIndent(report, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(out, "sequencer-lifecycle-recovery.json"), append(encoded, '\n'), 0600))
	t.Log(string(encoded))
	if !captureTerminal {
		t.Fatal("full lifecycle requires captured terminal input")
	}
	final, ok := terminalCapture["expectedEndState"].(*validator.GoGlobalState)
	if !ok || final == nil {
		t.Fatal("missing terminal state")
	}
	gl3RunTerminalChallenge(t, ctx, b, lastReceipt, *final, out)
}
