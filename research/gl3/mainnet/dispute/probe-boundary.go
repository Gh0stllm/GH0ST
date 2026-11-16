// Build and run inside the pinned Linux Nitro source tree on Runpod.
// This checks the real BoLD wrapper's finished-to-running boundary.
package main

import (
 "context"
 "encoding/hex"
 "encoding/json"
 "flag"
 "fmt"
 "os"
 "path/filepath"
 "runtime"
 "strings"
 "time"

 "github.com/ethereum/go-ethereum/common"
 "github.com/offchainlabs/nitro/validator"
 "github.com/offchainlabs/nitro/validator/server_arb"
 "github.com/offchainlabs/nitro/validator/server_common"
)

func must(err error) { if err != nil { panic(err) } }
func main() {
 if runtime.GOOS != "linux" { panic("Run all execution on Runpod/Linux") }
 manifestPath:=flag.String("manifest","","captured terminal input manifest")
 machineDir:=flag.String("machines","","matching custom machine directory")
 out:=flag.String("out","","private output directory")
 flag.Parse()
 if *manifestPath=="" || *machineDir=="" || *out=="" { panic("all path flags required") }
 var meta struct { ModuleRoot string `json:"moduleRoot"`; StartState validator.GoGlobalState `json:"startState"` }
 data,err:=os.ReadFile(*manifestPath);must(err);must(json.Unmarshal(data,&meta))
 const pinned="0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b"
 if meta.ModuleRoot!=pinned { panic("wrong captured module root") }
 must(os.MkdirAll(*out,0700))
 ctx,cancel:=context.WithTimeout(context.Background(),10*time.Minute);defer cancel()
 locator,err:=server_common.NewMachineLocator(*machineDir);must(err)
 loader:=server_arb.NewArbMachineLoader(&server_arb.DefaultArbitratorMachineConfig,locator)
 initial,err:=loader.GetZeroStepMachine(ctx,common.HexToHash(pinned));must(err)
 inner:=initial.Clone();must(inner.SetGlobalState(meta.StartState))
 wrapped:=server_arb.BoldMachineWrapper(inner);defer wrapped.Destroy()
 if wrapped.GetStepCount()!=0 || wrapped.Status()!=uint8(validator.MachineStatusFinished) || wrapped.GetGlobalState()!=meta.StartState { panic("incorrect BoLD initial boundary") }
 before:=wrapped.Hash();proof:=wrapped.ProveNextStep()
 must(wrapped.Step(ctx,1))
 if wrapped.GetStepCount()!=1 || wrapped.Status()!=uint8(validator.MachineStatusRunning) || wrapped.GetGlobalState()!=meta.StartState { panic("incorrect BoLD one-step offset") }
 after:=wrapped.Hash()
 witnesses:=[]map[string]any{{"step":"0","reason":"real_bold_finished_to_running_boundary","before":strings.TrimPrefix(before.Hex(),"0x"),"after":strings.TrimPrefix(after.Hex(),"0x"),"proof":hex.EncodeToString(proof)}}
 bytes,err:=json.MarshalIndent(witnesses,"","  ");must(err);must(os.WriteFile(filepath.Join(*out,"boundary-selected-proofs.json"),append(bytes,'\n'),0600))
 report:=map[string]any{"passed":true,"scope":"real pinned Arbitrator machine loader and BoLD wrapper initial boundary; no execution search or full dispute implied","moduleRoot":pinned,"startState":meta.StartState,"beforeHash":before,"afterHash":after,"proofBytes":len(proof),"offset":1,"SolidityVerified":false,"fullBoLDDisputeExecuted":false,"chessPolicyChanged":false,"allExecutionOnRunpod":true,"publicDeployment":false,"goVersion":runtime.Version()}
 bytes,err=json.MarshalIndent(report,"","  ");must(err);must(os.WriteFile(filepath.Join(*out,"boundary-backend.json"),append(bytes,'\n'),0600));fmt.Println(string(bytes))
}
