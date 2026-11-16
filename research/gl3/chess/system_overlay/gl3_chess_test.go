package arbtest

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/offchainlabs/nitro/arbutil"
	"github.com/offchainlabs/nitro/precompiles"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"github.com/offchainlabs/nitro/statetransfer"
	"github.com/offchainlabs/nitro/validator/server_api"
)

// This recorder only prepares authenticated genesis data before any chain starts.
// It is not an oracle and is never invoked by block execution or replay.
type chessGenesisRecorder struct {
	vm.StateDB
	accounts map[common.Address]*statetransfer.AccountInitContractInfo
}

func (r *chessGenesisRecorder) account(a common.Address) *statetransfer.AccountInitContractInfo {
	x := r.accounts[a]
	if x == nil {
		x = &statetransfer.AccountInitContractInfo{ContractStorage: map[common.Hash]common.Hash{}}
		r.accounts[a] = x
	}
	return x
}
func (r *chessGenesisRecorder) SetCode(a common.Address, code []byte, reason tracing.CodeChangeReason) []byte {
	r.account(a).Code = append([]byte(nil), code...)
	return r.StateDB.SetCode(a, code, reason)
}
func (r *chessGenesisRecorder) SetState(a common.Address, k, v common.Hash) common.Hash {
	r.account(a).ContractStorage[k] = v
	return r.StateDB.SetState(a, k, v)
}

func TestGL3ChessMinedBlockAndInputs(t *testing.T) {
	modelPath, outDir, wasmDir := os.Getenv("GL3_CHESS_MODEL"), os.Getenv("GL3_CHESS_BLOCK_EVIDENCE"), os.Getenv("GL3_CHESS_WASM_ROOT")
	if modelPath == "" || outDir == "" || wasmDir == "" {
		t.Fatal("explicit model, evidence and custom machine paths required")
	}
	Require(t, os.MkdirAll(outDir, 0700))
	_ = os.Remove(filepath.Join(outDir, "hold-ready.json"))
	_ = os.Remove(filepath.Join(outDir, "release-hold"))
	weights, err := os.ReadFile(modelPath)
	Require(t, err)
	db, err := state.New(types.EmptyRootHash, state.NewDatabaseForTesting())
	Require(t, err)
	recorder := &chessGenesisRecorder{StateDB: db, accounts: map[common.Address]*statetransfer.AccountInitContractInfo{}}
	Require(t, precompiles.SeedGhostChessGenesis(recorder, weights))
	weights = nil
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	builder, auth, cleanup := setupProgramTest(t, false, func(b *NodeBuilder) {
		b.DontParalellise().WithArbOSVersion(61).WithLegacyBlockRecorder().WithWasmRootDir(wasmDir)
		b.chainConfig.ArbitrumChainParams.AllowDebugPrecompiles = true
		b.execConfig.Sequencer.QueueTimeout = 2 * time.Minute
		b.execConfig.RPC.RPCEVMTimeout = 2 * time.Minute
		addresses := make([]common.Address, 0, len(recorder.accounts))
		for a := range recorder.accounts {
			addresses = append(addresses, a)
		}
		sort.Slice(addresses, func(i, j int) bool { return addresses[i].Hex() < addresses[j].Hex() })
		for _, a := range addresses {
			b.L2Info.ArbInitData.Accounts = append(b.L2Info.ArbInitData.Accounts, statetransfer.AccountInitializationInfo{Addr: a, Nonce: 1, EthBalance: new(big.Int), ContractInfo: recorder.accounts[a]})
		}
	})
	defer cleanup()
	owner, err := precompilesgen.NewArbOwner(common.HexToAddress("0x70"), builder.L2.Client)
	Require(t, err)
	ensure := func(tx *types.Transaction, e error) *types.Receipt {
		t.Helper()
		Require(t, e)
		receipt, e := EnsureTxSucceeded(ctx, builder.L2.Client, tx)
		Require(t, e)
		return receipt
	}
	// Explicit local research limits: these are not production pricing or capacity claims.
	auth.GasLimit = 2_000_000
	ensure(owner.SetMaxTxGasLimit(&auth, 100_000_000))
	ensure(owner.SetMaxBlockGasLimit(&auth, 100_000_000))
	parsed, err := abi.JSON(strings.NewReader(precompiles.GhostChessABI))
	Require(t, err)
	address := common.HexToAddress("0xa13")
	job := [32]byte{17}
	send := func(name string, args ...any) (*types.Receipt, float64) {
		t.Helper()
		data, e := parsed.Pack(name, args...)
		Require(t, e)
		tx := builder.L2Info.PrepareTxTo("Owner", &address, 80_000_000, new(big.Int), data)
		began := time.Now()
		Require(t, builder.L2.Client.SendTransaction(ctx, tx))
		receipt, e := EnsureTxSucceeded(ctx, builder.L2.Client, tx)
		Require(t, e)
		return receipt, time.Since(began).Seconds()
	}
	initReceipt, initSec := send("newGame", job)
	playReceipt, playSec := send("play", job, uint64(1), "e2e4")
	data, err := parsed.Pack("inspect", job)
	Require(t, err)
	out, err := builder.L2.Client.CallContract(ctx, ethereum.CallMsg{From: auth.From, To: &address, Data: data}, playReceipt.BlockNumber)
	Require(t, err)
	values, err := parsed.Unpack("inspect", out)
	Require(t, err)
	if values[0] != uint64(2) || values[1] != "e7e5" || values[2] != uint64(24000033) || values[3] != uint32(38) {
		t.Fatal("mined reference mismatch", values)
	}
	checkpoint := values[4].([32]byte)
	if hex.EncodeToString(checkpoint[:]) != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" {
		t.Fatal("canonical state mismatch")
	}
	inboxPos, err := arbutil.BlockNumberToMessageIndex(playReceipt.BlockNumber.Uint64(), builder.chainConfig.ArbitrumChainParams.GenesisBlockNum)
	Require(t, err)
	waitForBatchContainingMessage(t, builder.L2.ConsensusNode, inboxPos, 30*time.Second, 250*time.Millisecond)
	var input server_api.InputJSON
	retryUntilFound(t, ctx, 100, 250*time.Millisecond, "ValidationInputsAt", "batch not found on L1", func() error {
		var e error
		input, e = builder.L2.ConsensusNode.StatelessBlockValidator.ValidationInputsAt(ctx, inboxPos, rawdb.LocalTarget(), rawdb.TargetWasm)
		return e
	})
	encoded, err := input.Marshal()
	Require(t, err)
	Require(t, os.WriteFile(filepath.Join(outDir, "input.json"), encoded, 0600))
	header, err := builder.L2.Client.HeaderByNumber(ctx, playReceipt.BlockNumber)
	Require(t, err)
	report := map[string]any{"passed": true, "scope": "Actual local Nitro engine-bearing mined transaction, parent batch and recorded full-block replay inputs; no full WAVM execution claimed", "chainId": builder.chainConfig.ChainID, "ArbOS": 61, "debugOnlyResearchProfile": true, "maxTxGas": 100000000, "maxBlockGas": 100000000, "initTx": initReceipt.TxHash, "playTx": playReceipt.TxHash, "blockNumber": playReceipt.BlockNumber, "blockHash": header.Hash(), "stateRoot": header.Root, "initGas": initReceipt.GasUsed, "playGas": playReceipt.GasUsed, "initSeconds": initSec, "playSeconds": playSec, "checkpointSHA256": hex.EncodeToString(checkpoint[:]), "move": values[1], "nodes": values[2], "depth": values[3], "inputBytes": len(encoded), "publicDeployment": false, "realSpend": 0}
	encoded, err = json.MarshalIndent(report, "", "  ")
	Require(t, err)
	Require(t, os.WriteFile(filepath.Join(outDir, "results.json"), append(encoded, '\n'), 0600))
	t.Log(string(encoded))
	// Optional resource fixture: keep this actual node and its recorded game live.
	// This changes only the test lifecycle, never block execution or the engine policy.
	if text := os.Getenv("GL3_CHESS_HOLD_SECONDS"); text != "" {
		seconds, e := strconv.Atoi(text)
		Require(t, e)
		if seconds < 1 || seconds > 1200 {
			t.Fatal("hold bound")
		}
		ready, _ := json.Marshal(map[string]any{"pid": os.Getpid(), "seconds": seconds, "actualNodeAndGameLive": true})
		Require(t, os.WriteFile(filepath.Join(outDir, "hold-ready.json"), ready, 0600))
		deadline := time.Now().Add(time.Duration(seconds) * time.Second)
		for time.Now().Before(deadline) {
			if _, e = os.Stat(filepath.Join(outDir, "release-hold")); e == nil {
				break
			}
			time.Sleep(time.Second)
		}
	}
}
