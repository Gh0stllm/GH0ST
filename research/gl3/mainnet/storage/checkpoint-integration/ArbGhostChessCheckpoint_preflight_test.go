//go:build gl3_checkpoint_integration

package precompiles

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
	"github.com/offchainlabs/nitro/cmd/chaininfo"
)

func TestGL3CheckpointProfileABIAndDomain(t *testing.T) {
	a, p := makeGhostChessCheckpointPrecompile()
	if a != common.HexToAddress("0xa15") || Precompiles()[a] == nil || Precompiles()[common.HexToAddress("0xa14")] == nil {
		t.Fatal("opt-in registration")
	}
	if p.methodsByName["CheckpointWork"].purity != write || p.methodsByName["CheckpointStatus"].purity != view {
		t.Fatal("ABI purity")
	}
	_, legacy := makeGhostChessSlicesPrecompile()
	if legacy.methodsByName["CheckpointBegin"] != nil {
		t.Fatal("legacy ABI changed")
	}
	owner := common.HexToAddress("0x1234")
	job := [32]byte{7}
	ns := cpNamespace(owner, job)
	var internal [32]byte
	copy(internal[:], ns)
	candidates := [][32]byte{job, internal, {0}, {1}}
	for _, candidate := range candidates {
		if bytes.Equal(sliceNamespace(owner, candidate), ns) {
			t.Fatal("legacy salted job aliases checkpoint profile")
		}
	}
	if bytes.Equal(cpNamespace(common.HexToAddress("0x5678"), job), ns) {
		t.Fatal("owner namespace alias")
	}
	if cpMemoryRange/32*36+44 > cpPieceMaximum || cpPieceMaximum > sliceMaxBlob {
		t.Fatal("range/blob bound")
	}
}

func TestGL3CheckpointAcceleratorIdentity(t *testing.T) {
	b := cpState{Version: 1, Nonce: 7, Active: true, Owner: common.HexToAddress("0x1234"), Job: [32]byte{3}, Generation: 2, FrozenMeta: [32]byte{4}, Root: [32]byte{5}, OldHead: [32]byte{6}, OldDeltas: 2464, MemoryBytes: 65536, Cursor: 65536, Head: [32]byte{8}, Pieces: [][32]byte{{8}}, BodyBytes: 80}
	identity := cpBuildIdentity(b)
	tests := map[string]func(*cpState){"different-source-root": func(v *cpState) { v.Root[0] ^= 1 }, "different-frozen-metadata": func(v *cpState) { v.FrozenMeta[0] ^= 1 }, "different-source-history-head": func(v *cpState) { v.OldHead[0] ^= 1 }, "different-piece-prefix": func(v *cpState) { v.Pieces = [][32]byte{{9}} }, "different-builder-head": func(v *cpState) { v.Head[0] ^= 1 }, "different-owner": func(v *cpState) { v.Owner[0] ^= 1 }, "different-nonce": func(v *cpState) { v.Nonce++ }, "different-cursor": func(v *cpState) { v.Cursor = 0 }}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			other := b
			change(&other)
			if cpBuildIdentity(other) == identity {
				t.Fatal("stale branch accelerator accepted")
			}
		})
	}
	other := b
	other.Verified = 1
	if cpBuildIdentity(other) != identity {
		t.Fatal("verification must not invalidate unchanged code prefix")
	}
}

func TestGL3CheckpointRPCAdmissionLease(t *testing.T) {
	if len(sliceSimulationTokens) != 0 {
		t.Fatal("prior isolated lease leaked")
	}
	release, e := cpIsolation(true)
	if e != nil {
		t.Fatal(e)
	}
	var group sync.WaitGroup
	denied := make(chan bool, 32)
	for i := 0; i < 32; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			cleanup, e := cpIsolation(true)
			if e == nil {
				cleanup()
			}
			denied <- e != nil
		}()
	}
	group.Wait()
	close(denied)
	for ok := range denied {
		if !ok {
			t.Fatal("parallel RPC admitted while permit held")
		}
	}
	release()
	release()
	if len(sliceSimulationTokens) != 0 {
		t.Fatal("lease release not idempotent")
	}
	for _, kind := range []string{"restore-error", "request-cancel"} {
		t.Run(kind, func(t *testing.T) {
			run := func() error {
				cleanup, e := cpIsolation(true)
				if e != nil {
					return e
				}
				defer cleanup()
				if kind == "restore-error" {
					return errors.New("injected restore error")
				}
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx.Err()
			}
			if run() == nil {
				t.Fatal("missing error")
			}
			if len(sliceSimulationTokens) != 0 {
				t.Fatal("error/cancel leaked permit")
			}
			cleanup, e := cpIsolation(true)
			if e != nil {
				t.Fatal("permit not reusable", e)
			}
			cleanup()
		})
	}
}

func TestGL3CheckpointRealEVMGuardPreflight(t *testing.T) {
	owner := common.HexToAddress("0x1234")
	config := chaininfo.ArbitrumDevTestChainConfig()
	config.ArbitrumChainParams.AllowDebugPrecompiles = false
	config.ArbitrumChainParams.InitialChainOwner = owner
	evm := newMockEVMForTestingWithConfigs(config, config)
	evm.Context.Transfer, evm.Context.CanTransfer = core.Transfer, core.CanTransfer
	address, p := makeGhostChessCheckpointPrecompile()
	evm.SetPrecompiles(vm.PrecompiledContracts{address: ghostChessEVMBridge{p}})
	parsed, e := abi.JSON(strings.NewReader(GhostChessCheckpointABI))
	if e != nil {
		t.Fatal(e)
	}
	rows := []map[string]any{}
	job := [32]byte{8}
	for _, name := range []string{"newGame", "checkpointBegin", "checkpointWork", "checkpointFinalize", "checkpointCancel"} {
		var args []any
		switch name {
		case "newGame":
			args = []any{job}
		case "checkpointBegin":
			args = []any{job, uint64(2), [32]byte{1}}
		case "checkpointWork":
			args = []any{job, uint64(2), uint64(1), uint32(0)}
		default:
			args = []any{job, uint64(2), uint64(1)}
		}
		input, err := parsed.Pack(name, args...)
		if err != nil {
			t.Fatal(err)
		}
		before := evm.StateDB.IntermediateRoot(false)
		_, left, _, err := evm.Call(owner, address, input, vm.NewGasBudget(100000000, 0), uint256.NewInt(0))
		if err == nil {
			t.Fatal("unseeded/missing state accepted", name)
		}
		if evm.StateDB.IntermediateRoot(false) != before {
			t.Fatal("reverted guard changed trie", name)
		}
		used := uint64(100000000) - left.RegularGas
		if used == 0 {
			t.Fatal("real EVM gas was not charged")
		}
		rows = append(rows, map[string]any{"method": name, "actualRevert": true, "gasUsed": used, "trieUnchanged": true})
	}
	config.ArbitrumChainParams.AllowDebugPrecompiles = true
	input, _ := parsed.Pack("newGame", job)
	if _, _, _, e = evm.Call(owner, address, input, vm.NewGasBudget(100000000, 0), uint256.NewInt(0)); e == nil {
		t.Fatal("debug-enabled mutable-code profile accepted")
	}
	if out := os.Getenv("GL3_CHECKPOINT_EVIDENCE"); out != "" {
		data, _ := json.MarshalIndent(map[string]any{"passed": true, "scope": "real StateDB/EVM/ABI guard preflight only; no engine or checkpoint completed", "rows": rows, "allExecutionOnRunpod": true, "engineExecuted": false, "productionAccepted": false}, "", "  ")
		if e = os.WriteFile(filepath.Join(out, "evm-preflight.json"), append(data, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
}
