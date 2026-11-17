package server_arb

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/offchainlabs/nitro/validator/hostcacheidentity"
	"github.com/offchainlabs/nitro/validator/server_api"
	"github.com/offchainlabs/nitro/validator/server_common"
)

// No executionRun or MachineCache is created here: their normal eager build
// would execute to the full halt. This calls the same real recording helper on
// an actual input-loaded machine and stops at raw200M without faking Finished.
func TestGL3IntegrationSelectedOriginalInputPrefix(t *testing.T) {
	if os.Getenv("GL3_INTEGRATION_REAL_PREFIX") != "1" {
		t.Skip("separate explicit Runpod original-prefix mode required")
	}
	inputPath := os.Getenv("GL3_INTEGRATION_ORIGINAL_INPUT")
	machines := os.Getenv("GL3_INTEGRATION_MACHINE_LOCATOR")
	referencePath := os.Getenv("GL3_INTEGRATION_PREFIX_REFERENCE")
	out := os.Getenv("GL3_INTEGRATION_EVIDENCE")
	if inputPath == "" || machines == "" || referencePath == "" || out == "" {
		t.Fatal("explicit frozen input, locator, reference and evidence paths required")
	}
	started := time.Now()
	file, e := os.Open(inputPath)
	if e != nil {
		t.Fatal(e)
	}
	defer file.Close()
	h := sha256.New()
	n, e := io.Copy(h, file)
	if e != nil {
		t.Fatal(e)
	}
	expectedInputSHA := "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90"
	if n != 2574999906 || hex.EncodeToString(h.Sum(nil)) != expectedInputSHA {
		t.Fatal("original input identity mismatch")
	}
	if _, e = file.Seek(0, 0); e != nil {
		t.Fatal(e)
	}
	var wire server_api.InputJSON
	if e = json.NewDecoder(file).Decode(&wire); e != nil {
		t.Fatal(e)
	}
	typed, e := server_api.ValidationInputFromJson(&wire)
	if e != nil {
		t.Fatal(e)
	}
	wire = server_api.InputJSON{}
	runtime.GC()
	root := common.HexToHash("0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086")
	key, e := hostcacheidentity.KeyOwnedDecoded(root, typed, true)
	if e != nil {
		t.Fatal(e)
	}
	if key.InputSHA256 != common.HexToHash("0x08973daea4ae4bc44f95f1b17101780ff0efb51876e6205f258e3ce3a9293db2") {
		t.Fatal("canonical V2 identity mismatch", key.InputSHA256)
	}
	var references struct {
		FullProofFileSHA256 string `json:"fullProofFileSHA256"`
		Samples             []struct {
			RawStep     string      `json:"rawStep"`
			WrappedStep string      `json:"wrappedStep"`
			BeforeHash  common.Hash `json:"beforeHash"`
		} `json:"samples"`
	}
	data, e := os.ReadFile(referencePath)
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(data, &references); e != nil {
		t.Fatal(e)
	}
	if references.FullProofFileSHA256 != "74473cd9a4e149aa8230baf8cefca1736a0201d7111a5c00bc20ecb93397a448" || len(references.Samples) != 3 {
		t.Fatal("wrong full-proof reference")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	locator, e := server_common.NewMachineLocator(machines)
	if e != nil {
		t.Fatal(e)
	}
	if locator.LatestWasmModuleRoot() != root {
		t.Fatal("wrong resolved root")
	}
	resolverEntriesBefore := len(preimageResolvers.Keys())
	loader := NewArbMachineLoader(&DefaultArbitratorMachineConfig, locator)
	initial, e := loader.GetZeroStepMachine(ctx, root)
	if e != nil {
		t.Fatal(e)
	}
	inner := initial.Clone()
	spawner := &ArbitratorSpawner{}
	if e = spawner.loadEntryToMachine(ctx, typed, inner); e != nil {
		inner.Destroy()
		t.Fatal(e)
	}
	wrapped := BoldMachineWrapper(inner)
	closed := false
	defer func() {
		if !closed {
			wrapped.Destroy()
		}
	}()
	resolverEntriesLoaded := len(preimageResolvers.Keys())
	if wrapped.GetStepCount() != 0 || wrapped.Status() != 1 || wrapped.GetGlobalState() != typed.StartState || wrapped.Hash() != common.HexToHash("0x16f3ededbb3f088f99d365f857ab1f2cf3a9336f4689fff3047f106551c488aa") {
		t.Fatal("wrong actual wrapped initialization")
	}
	recorder := newRecordedStepAccumulator(100_000_000, 16)
	if e = recorder.ObserveInitial(wrapped); e != nil {
		t.Fatal(e)
	}
	rows := []map[string]any{}
	for _, ref := range references.Samples {
		raw, e := strconv.ParseUint(ref.RawStep, 10, 64)
		if e != nil {
			t.Fatal(e)
		}
		target, e := strconv.ParseUint(ref.WrappedStep, 10, 64)
		if e != nil || target != raw+1 || target > 200_000_001 || target < wrapped.GetStepCount() {
			t.Fatal("unbounded or wrong reviewed offset")
		}
		before := wrapped.GetStepCount()
		stepStarted := time.Now()
		if e = recorder.Advance(ctx, wrapped, target-before); e != nil {
			t.Fatal(e)
		}
		if wrapped.GetStepCount() != target || wrapped.Status() != 0 || !wrapped.IsRunning() || wrapped.Hash() != ref.BeforeHash {
			t.Fatal("actual prefix differs from frozen reference", raw, wrapped.GetStepCount(), wrapped.Hash(), ref.BeforeHash)
		}
		rows = append(rows, map[string]any{"rawStep": raw, "wrappedStep": target, "actualHash": wrapped.Hash(), "expectedHash": ref.BeforeHash, "matched": true, "seconds": time.Since(stepStarted).Seconds()})
	}
	if inner.GetStepCount() != 200_000_000 || wrapped.GetStepCount() != 200_000_001 || !wrapped.IsRunning() {
		t.Fatal("prefix did not stop at genuine running raw200M")
	}
	stats := recorder.Stats()
	if stats.Complete || stats.Disabled || stats.ActualSteps != 200_000_001 {
		t.Fatal("wrong bounded recorder state", stats)
	}
	if _, hit := recorder.Hashes(0, 100_000_000, 3); hit {
		t.Fatal("unfinished prefix was published as completed coarse history")
	}
	snapshot := recorder.Snapshot()
	zeroHash := snapshot[0]
	snapshot[0] = common.Hash{99}
	if recorder.Snapshot()[0] != zeroHash {
		t.Fatal("caller poisoned recorded snapshot")
	}
	wrapped.Destroy()
	closed = true
	resolverEntriesAfter := len(preimageResolvers.Keys())
	if resolverEntriesAfter != resolverEntriesBefore {
		t.Fatal("actual prefix resolver references survived explicit close", resolverEntriesBefore, resolverEntriesLoaded, resolverEntriesAfter)
	}
	report := map[string]any{"passed": true, "scope": "Actual unchanged selected-machine raw0/100M/200M prefix through the real recorded-step helper; no eager cache build, no synthetic halt and no full replay/lifecycle performance acceptance", "allExecutionOnRunpod": true, "moduleRoot": root, "inputSHA256": expectedInputSHA, "inputBytes": n, "canonicalV2TypedIdentity": key.InputSHA256, "useBoldMachine": true, "referenceFullProofSHA256": references.FullProofFileSHA256, "samples": rows, "maximumRawStepsExecuted": 200_000_000, "recordingStats": stats, "unfinishedCoarseHistoryNotServed": true, "snapshotMapMutationIsolated": true, "resolverEntriesBefore": resolverEntriesBefore, "resolverEntriesLoaded": resolverEntriesLoaded, "resolverEntriesAfterExplicitClose": resolverEntriesAfter, "finalStillRunning": true, "eagerMachineCacheConstructed": false, "retainedFullRunAccepted": false, "coarseRepeatAvoidanceAcceptedByThisTest": false, "modelOrGuestChanged": false, "fullReplayExecuted": false, "fullLifecycleExecuted": false, "seconds": time.Since(started).Seconds()}
	encoded, e := json.MarshalIndent(report, "", "  ")
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(out, "actual-prefix-result.json"), append(encoded, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	fmt.Printf("GL3 actual prefix matched all3 reference hashes at raw0/100M/200M\n")
}
