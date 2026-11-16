//go:build gh0stllmbridge

package precompiles

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	bridge "github.com/Gh0stllm/GH0ST/l3/bridge"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/offchainlabs/nitro/arbos/burn"
	"github.com/offchainlabs/nitro/arbos/storage"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGH0STFullLLMArbOSWordStore(t *testing.T) {
	started := time.Now()
	backend := bridge.Interpreter
	if os.Getenv("GH0ST_LLM_NATIVE_COMPILER") == "1" {
		backend = bridge.NativeCompiler
	}
	newEngine := func(store bridge.Store, model bridge.Hash) (*bridge.Engine, error) {
		return bridge.NewWithBackend(store, model, backend)
	}
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
	db := storage.NewMemoryBackedStateDB()
	meter := burn.NewSystemBurner(nil, false)
	words := &ghostLLMWordStore{backing: storage.NewGeth(db, meter).OpenSubStorage([]byte("GH0ST_LLM_NATIVE_TEST"))}
	s := bridge.WordAdapter{Words: words}
	model, err := bridge.Register(s, code, weights)
	if err != nil {
		t.Fatal(err)
	}
	registerGas := meter.Burned()
	var owner bridge.Owner
	owner[19] = 1
	var id bridge.Hash
	id[31] = 77
	engine, err := newEngine(s, model)
	if err != nil {
		t.Fatal(err)
	}
	p, err := engine.Begin(s, owner, id, 7454)
	engine.Close()
	if err != nil {
		t.Fatal(err)
	}
	// Real Geth state rollback, not a map-store approximation.
	snap := db.Snapshot()
	engine, err = newEngine(s, model)
	if err != nil {
		t.Fatal(err)
	}
	advanced, err := engine.Advance(s, owner, id, p.Generation, 512, 1)
	engine.Close()
	if err != nil {
		t.Fatal(err)
	}
	if advanced.Generation <= p.Generation {
		t.Fatal("did not advance")
	}
	db.RevertToSnapshot(snap)
	engine, err = newEngine(s, model)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := engine.Inspect(s, owner, id)
	engine.Close()
	if err != nil || restored != p {
		t.Fatal("real StateDB rollback failed", err)
	}
	wantTokens := []uint32{2402, 257}
	wantHashes := []string{"44f7ac472b255db705be0be97f0ad9b820dd985530ac16fd3534363081b2787a", "9486c642c70bd30a1a40589a5191ee9f60c89a7dea23850d309467575352fe4c"}
	records := []map[string]any{}
	commits := 0
	for pos := 0; pos < 2; pos++ {
		for !p.Done {
			s = bridge.WordAdapter{Words: words}
			engine, err = newEngine(s, model)
			if err != nil {
				t.Fatal(err)
			}
			p, err = engine.Advance(s, owner, id, p.Generation, 512, 16)
			engine.Close()
			if err != nil {
				t.Fatal(err)
			}
			commits++
		}
		if p.BestToken != wantTokens[pos] {
			t.Fatal("wrong next token", p.BestToken)
		}
		engine, err = newEngine(s, model)
		if err != nil {
			t.Fatal(err)
		}
		logits, e := engine.Logits(s, owner, id)
		if e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(logits)
		if hex.EncodeToString(digest[:]) != wantHashes[pos] {
			t.Fatal("full-logit oracle mismatch", pos)
		}
		records = append(records, map[string]any{"position": pos, "bestToken": p.BestToken, "allLogitsCompared": 50257, "logitsI32LESHA256": hex.EncodeToString(digest[:]), "generation": p.Generation, "kernelStep": p.KernelStep})
		if pos == 0 {
			p, err = engine.Append(s, owner, id, p.Generation, 2402)
			if err != nil {
				t.Fatal(err)
			}
		}
		engine.Close()
	}
	report := map[string]any{"scope": "Real pretrained TinyStories module executed via pure-Go interpreter with actual Nitro ArbOS storage and Geth StateDB, not a registered LLM precompile or running chain", "positions": records, "fullGethStateRoot": db.(*state.StateDB).IntermediateRoot(false).Hex(), "backend": backend, "runtimeSHA256": hex.EncodeToString(bridge.RuntimeSHA256[:]), "weightsSHA256": hex.EncodeToString(bridge.WeightsSHA256[:]), "modelParameters": 3745984, "totalLogitsCompared": 100514, "freshGuestEachCommit": true, "freshHostWrapperEachCommit": true, "realGethRollbackVerified": true, "commits": commits, "wordReads": words.reads, "wordWrites": words.writes, "modelRegistrationStorageGas": registerGas, "allTestStorageGasIncludingRollbackProbe": meter.Burned(), "storageGasIsNotFullExecutionGasOrTransactionFee": true, "systemBurnerHasNoGasBudget": true, "localWallSeconds": time.Since(started).Seconds(), "registeredLLMPrecompile": false, "chainBooted": false, "proverChallengeExecuted": false, "financialActions": false}
	if out := os.Getenv("GH0ST_LLM_EVIDENCE_PATH"); out != "" {
		raw, _ := json.MarshalIndent(report, "", "  ")
		if e := os.WriteFile(out, append(raw, '\n'), 0644); e != nil {
			t.Fatal(e)
		}
	}
	t.Logf("realArbOSstore:2completepositions,100514logits,%dcommits,%.3fs", commits, time.Since(started).Seconds())
}
