package precompiles

import (
	"crypto/sha256"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/arbitrum/multigas"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
)

type ghostChessEVMBridge struct{ inner ArbosPrecompile }

func (p ghostChessEVMBridge) Name() string               { return p.inner.Name() }
func (p ghostChessEVMBridge) RequiredGas([]byte) uint64  { panic("advanced only") }
func (p ghostChessEVMBridge) Run([]byte) ([]byte, error) { panic("advanced only") }
func (p ghostChessEVMBridge) RunAdvanced(input []byte, gas uint64, info *vm.AdvancedPrecompileCall) ([]byte, vm.GasBudget, multigas.MultiGas, error) {
	info.Evm.IncrementDepth()
	defer info.Evm.DecrementDepth()
	out, left, used, e := p.inner.Call(input, info.ActingAsAddress, info.Caller, info.Value, info.ReadOnly, gas, info.Evm)
	return out, vm.NewGasBudget(left, 0), used, e
}
func TestGL3ChessABIMetadata(t *testing.T) {
	address, p := makeGhostChessPrecompile()
	if address != common.HexToAddress("0xa13") || p.methodsByName["Play"].purity != write || p.methodsByName["Inspect"].purity != view {
		t.Fatal("ABI identity")
	}
	if _, ok := Precompiles()[address].(*DebugPrecompile); !ok {
		t.Fatal("must stay isolated from the standard production core")
	}
	if p.methodsByName["SeedGhostChessGenesis"] != nil {
		t.Fatal("seed leaked into ABI")
	}
}
func TestGL3ChessFullABIDispatch(t *testing.T) {
	modelPath := os.Getenv("GL3_CHESS_MODEL")
	outPath := os.Getenv("GL3_CHESS_EVIDENCE")
	if modelPath == "" || outPath == "" {
		t.Fatal("explicit local model/evidence paths required")
	}
	began := time.Now()
	weights, e := os.ReadFile(modelPath)
	if e != nil {
		t.Fatal(e)
	}
	address, p := makeGhostChessPrecompile()
	_, wrapped := debugOnly(address, p)
	evm := newMockEVMForTesting()
	evm.Context.Transfer, evm.Context.CanTransfer = core.Transfer, core.CanTransfer
	evm.SetPrecompiles(vm.PrecompiledContracts{address: ghostChessEVMBridge{wrapped}})
	parsed, e := abi.JSON(strings.NewReader(GhostChessABI))
	if e != nil {
		t.Fatal(e)
	}
	owner, stranger := common.HexToAddress("0x1234"), common.HexToAddress("0x5678")
	job := [32]byte{17}
	const budget uint64 = 100_000_000
	checks := []string{}
	add := func(s string) { checks = append(checks, s); t.Log(s) }
	call := func(who common.Address, static bool, gas uint64, name string, args ...any) ([]any, uint64, error) {
		t.Helper()
		input, e := parsed.Pack(name, args...)
		if e != nil {
			t.Fatal(e)
		}
		var out []byte
		var left vm.GasBudget
		if static {
			out, left, _, e = evm.StaticCall(who, address, input, vm.NewGasBudget(gas, 0))
		} else {
			out, left, _, e = evm.Call(who, address, input, vm.NewGasBudget(gas, 0), uint256.NewInt(0))
		}
		if e != nil {
			return nil, gas - left.RegularGas, e
		}
		v, e := parsed.Unpack(name, out)
		return v, gas - left.RegularGas, e
	}
	if _, _, e = call(owner, false, budget, "newGame", job); e == nil {
		t.Fatal("unseeded model accepted")
	}
	add("unseeded model fails closed")
	bad := append([]byte(nil), weights...)
	bad[len(bad)/2] ^= 1
	if SeedGhostChessGenesis(evm.StateDB, bad) == nil {
		t.Fatal("wrong full model accepted")
	}
	bad = nil
	if e = SeedGhostChessGenesis(evm.StateDB, weights); e != nil {
		t.Fatal(e)
	}
	add("full NNUE committed as authenticated STOP-prefixed code pages")
	if _, _, e = call(owner, true, budget, "newGame", job); e == nil {
		t.Fatal("static write accepted")
	}
	add("STATICCALL rejects mutation")
	start := time.Now()
	v, initGas, e := call(owner, false, budget, "newGame", job)
	if e != nil {
		t.Fatal(e)
	}
	if v[0].(uint64) != 1 {
		t.Fatal("initial generation")
	}
	initSeconds := time.Since(start).Seconds()
	add("actual EVM newGame creates authoritative retained checkpoint")
	if _, _, e = call(owner, false, budget, "newGame", job); e == nil {
		t.Fatal("duplicate game accepted")
	}
	if _, _, e = call(stranger, false, budget, "play", job, uint64(1), "e2e4"); e == nil {
		t.Fatal("caller isolation")
	}
	add("duplicate/cross-caller mutation rejected")
	if _, _, e = call(owner, false, budget, "play", job, uint64(2), "e2e4"); e == nil {
		t.Fatal("stale generation accepted")
	}
	if _, _, e = call(owner, false, budget, "play", job, uint64(1), "e2e5"); e == nil {
		t.Fatal("illegal history accepted")
	}
	add("generation and legal-history guards")
	rows := []map[string]any{}
	history := "e2e4"
	for i, expect := range []struct {
		move  string
		nodes uint64
		depth uint32
	}{{"e7e5", 24000033, 38}, {"b8c6", 24000311, 39}} {
		before := time.Now()
		v, used, e := call(owner, false, budget, "play", job, uint64(i+1), history)
		if e != nil {
			t.Fatal(e)
		}
		if v[0].(uint64) != uint64(i+2) || v[1].(string) != expect.move || v[2].(uint64) != expect.nodes || v[3].(uint32) != expect.depth {
			t.Fatal("full policy mismatch", v)
		}
		row := map[string]any{"history": history, "generation": v[0], "move": v[1], "nodes": v[2], "depth": v[3], "checkpointSHA": v[4], "gasUsed": used, "seconds": time.Since(before).Seconds()}
		rows = append(rows, row)
		retry, retryGas, e := call(owner, false, budget, "play", job, uint64(i+1), history)
		if e != nil || retry[4] != v[4] || retry[1] != v[1] {
			t.Fatal("retry differs")
		}
		row["retryGas"] = retryGas
		history += " " + expect.move + " g1f3"
	}
	add("two consecutive full24m EVM decisions and byte-bound retry match reference")
	// Tamper an actual retained page; no result or replacement checkpoint may commit.
	addr := chessPageAddress(chessNamespace(owner, job), 0)
	oldCode := append([]byte(nil), evm.StateDB.GetCode(addr)...)
	broken := append([]byte(nil), oldCode...)
	broken[len(broken)-1] ^= 1
	evm.StateDB.SetCode(addr, broken, tracing.CodeChangeUnspecified)
	if _, _, e = call(owner, false, budget, "play", job, uint64(3), "e2e4 e7e5 g1f3 b8c6 f1c4"); e == nil {
		t.Fatal("corrupt retained state accepted")
	}
	evm.StateDB.SetCode(addr, oldCode, tracing.CodeChangeUnspecified)
	add("corrupt committed checkpoint rejected before search")
	// Determine the exact complete-write budget, revert, then fail one gas short.
	// The second call must roll back actual code-page and ArbOS metadata writes.
	beforeRoot := evm.StateDB.IntermediateRoot(false)
	beforeCode := evm.StateDB.GetCodeHash(addr)
	before, _, e := call(owner, true, budget, "inspect", job)
	if e != nil {
		t.Fatal(e)
	}
	snapshot := evm.StateDB.Snapshot()
	third, fullGas, e := call(owner, false, budget, "play", job, uint64(3), "e2e4 e7e5 g1f3 b8c6 f1c4")
	if e != nil || third[1] != "g8f6" || third[2] != uint64(24000643) || third[3] != uint32(37) {
		t.Fatal("third reference", third, e)
	}
	evm.StateDB.RevertToSnapshot(snapshot)
	if _, _, e = call(owner, false, fullGas-1, "play", job, uint64(3), "e2e4 e7e5 g1f3 b8c6 f1c4"); e == nil {
		t.Fatal("one-gas-short OOG probe unexpectedly completed")
	}
	after, _, e := call(owner, true, budget, "inspect", job)
	if e != nil || before[0] != after[0] || before[4] != after[4] || evm.StateDB.GetCodeHash(addr) != beforeCode {
		t.Fatal("OOG changed committed metadata/code")
	}
	if evm.StateDB.IntermediateRoot(false) != beforeRoot {
		t.Fatal("OOG changed state trie root")
	}
	add("one-gas-short actual EVM OOG rolls back code pages, metadata and entire trie root")
	root := evm.StateDB.IntermediateRoot(false)
	report := map[string]any{"passed": true, "scope": "Actual local Geth EVM and custom ArbOS precompile; not yet a mined GL3 block or full WAVM replay/proof", "fullNNUE_SHA256": sha256.Sum256(weights), "fullNNUEBytes": len(weights), "checks": checks, "decisions": rows, "initGas": initGas, "initSeconds": initSeconds, "stateRoot": root.Hex(), "seconds": time.Since(began).Seconds(), "publicDeployment": false, "realSpend": 0}
	encoded, _ := json.MarshalIndent(report, "", "  ")
	if e = os.WriteFile(outPath, append(encoded, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
}
