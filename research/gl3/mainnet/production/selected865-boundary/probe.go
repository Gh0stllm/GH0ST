// Build/run only in an isolated copy of pinned Linux Nitro source on Runpod.
// This executes the authentic BoLD kickoff and ONE raw entry instruction.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/offchainlabs/nitro/validator"
	"github.com/offchainlabs/nitro/validator/server_arb"
	"github.com/offchainlabs/nitro/validator/server_common"
)

const selectedRoot = "0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086"
const originalInputSHA = "bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90"

func must(e error) {
	if e != nil {
		panic(e)
	}
}
func sha(path string) string {
	f, e := os.Open(path)
	must(e)
	defer f.Close()
	h := sha256.New()
	_, e = io.Copy(h, f)
	must(e)
	return hex.EncodeToString(h.Sum(nil))
}
func write(out, name string, v any) {
	b, e := json.MarshalIndent(v, "", "  ")
	must(e)
	must(os.WriteFile(filepath.Join(out, name), append(b, '\n'), 0600))
}

func main() {
	if runtime.GOOS != "linux" {
		panic("Run all execution on Runpod/Linux")
	}
	manifest := flag.String("manifest", "", "original unmodified capture manifest")
	input := flag.String("input", "", "original unmodified full terminal input")
	machines := flag.String("machines", "", "selected865 locator wrapper")
	out := flag.String("out", "", "new isolated evidence path")
	flag.Parse()
	if *manifest == "" || *input == "" || *machines == "" || *out == "" {
		panic("all paths required")
	}
	var original struct {
		ModuleRoot string                  `json:"moduleRoot"`
		SHA256     string                  `json:"SHA256"`
		Start      validator.GoGlobalState `json:"startState"`
	}
	b, e := os.ReadFile(*manifest)
	must(e)
	must(json.Unmarshal(b, &original))
	if original.SHA256 != originalInputSHA || sha(*input) != originalInputSHA {
		panic("original input identity mismatch")
	}
	must(os.MkdirAll(*out, 0700))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	locator, e := server_common.NewMachineLocator(*machines)
	must(e)
	if locator.LatestWasmModuleRoot() != common.HexToHash(selectedRoot) {
		panic("wrong selected root")
	}
	loader := server_arb.NewArbMachineLoader(&server_arb.DefaultArbitratorMachineConfig, locator)
	initial, e := loader.GetZeroStepMachine(ctx, common.HexToHash(selectedRoot))
	must(e)
	inner := initial.Clone()
	must(inner.SetGlobalState(original.Start))
	wrapped := server_arb.BoldMachineWrapper(inner)
	defer wrapped.Destroy()
	if inner.GetStepCount() != 0 || wrapped.GetStepCount() != 0 || wrapped.Status() != uint8(validator.MachineStatusFinished) || wrapped.GetGlobalState() != original.Start {
		panic("invalid actual initial boundary")
	}
	before := wrapped.Hash()
	proof0 := wrapped.ProveNextStep()
	must(wrapped.Step(ctx, 1))
	rawStartHash := inner.Hash()
	if inner.GetStepCount() != 0 || wrapped.GetStepCount() != 1 || wrapped.Status() != uint8(validator.MachineStatusRunning) || wrapped.Hash() != rawStartHash || wrapped.GetGlobalState() != original.Start {
		panic("kickoff did not map wrapped1 to raw0")
	}
	proof1 := wrapped.ProveNextStep()
	before1 := wrapped.Hash()
	must(wrapped.Step(ctx, 1))
	after1 := wrapped.Hash()
	if inner.GetStepCount() != 1 || wrapped.GetStepCount() != 2 || wrapped.GetGlobalState() != original.Start {
		panic("wrapped2 did not map to raw1")
	}
	rows := []map[string]any{
		{"step": "0", "reason": "actual selected865 BoLD Finished-to-Running kickoff; wrapped1 is raw0", "before": strings.TrimPrefix(before.Hex(), "0x"), "after": strings.TrimPrefix(rawStartHash.Hex(), "0x"), "proof": hex.EncodeToString(proof0)},
		{"step": "1", "reason": "one authentic selected865 initial raw instruction after kickoff; no engine search", "before": strings.TrimPrefix(before1.Hex(), "0x"), "after": strings.TrimPrefix(after1.Hex(), "0x"), "proof": hex.EncodeToString(proof1)},
	}
	write(*out, "boundary-selected-proofs.json", rows)
	gsHash := original.Start.Hash()
	errorHash := crypto.Keccak256Hash(append([]byte("Machine errored:"), gsHash.Bytes()...))
	report := map[string]any{"passed": true, "scope": "actual selected865 pinned Arbitrator/BoLD kickoff plus one raw entry instruction; no search, terminal execution, history bisection or dispute completion", "moduleRoot": selectedRoot, "originalCapturedModuleRoot": original.ModuleRoot, "candidateReplayIsNotOriginalParentConfig": true, "originalInputSHA256": originalInputSHA, "originalCaptureManifestSHA256": sha(*manifest), "machineSHA256": sha(filepath.Join(locator.GetMachinePath(common.HexToHash(selectedRoot)), "machine.v2.wavm.br")), "libstylusSHA256": sha("target/lib/libstylus.a"), "startState": original.Start, "globalStateHash": gsHash, "expectedErroredHashForSameGlobalState": errorHash, "kickoffBeforeHash": before, "kickoffAfterHash": rawStartHash, "afterFirstRawInstruction": after1, "actualWrappedStartStep": 0, "actualKickoffOffset": 1, "actualRawStepAfterKickoff": 0, "actualWrappedStepAfterOneRawInstruction": 2, "actualRawStepAfterOneRawInstruction": 1, "rawMachineMaxStepsFromPinnedSource": uint64(1) << 43, "sourceBoundIsNotACompletedTraceMeasurement": true, "SolidityVerified": false, "fullBoLDDisputeExecuted": false, "fullTerminalReplayExecuted": false, "enginePolicyChanged": false, "allExecutionOnRunpod": true, "publicDeployment": false, "goVersion": runtime.Version()}
	write(*out, "boundary-backend.json", report)
	fmt.Println("selected865 kickoff/raw-entry probe passed")
}
