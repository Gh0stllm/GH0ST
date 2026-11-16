package precompiles

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
	"github.com/offchainlabs/nitro/arbos"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
)

func TestGL3ChessSlicesABIMetadata(t *testing.T) {
	a, p := makeGhostChessSlicesPrecompile()
	if a != common.HexToAddress("0xa14") || p.methodsByName["Advance"].purity != write || p.methodsByName["Inspect"].purity != view {
		t.Fatal("ABI")
	}
	if Precompiles()[common.HexToAddress("0xa13")] != nil {
		t.Fatal("blocking reference ABI still registered in the sliced profile")
	}
	if p.methodsByName["Play"] != nil || p.methodsByName["SeedGhostChessSlicesGenesis"] != nil {
		t.Fatal("synchronous or genesis helper exposed")
	}
}
func TestGL3ChessSlicesDispatch(t *testing.T) {
	outPath := os.Getenv("GL3_SLICES_EVIDENCE")
	if outPath == "" {
		t.Fatal("explicit evidence path required")
	}
	r, e := sliced.Shared()
	if e != nil {
		t.Fatal(e)
	}
	seed, e := r.Instantiate()
	if e != nil {
		t.Fatal(e)
	}
	if e = seed.Init(); e != nil {
		t.Fatal(e)
	}
	image := seed.Image()
	seed.Close()
	owner, stranger := common.HexToAddress("0x1234"), common.HexToAddress("0x5678")
	config := chaininfo.ArbitrumDevTestChainConfig()
	config.ArbitrumChainParams.AllowDebugPrecompiles = false
	config.ArbitrumChainParams.InitialChainOwner = owner
	evm := newMockEVMForTestingWithConfigs(config, config)
	evm.Context.Transfer, evm.Context.CanTransfer = core.Transfer, core.CanTransfer
	address, p := makeGhostChessSlicesPrecompile()
	evm.SetPrecompiles(vm.PrecompiledContracts{address: ghostChessEVMBridge{p}})
	parsed, e := abi.JSON(strings.NewReader(GhostChessSlicesABI))
	if e != nil {
		t.Fatal(e)
	}
	job := [32]byte{23}
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
		if !static && (name == "begin" || name == "advance") {
			evm.Context.BlockNumber.Add(evm.Context.BlockNumber, common.Big1)
		}
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
		t.Fatal("unseeded accepted")
	}
	if e = SeedGhostChessSlicesGenesis(evm.StateDB, image); e != nil {
		t.Fatal(e)
	}
	image = sliced.Image{}
	if _, _, e = call(owner, true, budget, "newGame", job); e == nil {
		t.Fatal("static mutation")
	}
	if _, _, e = call(owner, false, budget, "newGame", job); e != nil {
		t.Fatal(e)
	}
	if _, _, e = call(stranger, false, budget, "newGame", [32]byte{24}); e == nil {
		t.Fatal("unauthorized compute admission")
	}
	if _, _, e = call(owner, false, budget, "newGame", [32]byte{24}); e == nil {
		t.Fatal("reserved game evicted")
	}
	add("project-only admission and one retained-game reservation bound live memory")
	if _, _, e = call(stranger, false, budget, "begin", job, uint64(1), "e2e4"); e == nil {
		t.Fatal("caller")
	}
	if _, _, e = call(owner, false, budget, "begin", job, uint64(2), "e2e4"); e == nil {
		t.Fatal("generation")
	}
	if _, _, e = call(owner, false, budget, "begin", job, uint64(1), "e2e5"); e == nil {
		t.Fatal("illegal move")
	}
	add("unseeded, static writes, caller isolation, generation and illegal moves reject")
	start := time.Now()
	v, _, e := call(owner, false, budget, "begin", job, uint64(1), "e2e4")
	if e != nil {
		t.Fatal(e)
	}
	coldBegin := time.Since(start).Seconds()
	step := v[0].(uint32)
	if !v[1].(bool) || step != 1 {
		t.Fatal("first slice")
	}
	rows := []map[string]any{}
	full := os.Getenv("GL3_SLICES_FULL") == "1"
	limit := uint32(129)
	if full {
		limit = 13000
	}
	var simulationRoot any
	for step < limit && v[1].(bool) {
		start = time.Now()
		var used uint64
		v, used, e = call(owner, false, budget, "advance", job, uint64(1), step)
		if e != nil {
			t.Fatal(e)
		}
		rows = append(rows, map[string]any{"step": v[0], "seconds": time.Since(start).Seconds(), "gasUsed": used})
		if v[0].(uint32) != step+1 {
			t.Fatal("step")
		}
		step++
		meta, e := sliceMetaRead(sliceStore(evm.StateDB, burn.NewSystemBurner(nil, false), sliceNamespace(owner, job)))
		if e != nil {
			t.Fatal(e)
		}
		rows[len(rows)-1]["deltaBytes"] = meta.DeltaBytes
		rows[len(rows)-1]["engineSteps"] = meta.Progress.Step
		if step == 49 && simulationRoot != nil && v[2] != simulationRoot {
			t.Fatal("RPC and real transition differ")
		}
		if step%1000 == 0 {
			t.Log("completed engine slices", step)
		}
		if step == 32 {
			root := v[2]
			repeat, _, e := call(owner, false, budget, "advance", job, uint64(1), step-1)
			if e != nil || repeat[2] != root || repeat[0] != step {
				t.Fatal("idempotent retry", e)
			}
			if _, _, e = call(owner, false, budget, "advance", job, uint64(2), step); e == nil {
				t.Fatal("wrong search generation")
			}
			if _, _, e = call(owner, false, budget, "advance", job, uint64(1), step+1); e == nil {
				t.Fatal("future cursor")
			}
			add("retry performs no duplicate search; generation and future cursor reject")
			// Force the wrapper's next increment back to the last executing block.
			evm.Context.BlockNumber.Sub(evm.Context.BlockNumber, common.Big1)
			// Bad generation/future calls above changed only the test block clock;
			// retrieve the real last block from its authoritative budget record.
			budgetBytes, _ := sliceStore(evm.StateDB, burn.NewSystemBurner(nil, false), []byte("GL3_CHESS_GLOBAL_SLICE_BUDGET_V1")).GetBytes()
			evm.Context.BlockNumber.SetUint64(binary.LittleEndian.Uint64(budgetBytes) - 1)
			if _, _, e = call(owner, false, budget, "advance", job, uint64(1), step); e == nil {
				t.Fatal("two computing slices in one block")
			}
			add("global one-slice-per-block limit prevents aggregation of blocking searches")
		}
		if step == 48 {
			key := string(sliceNamespace(owner, job))
			live := sliceCaches.Items[key]
			root := live.Root
			snap := evm.StateDB.Snapshot()
			hook := evm.ProcessingHook
			evm.ProcessingHook = arbos.NewTxProcessor(evm, &core.Message{From: owner, TxRunContext: core.NewMessageEthcallContext()})
			simulated, _, e := call(owner, false, budget, "advance", job, uint64(1), step)
			if e != nil {
				t.Fatal(e)
			}
			simulationRoot = simulated[2]
			evm.StateDB.RevertToSnapshot(snap)
			evm.ProcessingHook = hook
			if sliceCaches.Items[key] != live || live.Root != root {
				t.Fatal("eth_call changed replicated VM cache")
			}
			add("eth_call uses isolated VM and cannot advance or evict live search; real transition matches")
		}
		if step == 64 {
			ns := sliceNamespace(owner, job)
			cache := sliceCaches.Items[string(ns)]
			var address common.Address
			var original []byte
			for a := range cache.Codes {
				b := evm.StateDB.GetCode(a)
				if len(b) > len(slicePrefix) {
					address = a
					original = b
					break
				}
			}
			bad := append([]byte(nil), original...)
			bad[len(bad)-1] ^= 1
			snap := evm.StateDB.Snapshot()
			evm.StateDB.SetCode(address, bad, tracing.CodeChangeUnspecified)
			// ArbDebug's arbitrary code writer is disabled in the fast profile. Its
			// research-only mode must fall back to strict identity checks if enabled.
			config.ArbitrumChainParams.AllowDebugPrecompiles = true
			if _, _, e = call(owner, false, budget, "advance", job, uint64(1), step); e == nil {
				t.Fatal("corruption hidden in debug mode")
			}
			evm.StateDB.RevertToSnapshot(snap)
			config.ArbitrumChainParams.AllowDebugPrecompiles = false
			add("debug arbitrary-code writer forces strict cache identity checks; fast profile disables it")
		}
		if step == 96 {
			before := evm.StateDB.IntermediateRoot(false)
			snap := evm.StateDB.Snapshot()
			next, used, e := call(owner, false, budget, "advance", job, uint64(1), step)
			if e != nil {
				t.Fatal(e)
			}
			want := next[2]
			evm.StateDB.RevertToSnapshot(snap)
			if _, _, e = call(owner, false, used-1, "advance", job, uint64(1), step); e == nil {
				t.Fatal("one-gas-short accepted")
			}
			if evm.StateDB.IntermediateRoot(false) != before {
				t.Fatal("OOG trie changed")
			}
			sliceCaches.Lock()
			for key, c := range sliceCaches.Items {
				c.VM.Close()
				delete(sliceCaches.Items, key)
			}
			sliceCaches.Unlock()
			next, _, e = call(owner, false, budget, "advance", job, uint64(1), step)
			if e != nil || next[2] != want {
				t.Fatal("cold restored transition differs", e)
			}
			v = next
			step++
			add("OOG rolls back entire trie; discarded VM cache resumes exact next root from on-chain bytes")
		}
		// The node finalizes the EVM journal at each block. A long test must not
		// retain thousands of historical 8MiB page journals in one open transaction.
		evm.StateDB.Finalise(false)
	}
	final, _, e := call(owner, true, budget, "inspect", job)
	if e != nil {
		t.Fatal(e)
	}
	checkpoint := ""
	if full {
		if final[2].(bool) || final[4].(string) != "e7e5" || final[5].(uint64) != 24000033 || final[6].(uint32) != 38 {
			t.Fatal("complete full-policy result", final)
		}
		cache := sliceCaches.Items[string(sliceNamespace(owner, job))]
		fresh, e := r.Instantiate()
		if e != nil {
			t.Fatal(e)
		}
		if e = fresh.Restore(cache.Image); e != nil {
			t.Fatal(e)
		}
		state, e := fresh.Canonical()
		if e != nil {
			t.Fatal(e)
		}
		fresh.Close()
		sha := sha256.Sum256(state)
		checkpoint = hex.EncodeToString(sha[:])
		if checkpoint != "5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" {
			t.Fatal("full canonical state differs", checkpoint)
		}
		add("complete24m decision and every canonical retained-state byte match monolithic reference")
	} else if !final[2].(bool) || final[4].(string) != "" {
		t.Fatal("partial search exposed a playable move")
	}
	if _, _, e = call(owner, false, budget, "releaseGame", job); e != nil {
		t.Fatal(e)
	}
	if _, _, e = call(owner, false, budget, "begin", job, uint64(1), "e2e4"); e == nil {
		t.Fatal("released game resumed")
	}
	nextJob := [32]byte{24}
	if _, _, e = call(owner, false, budget, "newGame", nextJob); e != nil {
		t.Fatal("released capacity unavailable", e)
	}
	if _, _, e = call(owner, false, budget, "releaseGame", nextJob); e != nil {
		t.Fatal(e)
	}
	add("terminal release frees capacity and cannot expose or resume a partial result")
	report := map[string]any{"scope": "actual local EVM/ArbOS dispatch with authoritative portable VM deltas; not mined cadence or full fraud dispute", "passed": true, "fullDecision": full, "complete24mCheckpointSHA256": checkpoint, "coldBeginSeconds": coldBegin, "steps": step, "rows": rows, "checks": checks, "publicDeployment": false, "realSpend": 0}
	b, _ := json.MarshalIndent(report, "", "  ")
	if e = os.WriteFile(outPath, append(b, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	sliceCaches.Lock()
	for k, c := range sliceCaches.Items {
		c.VM.Close()
		delete(sliceCaches.Items, k)
	}
	sliceCaches.Unlock()
}
