package server_arb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// The raw bytes are the earlier authentic7-step trivial-WASM counter fixture,
// not the selected engine. This exercises actual native machine/cache behavior
// while keeping error/range/Finished tests strictly bounded.
func TestGL3IntegrationTinyActualMachineDifferential(t *testing.T) {
	wasm, e := hex.DecodeString("0061736d010000000105016000017f03020100070f010b5f5f6d61696e5f766f696400000a0601040041070b")
	if e != nil {
		t.Fatal(e)
	}
	if fmt.Sprintf("%x", sha256.Sum256(wasm)) != "5ad30fc38ab26f2d0ff7bc53e9c464bd2a7ad8d5237fd02ad53f29b0177f11d6" {
		t.Fatal("tiny input identity")
	}
	path := filepath.Join(t.TempDir(), "counter-smoke.wasm")
	if e = os.WriteFile(path, wasm, 0600); e != nil {
		t.Fatal(e)
	}
	load := func() (MachineInterface, error) {
		raw, err := LoadSimpleMachine(path, nil, false)
		if err != nil {
			return nil, err
		}
		return BoldMachineWrapper(raw), nil
	}
	direct, e := load()
	if e != nil {
		t.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	hashes := []common.Hash{direct.Hash()}
	var proofAt3 []byte
	for direct.IsRunning() {
		if len(hashes) > 32 {
			direct.Destroy()
			t.Fatal("tiny machine exceeded bound")
		}
		if e = direct.Step(ctx, 1); e != nil {
			direct.Destroy()
			t.Fatal(e)
		}
		hashes = append(hashes, direct.Hash())
		if direct.GetStepCount() == 3 {
			proofAt3 = direct.ProveNextStep()
		}
	}
	finalStep := direct.GetStepCount()
	direct.Destroy()
	if finalStep != 8 || len(hashes) != 9 || len(proofAt3) == 0 {
		t.Fatal("actual tiny raw7/wrapped8 reference mismatch", finalStep, len(hashes))
	}
	for _, experimental := range []bool{false, true} {
		name := "legacy"
		if experimental {
			name = "experimental"
		}
		t.Run(name, func(t *testing.T) {
			config := &MachineCacheConfig{CachedChallengeMachines: 4, InitialSteps: 2}
			if experimental {
				config = integrationExperimentalConfig()
			}
			run, err := NewExecutionRun(context.Background(), func(context.Context) (MachineInterface, error) { return load() }, config)
			if err != nil {
				t.Fatal(err)
			}
			defer run.Close()
			actual, err := run.GetMachineHashesWithStepSize(0, 1, 32).Await(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if len(actual) != len(hashes) {
				t.Fatal("actual cache list length differs", len(actual))
			}
			for i := range hashes {
				if actual[i] != hashes[i] {
					t.Fatal("native cache hash differs", i)
				}
			}
			if experimental {
				before := run.ExperimentalStats()
				for repeat := 0; repeat < 3; repeat++ {
					coarse, err := run.GetMachineHashesWithStepSize(0, 2, 32).Await(ctx)
					if err != nil {
						t.Fatal(err)
					}
					if len(coarse) != 5 {
						t.Fatal("actual memo changed Finished length")
					}
					for i, h := range coarse {
						if h != hashes[i*2] {
							t.Fatal("actual memo hash differs", i)
						}
					}
				}
				after := run.ExperimentalStats()
				if after.Recording.ActualSteps != before.Recording.ActualSteps || after.AlignedListHits-before.AlignedListHits != 3 {
					t.Fatal("actual tiny memo repeated interpreter steps", before, after)
				}
				if out := os.Getenv("GL3_INTEGRATION_EVIDENCE"); out != "" {
					data, _ := json.MarshalIndent(map[string]any{"passed": true, "scope": "actual trivial WASM interpreter, not selected engine cost", "before": before, "afterThreeAlignedLists": after, "extraActualRecordedSteps": after.Recording.ActualSteps - before.Recording.ActualSteps}, "", "  ")
					if err = os.WriteFile(filepath.Join(out, "tiny-actual-work-accounting.json"), append(data, '\n'), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			padded, err := run.GetStepAt(999).Await(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if padded.Position != 8 || padded.Hash != hashes[8] || uint8(padded.Status) != 1 {
				t.Fatal("actual tiny Finished padding differs")
			}
			if _, err = run.PrepareRange(2, 6).Await(ctx); err != nil {
				t.Fatal(err)
			}
			proof, err := run.GetProofAt(3).Await(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(proof, proofAt3) {
				t.Fatal("actual refined proof differs")
			}
			proof[0] ^= 1
			again, err := run.GetProofAt(3).Await(ctx)
			if err != nil || !bytes.Equal(again, proofAt3) {
				t.Fatal("returned proof alias poisoned actual machine", err)
			}
		})
	}
	if out := os.Getenv("GL3_INTEGRATION_EVIDENCE"); out != "" {
		data, _ := json.MarshalIndent(map[string]any{"passed": !t.Failed(), "kind": "actual trivial7-step WASM native machine, not selected865 engine", "rawHalt": 7, "wrappedFinished": 8, "referenceHashes": hashes, "legacyAndExperimentalMatch": !t.Failed(), "refinedProofExact": !t.Failed(), "allExecutionOnRunpod": true, "fullEngineExecuted": false}, "", "  ")
		if e = os.WriteFile(filepath.Join(out, "tiny-actual-machine.json"), append(data, '\n'), 0600); e != nil {
			t.Fatal(e)
		}
	}
}
