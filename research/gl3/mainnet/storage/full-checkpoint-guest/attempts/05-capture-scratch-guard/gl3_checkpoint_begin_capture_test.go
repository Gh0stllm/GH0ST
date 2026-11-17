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

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/validator/server_common"
	"github.com/offchainlabs/nitro/validator/valnode"
)

func TestGL3CheckpointedBeginBlockCapture(t *testing.T) {
	out, wasm := os.Getenv("GL3_CHECKPOINT_CAPTURE_EVIDENCE"), os.Getenv("GL3_CHECKPOINT_CAPTURE_MACHINES")
	if out == "" || wasm == "" || !strings.HasPrefix(out, "/root/gl3-full-checkpoint-guest/") {
		t.Fatal("explicit owned Runpod paths required")
	}
	save := func(name string, x any) {
		t.Helper()
		data, e := json.MarshalIndent(x, "", "  ")
		Require(t, e)
		Require(t, os.WriteFile(filepath.Join(out, name), append(data, '\n'), 0600))
	}
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
	receipt := ensure(contract.Transact(&auth, "begin", job, uint64(2), "e2e4 e7e5 g1f3"))
	seconds := time.Since(started).Seconds()
	status := inspect()
	if status[1] != uint32(1) || status[2] != true {
		t.Fatal("single original grouped operation must remain pending", status)
	}
	save("begin-receipt.json", receipt)
	header, e := b.L2.Client.HeaderByHash(ctx, receipt.BlockHash)
	Require(t, e)
	pos, e := arbutil.BlockNumberToMessageIndex(receipt.BlockNumber.Uint64(), b.chainConfig.ArbitrumChainParams.GenesisBlockNum)
	Require(t, e)
	waitForBatchContainingMessage(t, b.L2.ConsensusNode, pos, 120*time.Second, 250*time.Millisecond)
	batch, found, e := b.L2.ConsensusNode.InboxTracker.FindInboxBatchContainingMessage(pos)
	Require(t, e)
	if !found {
		t.Fatal("real private parent batch missing")
	}
	metadata, e := b.L2.ConsensusNode.InboxTracker.GetBatchMetadata(batch)
	Require(t, e)
	input, e := b.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, pos, rawdb.LocalTarget(), rawdb.TargetWasm)
	Require(t, e)
	if input.ExpectedEndState == nil || input.ExpectedEndState.BlockHash != receipt.BlockHash {
		t.Fatal("recorded input does not end at exact Begin block")
	}
	encoded, e := input.Marshal()
	Require(t, e)
	sum := sha256.Sum256(encoded)
	Require(t, os.WriteFile(filepath.Join(out, "begin-input.json"), encoded, 0600))
	save("capture-manifest.json", map[string]any{"passed": true, "scope": "actual private Nitro A15 checkpointed Begin progress block, four original quanta only; not completed decision, terminal proof or20games", "moduleRoot": root, "blockNumber": receipt.BlockNumber, "blockHash": receipt.BlockHash, "stateRoot": header.Root, "receiptHash": header.ReceiptHash, "gasUsed": receipt.GasUsed, "headerGasUsed": header.GasUsed, "transactionHash": receipt.TxHash, "messageIndex": pos, "parentBatch": batch, "parentBatchMetadata": metadata, "inputSHA256": hex.EncodeToString(sum[:]), "inputBytes": len(encoded), "inputFile": "begin-input.json", "startState": input.StartState, "expectedEndState": input.ExpectedEndState, "progress": status, "originalQuantaRequested": 4, "fullSearchExecuted": false, "preBeginCanonicalExact": true, "nativeBeginReceiptSeconds": seconds, "guestReplayExecuted": false, "guestProofAccepted": false, "productionAccepted": false, "allExecutionOnRunpod": true})
}
