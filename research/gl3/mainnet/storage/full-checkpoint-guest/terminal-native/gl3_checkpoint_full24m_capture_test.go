//go:build gl3_acceptance && gl3_checkpoint_integration && gl3_checkpoint_capture

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

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/bridgegen"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/validator/server_common"
	"github.com/offchainlabs/nitro/validator/valnode"
)

func TestGL3CheckpointedFull24mTerminalCapture(t *testing.T) {
	out, wasm := os.Getenv("GL3_CHECKPOINT_FULL_CAPTURE_EVIDENCE"), os.Getenv("GL3_CHECKPOINT_CAPTURE_MACHINES")
	if out == "" || wasm == "" || !strings.HasPrefix(out, "/root/gl3-full-checkpoint-guest/") {
		t.Fatal("explicit owned Runpod paths required")
	}
	save := func(name string, x any) {
		t.Helper()
		data, e := json.MarshalIndent(x, "", "  ")
		Require(t, e)
		Require(t, os.WriteFile(filepath.Join(out, name), append(data, '\n'), 0600))
	}
	if os.Getenv("GL3_ALLOW_FULL24M_NATIVE_CAPTURE") != "1" {
		t.Fatal("separate root native full-search authorization required")
	}
	goldenRaw, e := os.ReadFile(os.Getenv("GL3_CHECKPOINT_GOLDEN"))
	Require(t, e)
	var golden struct {
		Passed          bool   `json:"passed"`
		Operations      uint32 `json:"operations"`
		ProgressStep    uint32 `json:"progressStep"`
		Move            string `json:"move"`
		ActualNodes     uint64 `json:"actualNodes"`
		Depth           uint32 `json:"depth"`
		InputHistory    string `json:"inputHistory"`
		FinalHistory    string `json:"finalHistory"`
		CanonicalBytes  int    `json:"canonicalBytes"`
		CanonicalSHA256 string `json:"canonicalSHA256"`
		FinalImageRoot  string `json:"finalImageRoot"`
	}
	Require(t, json.Unmarshal(goldenRaw, &golden))
	goldenDigest := sha256.Sum256(goldenRaw)
	if hex.EncodeToString(goldenDigest[:]) != "2a450f90d70bede6e9202740cb7fb205e359623e7fc11cf96a4fb6a3f1fec71a" {
		t.Fatal("immutable R37 golden bytes changed")
	}
	if !golden.Passed || golden.Operations != 2489 || golden.ProgressStep != 9955 || golden.CanonicalBytes != 163085439 || golden.FinalHistory != "e2e4 e7e5 g1f3 b8c6" || golden.Move != "b8c6" || golden.ActualNodes != 24000311 || golden.Depth != 39 || golden.InputHistory != "e2e4 e7e5 g1f3" || golden.CanonicalSHA256 != "b06a3f26b0b276c0109fb1888fa32727714ada8abb00cbec8f857bec8308068b" || golden.FinalImageRoot != "472dfc4e1923dcb78bf63c66bf53e08f03d5a50b39fdbf3fe0dc92b1933ad037" {
		t.Fatal("wrong frozen unchanged checkpointed24m golden")
	}
	goldenSum := sha256.Sum256(goldenRaw)
	save("frozen-golden.json", map[string]any{"SHA256": hex.EncodeToString(goldenSum[:]), "golden": golden})
	locator, e := server_common.NewMachineLocator(wasm)
	Require(t, e)
	root := locator.LatestWasmModuleRoot()
	if root != common.HexToHash("0x2a423e3e57903ae5bcb7385608d05387201b5cde24a7d4138d5b7ec09cb9e608") {
		t.Fatal("new checkpoint matching root required", root)
	}
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
	// Reconstruct/authenticate/compact the accepted completed image natively;
	// append only seed, checkpoint pieces, and exact A15 metadata to fresh genesis.
	job, accounts, importReport := precompiles.GhostCheckpointInitForCapture(t, b.L2Info.GetAddress("Owner"))
	sort.Slice(accounts, func(i, j int) bool { return accounts[i].Addr.Hex() < accounts[j].Addr.Hex() })
	b.L2Info.ArbInitData.Accounts = append(b.L2Info.ArbInitData.Accounts, accounts...)
	save("private-genesis-import.json", importReport)
	b.execConfig.Sequencer.MaxBlockSpeed = 100 * time.Millisecond
	b.execConfig.Sequencer.MaxRevertGasReject = 0
	b.execConfig.Sequencer.QueueTimeout = 120 * time.Second
	b.execConfig.RPC.RPCEVMTimeout = 120 * time.Second
	b.execConfig.Caching.Archive = true
	b.nodeConfig.BlockValidator.Enable = false
	b.nodeConfig.Staker.Enable = false
	b.nodeConfig.BatchPoster.Enable = true
	b.nodeConfig.ParentChainReader.Enable = true
	b.nodeConfig.ParentChainReader.OldHeaderTimeout = 10 * time.Minute
	b.nodeConfig.MessageExtraction.Enable = false
	b.WithLegacyBlockRecorder()
	valConf := valnode.TestValidationConfig
	valConf.UseJit = false
	valConf.Arbitrator.Workers = 1
	valConf.Arbitrator.Execution.CachedChallengeMachines = 2
	valConf.Arbitrator.ExecutionRunTimeout = 4 * time.Hour
	valConf.Wasm.RootPath = wasm
	_, valStack := createTestValidationNode(t, ctx, &valConf)
	configByValidationNode(b.nodeConfig, valStack)
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
		r, e := EnsureTxSucceeded(ctx, b.L2.Client, tx)
		Require(t, e)
		return r
	}
	ensure(owner.SetMaxTxGasLimit(&auth, 50_000_000))
	ensure(owner.SetMaxBlockGasLimit(&auth, 60_000_000))
	ensure(owner.SetSpeedLimit(&auth, 150_000_000))
	ensure(owner.SetGasPricingConstraints(&auth, [][3]uint64{{150_000_000, 102, 0}, {150_000_000, 600, 0}}))
	bc := b.L2.ExecNode.Backend.ArbInterface().BlockChain()
	before := bc.CurrentBlock()
	saved, e := bc.StateAt(before)
	Require(t, e)
	canonical, mem, imageRoot, e := precompiles.GhostCheckpointCanonicalForCapture(saved, b.chainConfig, before.Number.Uint64(), auth.From, job)
	Require(t, e)
	if canonical != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" || mem != 466157568 {
		t.Fatal("actual private genesis full TT/history image differs")
	}
	save("before-begin-canonical.json", map[string]any{"passed": true, "canonicalSHA256": canonical, "canonicalBytes": 163085439, "memoryBytes": mem, "imageRoot": hex.EncodeToString(imageRoot[:]), "privateChildHead": before.Hash(), "privateChildStateRoot": before.Root})
	parsed, e := abi.JSON(strings.NewReader(precompiles.GhostChessCheckpointABI))
	Require(t, e)
	address := common.HexToAddress("0xa15")
	contract := bind.NewBoundContract(address, parsed, b.L2.Client, b.L2.Client, b.L2.Client)
	inspect := func() []any {
		var output []any
		Require(t, contract.Call(&bind.CallOpts{Context: ctx, From: auth.From}, &output, "inspect", job))
		return output
	}
	initial := inspect()
	if initial[0] != uint64(2) || initial[2] != false || initial[4] != "e7e5" || initial[5] != uint64(24000033) {
		t.Fatal("wrong imported completed decision", initial)
	}
	auth.GasLimit = 50_000_000

	started := time.Now()
	receipt := ensure(contract.Transact(&auth, "begin", job, uint64(2), golden.InputHistory))
	var held uint64
	heldSet := false
	for step := uint32(1); ; step++ {
		status := inspect()
		if status[2] == false {
			break
		}
		if status[1] != step || step >= golden.Operations {
			t.Fatal("checkpointed native cursor deviates from frozen full24m golden", step, status)
		}
		if step == golden.Operations-32 {
			held = gl3HoldTerminalBatch(t, ctx, b)
			heldSet = true
		}
		receipt = ensure(contract.Transact(&auth, "advance", job, uint64(2), step))
		if step%128 == 0 {
			save("native-progress.json", map[string]any{"completedOperations": step + 1, "expectedOperationsFromGolden": golden.Operations, "stillPending": true})
		}
	}
	status := inspect()
	if !heldSet || status[1] != golden.Operations || status[2] != false || status[4] != golden.Move || status[5] != golden.ActualNodes || status[6] != golden.Depth {
		t.Fatal("unchanged completed decision mismatch", status, golden)
	}
	// The target stays the actual last compute receipt, even if a later report
	// creates another child block. Seal before any other transaction is sent.
	gl3SealTerminalBatch(t, ctx, b, receipt, held, out)
	save("terminal-receipt.json", receipt)
	header, e := b.L2.Client.HeaderByHash(ctx, receipt.BlockHash)
	Require(t, e)
	if header.Hash() != receipt.BlockHash || header.Number.Cmp(receipt.BlockNumber) != 0 {
		t.Fatal("wrong actual compute header")
	}
	completedDB, e := bc.StateAt(header)
	Require(t, e)
	completed, e := precompiles.GhostCheckpointCompletedStateForCapture(completedDB, b.chainConfig, header.Number.Uint64(), auth.From, job)
	Require(t, e)
	if completed["canonicalSHA256"] != golden.CanonicalSHA256 || completed["canonicalBytes"] != golden.CanonicalBytes || completed["imageRoot"] != golden.FinalImageRoot || completed["history"] != golden.FinalHistory || completed["progressStep"] != golden.ProgressStep {
		t.Fatal("full canonical/TT/history at exact computeN differs", completed)
	}
	completed["actualComputeBlockNumber"] = header.Number.Uint64()
	completed["actualComputeBlockHash"] = header.Hash()
	save("terminal-canonical.json", completed)
	pos, e := arbutil.BlockNumberToMessageIndex(receipt.BlockNumber.Uint64(), b.chainConfig.ArbitrumChainParams.GenesisBlockNum)
	Require(t, e)
	batch, found, e := b.L2.ConsensusNode.InboxTracker.FindInboxBatchContainingMessage(pos)
	Require(t, e)
	if !found {
		t.Fatal("real parent batch missing")
	}
	metadata, e := b.L2.ConsensusNode.InboxTracker.GetBatchMetadata(batch)
	Require(t, e)
	if uint64(metadata.MessageCount) != uint64(pos)+1 {
		t.Fatal("terminal message is not exact batch endpoint")
	}
	seq, e := bridgegen.NewSequencerInbox(b.addresses.SequencerInbox, b.L1.Client)
	Require(t, e)
	parentNumber := new(big.Int).SetUint64(metadata.ParentChainBlock)
	logs, e := b.L1.Client.FilterLogs(ctx, ethereum.FilterQuery{FromBlock: parentNumber, ToBlock: parentNumber, Addresses: []common.Address{b.addresses.SequencerInbox}})
	Require(t, e)
	matches := 0
	for _, log := range logs {
		event, err := seq.ParseSequencerBatchDelivered(log)
		if err != nil || !event.BatchSequenceNumber.IsUint64() || event.BatchSequenceNumber.Uint64() != batch {
			continue
		}
		parentReceipt, e := b.L1.Client.TransactionReceipt(ctx, log.TxHash)
		Require(t, e)
		if parentReceipt.Status != types.ReceiptStatusSuccessful || parentReceipt.BlockNumber.Cmp(parentNumber) != 0 || parentReceipt.BlockHash != log.BlockHash || event.AfterAcc != [32]byte(metadata.Accumulator) {
			t.Fatal("parent batch receipt/event mismatch")
		}
		save("parent-batch-receipt.json", parentReceipt)
		save("parent-batch-event.json", event)
		matches++
	}
	if matches != 1 {
		t.Fatal("exact parent batch event missing or ambiguous", matches)
	}
	input, e := b.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, pos, rawdb.LocalTarget(), rawdb.TargetWasm)
	Require(t, e)
	if input.ExpectedEndState == nil || input.ExpectedEndState.BlockHash != receipt.BlockHash || input.ExpectedEndState.PosInBatch != 0 || input.ExpectedEndState.Batch != batch+1 {
		t.Fatal("recorded input differs from exact sealed terminal transaction", input.ExpectedEndState)
	}
	encoded, e := input.Marshal()
	Require(t, e)
	sum := sha256.Sum256(encoded)
	Require(t, os.WriteFile(filepath.Join(out, "terminal-input.json"), encoded, 0600))
	save("capture-manifest.json", map[string]any{"passed": true, "scope": "actual private native unchanged24m checkpointed terminal compute capture; no guest terminal replay/dispute/20game/production acceptance", "moduleRoot": root, "blockNumber": receipt.BlockNumber, "blockHash": receipt.BlockHash, "stateRoot": header.Root, "receiptHash": header.ReceiptHash, "gasUsed": receipt.GasUsed, "headerGasUsed": header.GasUsed, "transactionHash": receipt.TxHash, "messageIndex": pos, "parentBatch": batch, "parentBatchMetadata": metadata, "parentBatchReceiptEventVerified": true, "inputSHA256": hex.EncodeToString(sum[:]), "inputBytes": len(encoded), "inputFile": "terminal-input.json", "startState": input.StartState, "expectedEndState": input.ExpectedEndState, "progress": status, "fullSearchExecuted": true, "move": golden.Move, "actualNodes": golden.ActualNodes, "depth": golden.Depth, "operationsFromFrozenGolden": golden.Operations, "progressStepFromFrozenGolden": golden.ProgressStep, "fullCanonicalExactAtComputeN": true, "nativeFullCaptureSeconds": time.Since(started).Seconds(), "guestReplayExecuted": false, "guestProofAccepted": false, "productionAccepted": false, "allExecutionOnRunpod": true})
}

func cpTerminalWrite(t *testing.T, out, name string, x any) {
	t.Helper()
	data, e := json.MarshalIndent(x, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(out, name), append(data, '\n'), 0600))
}
