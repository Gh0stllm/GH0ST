package precompiles_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
	"github.com/offchainlabs/nitro/arbcompress"
	"github.com/offchainlabs/nitro/arbos"
	"github.com/offchainlabs/nitro/arbos/arbosState"
	"github.com/offchainlabs/nitro/arbos/programs"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
	_ "github.com/offchainlabs/nitro/gethhook"
	"github.com/offchainlabs/nitro/solgen/go/precompilesgen"
	"math/big"
	"os"
	"strings"
	"testing"
	"time"
)

func TestGH0STRealStylusActivationAndABI(t *testing.T) {
	started := time.Now()
	fixture := os.Getenv("GH0ST_STYLUS_WASM")
	casesPath := os.Getenv("GH0ST_STYLUS_CASES")
	if fixture == "" || casesPath == "" {
		t.Skip("explicit reviewed local Stylus fixture required")
	}
	wasm, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(wasm)
	if hex.EncodeToString(digest[:]) != "e15336947f6bc96a6e29c5eab5d0ad84ffb8d76422f03866115766d1173b5527" {
		t.Fatal("unreviewed Stylus fixture")
	}
	if err = programs.SetTarget(rawdb.TargetHost, "", true); err != nil {
		t.Fatal(err)
	}
	cfg := chaininfo.ArbitrumDevTestChainConfig()
	cfg.ArbitrumChainParams.InitialArbOSVersion = 60
	_, db := arbosState.NewArbosMemoryBackedArbOSStateWithConfig(cfg)
	caller := common.HexToAddress("0x1234")
	program := common.HexToAddress("0x3434")
	funding := new(big.Int).Exp(big.NewInt(10), big.NewInt(24), nil)
	db.AddBalance(caller, uint256.MustFromBig(funding), tracing.BalanceChangeUnspecified)
	compressed, err := arbcompress.Compress(wasm, arbcompress.LEVEL_WELL, arbcompress.EmptyDictionary)
	if err != nil {
		t.Fatal(err)
	}
	db.SetCode(program, append(state.NewStylusPrefix(byte(arbcompress.EmptyDictionary)), compressed...), tracing.CodeChangeUnspecified)
	block := vm.BlockContext{CanTransfer: core.CanTransfer, Transfer: core.Transfer, GetHash: func(uint64) common.Hash { return common.Hash{} }, BlockNumber: big.NewInt(1), GasLimit: 1000000000, ArbOSVersion: 60, Time: 3600, BaseFee: big.NewInt(1), BlobBaseFee: big.NewInt(1)}
	evm := vm.NewEVM(block, db, cfg, vm.Config{})
	evm.SetTxContext(vm.TxContext{Origin: caller, GasPrice: uint256.NewInt(1)})
	run := core.NewMessageCommitContext([]rawdb.WasmTarget{rawdb.TargetHost})
	evm.ProcessingHook = arbos.NewTxProcessor(evm, &core.Message{From: caller, TxRunContext: run})
	activationABI, err := abi.JSON(strings.NewReader(precompilesgen.ArbWasmMetaData.ABI))
	if err != nil {
		t.Fatal(err)
	}
	input, err := activationABI.Pack("activateProgram", program)
	if err != nil {
		t.Fatal(err)
	}
	output, left, _, err := evm.Call(caller, types.ArbWasmAddress, input, vm.NewGasBudget(1000000000, 0), uint256.MustFromBig(new(big.Int).Exp(big.NewInt(10), big.NewInt(21), nil)))
	if err != nil {
		t.Fatalf("real ArbWasm activation failed: %v; output=%x", err, output)
	}
	activated, err := activationABI.Unpack("activateProgram", output)
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string `json:"name"`
		Calldata string `json:"calldata"`
		Expected string `json:"expected"`
		Revert   bool   `json:"revert"`
	}
	raw, err := os.ReadFile(casesPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	records := []map[string]any{}
	for _, tc := range cases {
		ret, remaining, _, e := evm.StaticCall(caller, program, common.FromHex(tc.Calldata), vm.NewGasBudget(100000000, 0))
		if tc.Revert {
			if e == nil {
				t.Fatal("expected real Stylus revert", tc.Name)
			}
		} else if e != nil || !bytes.Equal(ret, common.FromHex(tc.Expected)) {
			t.Fatalf("real Stylus ABI %s: %v got%x want%s", tc.Name, e, ret, tc.Expected)
		}
		records = append(records, map[string]any{"name": tc.Name, "expectedRevert": tc.Revert, "returnedHex": hex.EncodeToString(ret), "gasUsed": 100000000 - remaining.RegularGas, "passed": true})
	}
	report := map[string]any{"scope": "Actual Nitro ArbWasm activation and native Stylus execution through real Geth EVM with in-memory local dev state; no mock vm_hooks, no node/RPC/mainnet deployment", "wasmSHA256": hex.EncodeToString(digest[:]), "wasmBytes": len(wasm), "compressedBytes": len(compressed), "activationVersion": activated[0], "activationGasUsed": 1000000000 - left.RegularGas, "cases": records, "casesPassed": len(records), "localWallSeconds": time.Since(started).Seconds(), "nativeStylusActivated": true, "realGethStaticCallExecuted": true, "chainBooted": false, "fraudProofExecuted": false, "financialActions": false}
	if dest := os.Getenv("GH0ST_STYLUS_EVIDENCE"); dest != "" {
		b, _ := json.MarshalIndent(report, "", "  ")
		if e := os.WriteFile(dest, append(b, '\n'), 0644); e != nil {
			t.Fatal(e)
		}
	}
	t.Logf("actual activation + %d real Stylus EVM ABI cases passed", len(records))
}
