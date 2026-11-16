package precompiles

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	bridge "github.com/Gh0stllm/GH0ST/l3/bridge"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
)

func TestGH0STFullLLMABIMetadata(t *testing.T) {
	address, impl := makeGhostLLMPrecompile()
	if address != common.HexToAddress("0xa12") || impl.Name() != "ArbGhostLLM" {
		t.Fatal("wrong experimental identity")
	}
	for _, name := range []string{"Start", "Advance", "Append", "Inspect", "LogitsHash"} {
		if impl.methodsByName[name] == nil {
			t.Fatal("missing ABI method", name)
		}
	}
	if impl.methodsByName["Inspect"].purity != view || impl.methodsByName["Advance"].purity != write {
		t.Fatal("wrong mutability")
	}
	if _, ok := Precompiles()[address].(*DebugPrecompile); !ok {
		t.Fatal("full LLM must be debug-only in the actual registry")
	}
	if impl.methodsByName["Register"] != nil || impl.methodsByName["SeedGhostLLMGenesis"] != nil {
		t.Fatal("trusted genesis registration leaked into public ABI")
	}
}

// Matches gethhook.ArbosPrecompileWrapper's forwarding without importing that
// package (which imports precompiles). Real Geth EVM.Call supplies the snapshot,
// CALL identity, STATICCALL flag, gas budget and rollback, including return OOG.
type ghostLLMTestEVMBridge struct{ inner ArbosPrecompile }

func (p ghostLLMTestEVMBridge) Name() string               { return p.inner.Name() }
func (p ghostLLMTestEVMBridge) RequiredGas([]byte) uint64  { panic("advanced only") }
func (p ghostLLMTestEVMBridge) Run([]byte) ([]byte, error) { panic("advanced only") }
func (p ghostLLMTestEVMBridge) RunAdvanced(input []byte, gas uint64, info *vm.AdvancedPrecompileCall) ([]byte, vm.GasBudget, multigas.MultiGas, error) {
	info.Evm.IncrementDepth()
	defer info.Evm.DecrementDepth()
	out, left, used, err := p.inner.Call(input, info.ActingAsAddress, info.Caller, info.Value, info.ReadOnly, gas, info.Evm)
	return out, vm.NewGasBudget(left, 0), used, err
}

func TestGH0STFullLLMNativeABIDispatch(t *testing.T) {
	started := time.Now()
	dir := os.Getenv("GH0ST_LLM_FIXTURE_DIR")
	if dir == "" {
		t.Skip("explicit reviewed local LLM fixture required")
	}
	code, err := os.ReadFile(filepath.Join(dir, "runtime.wasm"))
	if err != nil {
		t.Fatal(err)
	}
	weights, err := os.ReadFile(filepath.Join(dir, "model.bin"))
	if err != nil {
		t.Fatal(err)
	}
	backend := bridge.Interpreter
	if os.Getenv("GH0ST_LLM_NATIVE_COMPILER") == "1" {
		backend = bridge.NativeCompiler
	}
	address, impl := makeGhostLLMPrecompileWithBackend(backend)
	_, debugImpl := debugOnly(address, impl)
	evm := newMockEVMForTesting()
	evm.Context.Transfer, evm.Context.CanTransfer = core.Transfer, core.CanTransfer
	evm.SetPrecompiles(vm.PrecompiledContracts{address: ghostLLMTestEVMBridge{debugImpl}})
	parsed, err := abi.JSON(strings.NewReader(GhostLLMABI))
	if err != nil {
		t.Fatal(err)
	}
	caller, stranger := common.HexToAddress("0x1234"), common.HexToAddress("0x5678")
	job := [32]byte{88}
	const budget uint64 = 2_000_000_000 // explicit oversized local fixture allowance
	var totalGas uint64
	call := func(who common.Address, static bool, allowance uint64, name string, args ...any) ([]any, uint64, error) {
		t.Helper()
		input, e := parsed.Pack(name, args...)
		if e != nil {
			t.Fatal(e)
		}
		var out []byte
		var left vm.GasBudget
		if static {
			out, left, _, e = evm.StaticCall(who, address, input, vm.NewGasBudget(allowance, 0))
		} else {
			out, left, _, e = evm.Call(who, address, input, vm.NewGasBudget(allowance, 0), uint256.NewInt(0))
		}
		used := allowance - left.RegularGas
		totalGas += used
		if e != nil {
			return nil, used, e
		}
		values, e := parsed.Unpack(name, out)
		return values, used, e
	}
	must := func(name string, args ...any) []any {
		t.Helper()
		values, _, e := call(caller, false, budget, name, args...)
		if e != nil {
			t.Fatal(name, e)
		}
		return values
	}
	if _, _, err = call(caller, false, budget, "start", job, uint32(7454)); err == nil {
		t.Fatal("missing genesis model did not fail closed")
	}
	// Hash authentication is performed by the real genesis helper, with StateDB
	// rollback enforced by the initialization owner on any error.
	ctx := testContext(caller, evm)
	snapshot := evm.StateDB.Snapshot()
	bad := append([]byte(nil), weights...)
	bad[len(bad)-1] ^= 1
	if _, err = SeedGhostLLMGenesis(ctx.State.BackingStorage(), code, bad); err == nil {
		t.Fatal("corrupt genesis data admitted")
	}
	evm.StateDB.RevertToSnapshot(snapshot)
	ctx = testContext(caller, evm)
	if _, err = SeedGhostLLMGenesis(ctx.State.BackingStorage(), code, weights); err != nil {
		t.Fatal(err)
	}
	p := must("start", job, uint32(7454))
	if _, _, err = call(caller, false, budget, "start", job, uint32(7454)); err == nil {
		t.Fatal("duplicate job accepted through ABI")
	}
	for _, bounds := range [][2]uint32{{0, 1}, {513, 1}, {512, 0}, {512, 17}} {
		if _, _, err = call(caller, false, budget, "advance", job, p[0].(uint64), bounds[0], bounds[1]); err == nil {
			t.Fatal("out-of-bound work accepted through ABI", bounds)
		}
	}
	if _, _, err = call(caller, true, budget, "advance", job, p[0].(uint64), uint32(512), uint32(16)); err == nil {
		t.Fatal("STATICCALL allowed a state transition")
	}
	if _, _, err = call(stranger, false, budget, "advance", job, p[0].(uint64), uint32(512), uint32(16)); err == nil {
		t.Fatal("actual Context caller binding failed")
	}
	// Measure one successful transition then remove its last gas unit. This drives
	// a metered failure after writes have started, or at output encoding, and the
	// real EVM CALL must restore exactly the old generation/checkpoint.
	snapshot = evm.StateDB.Snapshot()
	advanced, advanceGas, err := call(caller, false, budget, "advance", job, p[0].(uint64), uint32(512), uint32(16))
	if err != nil || advanced[0] == p[0] || advanceGas == 0 {
		t.Fatal("transition probe failed", err)
	}
	evm.StateDB.RevertToSnapshot(snapshot)
	if _, _, err = call(caller, false, advanceGas-1, "advance", job, p[0].(uint64), uint32(512), uint32(16)); err == nil {
		t.Fatal("budget below exact successful charge was accepted")
	}
	if got := must("inspect", job); !reflect.DeepEqual(got, p) {
		t.Fatal("real EVM OOG rollback changed committed state", got, p)
	}
	commits := 0
	for !p[6].(bool) {
		oldGeneration := p[0].(uint64)
		p = must("advance", job, oldGeneration, uint32(512), uint32(16))
		commits++
		if commits == 1 {
			if _, _, err = call(caller, false, budget, "advance", job, oldGeneration, uint32(512), uint32(16)); err == nil {
				t.Fatal("stale generation was accepted through ABI")
			}
		}
		if commits > 32 {
			t.Fatal("fixed full-model work bound exceeded")
		}
	}
	if p[4].(uint32) != 2402 || p[1].(uint32) != 277 {
		t.Fatal("wrong complete-model result", p)
	}
	gotHash := must("logitsHash", job)[0].([32]byte)
	const expectedHash = "44f7ac472b255db705be0be97f0ad9b820dd985530ac16fd3534363081b2787a"
	if hex.EncodeToString(gotHash[:]) != expectedHash {
		t.Fatal("all 50257 logits differ from independent reference")
	}
	if _, _, err = call(stranger, true, budget, "logitsHash", job); err == nil {
		t.Fatal("stranger could inspect caller-scoped result")
	}
	snapshot = evm.StateDB.Snapshot()
	appended := must("append", job, p[0].(uint64), uint32(2402))
	if appended[6].(bool) || appended[0].(uint64) <= p[0].(uint64) || appended[3].(uint32) != p[3].(uint32)+1 {
		t.Fatal("append did not create the next committed position", appended)
	}
	evm.StateDB.RevertToSnapshot(snapshot)
	if got := must("inspect", job); !reflect.DeepEqual(got, p) {
		t.Fatal("snapshot failed to restore completed position")
	}
	// Demonstrate the actual debug wrapper rejects all calls when disabled.
	evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles = false
	if _, _, err = call(caller, true, budget, "inspect", job); err == nil {
		t.Fatal("production chain config enabled debug precompile")
	}
	evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles = true
	checkpoint := p[5].([32]byte)
	if hex.EncodeToString(checkpoint[:]) != "5972420b6f0fdc3fd42191dbb299e0dd8fafaeefca9023cf99db33c6d2da8f3a" {
		t.Fatal("complete checkpoint differs from native/WASI oracle")
	}
	report := map[string]any{
		"scope":   "Actual Nitro ABI dispatcher reached full reviewed model through real Geth EVM CALL/STATICCALL and ArbOS storage in a local fixture",
		"backend": backend, "address": address.Hex(), "genesisRuntimeSHA256": hex.EncodeToString(bridge.RuntimeSHA256[:]),
		"genesisWeightsSHA256": hex.EncodeToString(bridge.WeightsSHA256[:]), "comparedLogits": 50257,
		"logitsI32LESHA256": expectedHash, "bestToken": p[4], "kernelStep": p[1], "commits": commits,
		"checkpointSHA256": hex.EncodeToString(checkpoint[:]), "modelParameters": 3745984,
		"actualEVMOutOfGasRollbackVerified": true, "actualStaticCallRejectionVerified": true,
		"callerIsolationVerified": true, "staleGenerationRejected": true, "missingGenesisFailsClosed": true,
		"appendABIVerified": true, "workBoundsVerified": true, "duplicateJobRejected": true,
		"corruptGenesisRejected": true, "debugGateVerified": true, "fixturePerCallGasAllowance": budget,
		"singleAdvanceMeasuredGas": advanceGas, "totalFixtureCallGasIncludingFailureProbes": totalGas,
		"genesisStorageGasExcluded": true, "gasIsNotProductionTariffOrFeeQuote": true,
		"runtimeArtifactSHA256": hex.EncodeToString(sha256Sum(code)), "localWallSeconds": time.Since(started).Seconds(),
		"registeredDebugLLMPrecompile": true, "chainBooted": false, "proverChallengeExecuted": false, "financialActions": false,
	}
	if path := os.Getenv("GH0ST_LLM_ABI_EVIDENCE_PATH"); path != "" {
		raw, _ := json.MarshalIndent(report, "", "  ")
		if err = os.WriteFile(path, append(raw, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("full LLM through real EVM ABI: %d commits, all 50257 logits, %.3fs", commits, time.Since(started).Seconds())
}

func sha256Sum(data []byte) []byte {
	digest := sha256.Sum256(data)
	return digest[:]
}
