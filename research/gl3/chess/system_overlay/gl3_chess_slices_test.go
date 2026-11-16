package arbtest

import (
	"context"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/execution/gethexec"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/statetransfer"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/valnode"
)

func TestGL3ChessSlicesBlocksAndReplay(t *testing.T) {
	outDir, wasmDir := os.Getenv("GL3_SLICES_BLOCK_EVIDENCE"), os.Getenv("GL3_SLICES_WASM_ROOT")
	if outDir == "" || wasmDir == "" {
		t.Fatal("explicit evidence and sliced machine directories required")
	}
	Require(t, os.MkdirAll(outDir, 0700))
	// Prepare the complete deterministic initialized image BEFORE genesis. The
	// state transition uses only its authenticated chain bytes thereafter.
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
	b := NewNodeBuilder(ctx).DefaultConfig(t, true).WithPreBoldDeployment()
	b.DontParalellise().WithArbOSVersion(61).WithLegacyBlockRecorder().WithWasmRootDir(wasmDir)
	b.takeOwnership = false
	b.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = false
	b.chainConfig.ArbitrumChainParams.InitialChainOwner = b.L2Info.GetAddress("Owner")
	// The generic fixture gives Owner nearly2^256 wei. It is also this chain's
	// fee recipient, so use a realistic artificial balance instead of wrapping
	// that synthetic maximum as fees are credited back.
	for i := range b.L2Info.ArbInitData.Accounts {
		if b.L2Info.ArbInitData.Accounts[i].Addr == b.L2Info.GetAddress("Owner") {
			b.L2Info.ArbInitData.Accounts[i].EthBalance = new(big.Int).Exp(big.NewInt(10), big.NewInt(21), nil)
		}
	}
	b.execConfig.Sequencer.MaxBlockSpeed = 100 * time.Millisecond
	b.execConfig.Sequencer.MaxRevertGasReject = 0
	b.execConfig.Sequencer.QueueTimeout = 30 * time.Second
	b.execConfig.RPC.RPCEVMTimeout = 30 * time.Second
	b.RequireScheme(t, rawdb.HashScheme)
	b.nodeConfig.BlockValidator.Enable = false
	b.nodeConfig.Staker.Enable = true
	b.nodeConfig.BatchPoster.Enable = true
	b.nodeConfig.ParentChainReader.Enable = true
	b.nodeConfig.ParentChainReader.OldHeaderTimeout = 10 * time.Minute
	valConf := valnode.TestValidationConfig
	valConf.UseJit = false
	valConf.Wasm.RootPath = wasmDir
	_, valStack := createTestValidationNode(t, ctx, &valConf)
	configByValidationNode(b.nodeConfig, valStack)
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
	// Match the research tariff to one ~12m-gas operation per100ms. This is an
	// explicit local configuration, not reviewed public pricing/capacity.
	ensure(owner.SetSpeedLimit(&auth, 150_000_000))
	ensure(owner.SetGasPricingConstraints(&auth, [][3]uint64{{150_000_000, 102, 0}, {150_000_000, 600, 0}}))
	parsed, e := abi.JSON(strings.NewReader(precompiles.GhostChessSlicesABI))
	Require(t, e)
	address := common.HexToAddress("0xa14")
	job := [32]byte{31}
	send := func(name string, args ...any) (*types.Receipt, float64) {
		t.Helper()
		data, e := parsed.Pack(name, args...)
		Require(t, e)
		tx := b.L2Info.PrepareTxTo("Owner", &address, 13_800_000, new(big.Int), data)
		start := time.Now()
		Require(t, b.L2.Client.SendTransaction(ctx, tx))
		receipt, e := EnsureTxSucceeded(ctx, b.L2.Client, tx)
		Require(t, e)
		return receipt, time.Since(start).Seconds()
	}
	// The development code-overwrite capability must be unavailable on this chain.
	debugABI, e := abi.JSON(strings.NewReader(precompilesgen.ArbDebugMetaData.ABI))
	Require(t, e)
	bad, e := debugABI.Pack("overwriteContractCode", common.HexToAddress("0x123456"), []byte{0})
	Require(t, e)
	debugAddr := common.HexToAddress("0xff")
	if _, e = b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: auth.From, To: &debugAddr, Data: bad, Gas: 200000}, nil); e == nil {
		t.Fatal("ArbDebug code writer enabled")
	}
	_, newGameSeconds := send("newGame", job)
	beginReceipt, beginSeconds := send("begin", job, uint64(1), "e2e4")
	// Continuous independent traffic must receive receipts while this search is
	// pending; it is not sent after the chess result has already completed.
	trafficCtx, stopTraffic := context.WithCancel(ctx)
	var lock sync.Mutex
	traffic := []map[string]any{}
	done := make(chan error, 1)
	go func() {
		for trafficCtx.Err() == nil {
			tx := b.L2Info.PrepareTx("Faucet", "Faucet", 200000, big.NewInt(1), nil)
			at := time.Now()
			e := b.L2.Client.SendTransaction(trafficCtx, tx)
			if e != nil {
				if trafficCtx.Err() != nil {
					done <- nil
				} else {
					done <- e
				}
				return
			}
			receipt, e := EnsureTxSucceeded(trafficCtx, b.L2.Client, tx)
			if e != nil {
				if trafficCtx.Err() != nil {
					done <- nil
				} else {
					done <- e
				}
				return
			}
			lock.Lock()
			traffic = append(traffic, map[string]any{"tx": receipt.TxHash, "block": receipt.BlockNumber, "seconds": time.Since(at).Seconds()})
			lock.Unlock()
		}
		done <- nil
	}()
	rows := []map[string]any{}
	last := beginReceipt
	for step := uint32(1); step <= 128; step++ {
		receipt, sec := send("advance", job, uint64(1), step)
		rows = append(rows, map[string]any{"step": step + 1, "tx": receipt.TxHash, "block": receipt.BlockNumber, "seconds": sec, "gasUsed": receipt.GasUsed})
		last = receipt
	}
	stopTraffic()
	Require(t, <-done)
	lock.Lock()
	trafficCopy := append([]map[string]any(nil), traffic...)
	lock.Unlock()
	if len(trafficCopy) < 32 {
		t.Fatal("too few simultaneous ordinary transfers", len(trafficCopy))
	}
	data, e := parsed.Pack("inspect", job)
	Require(t, e)
	out, e := b.L2.Client.CallContract(ctx, ethereum.CallMsg{From: auth.From, To: &address, Data: data}, last.BlockNumber)
	Require(t, e)
	status, e := parsed.Unpack("inspect", out)
	Require(t, e)
	if status[1] != uint32(129) || status[2] != true || status[4] != "" {
		t.Fatal("partial result/cursor", status)
	}
	// Record one actual engine-bearing block after timing has stopped. Recording
	// deliberately destroys the warm path and must independently rebuild it.
	pos, e := arbutil.BlockNumberToMessageIndex(beginReceipt.BlockNumber.Uint64(), b.chainConfig.ArbitrumChainParams.GenesisBlockNum)
	Require(t, e)
	waitForBatchContainingMessage(t, b.L2.ConsensusNode, pos, 30*time.Second, 250*time.Millisecond)
	var input server_api.InputJSON
	retryUntilFound(t, ctx, 100, 250*time.Millisecond, "sliced ValidationInputsAt", "batch not found", func() error {
		var e error
		input, e = b.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, pos, rawdb.LocalTarget(), rawdb.TargetWasm)
		return e
	})
	encoded, e := input.Marshal()
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(outDir, "input.json"), encoded, 0600))
	header, e := b.L2.Client.HeaderByNumber(ctx, beginReceipt.BlockNumber)
	Require(t, e)
	report := map[string]any{"scope": "actual local Nitro blocks during a pending full-strength search; recorded complete first-slice block; not a complete chess game or fraud dispute", "passed": true, "blockTargetMS": 100, "singleComputeSlicePerBlock": true, "debugPrecompilesEnabled": false, "blockingA13Registered": false, "maxTxGas": 14000000, "maxBlockGas": 15000000, "researchGasTargetPerSecond": 150000000, "newGameSeconds": newGameSeconds, "coldBeginSeconds": beginSeconds, "chessRows": rows, "simultaneousOrdinaryTransfers": trafficCopy, "recordedBlock": beginReceipt.BlockNumber, "recordedBlockHash": header.Hash(), "recordedStateRoot": header.Root, "inputBytes": len(encoded), "fixedSearchTarget": sliced.TargetNodes, "pending": true, "publicDeployment": false, "realSpend": 0, "stateScheme": gethexec.BlockRecorderModeLegacy}
	encoded, e = json.MarshalIndent(report, "", "  ")
	Require(t, e)
	Require(t, os.WriteFile(filepath.Join(outDir, "results.json"), append(encoded, '\n'), 0600))
	// Keep the compiler checking the actual EVM StateDB type at the genesis seam.
	var _ vm.StateDB = recorder
}
