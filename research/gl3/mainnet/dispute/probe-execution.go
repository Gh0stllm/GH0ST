// Runpod-only acceptance of the pinned execution-run API over a recorded block.
// The guest engine, instruction budget and module remain unchanged.
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
 "time"

 "github.com/ethereum/go-ethereum/common"
 "github.com/offchainlabs/nitro/validator"
 "github.com/offchainlabs/nitro/validator/server_api"
 "github.com/offchainlabs/nitro/validator/server_arb"
 "github.com/offchainlabs/nitro/validator/server_common"
)

func check(err error) { if err!=nil {panic(err)} }
type progressMachine struct { server_arb.MachineInterface; file string }
func (p *progressMachine) CloneMachineInterface() server_arb.MachineInterface { return &progressMachine{p.MachineInterface.CloneMachineInterface(),p.file} }
func (p *progressMachine) Step(ctx context.Context,n uint64) error {
 for n>0 && p.IsRunning() {
  chunk:=n;if chunk>100_000_000 {chunk=100_000_000}
  if err:=p.MachineInterface.Step(ctx,chunk);err!=nil{return err};n-=chunk
  bytes,_:=json.Marshal(map[string]any{"step":p.GetStepCount(),"running":p.IsRunning(),"asOfUTC":time.Now().UTC()})
  check(os.WriteFile(p.file+".tmp",bytes,0600));check(os.Rename(p.file+".tmp",p.file))
 }
 return nil
}
func main() {
 if runtime.GOOS!="linux" {panic("Run all execution on Runpod/Linux")}
 inputPath:=flag.String("input","","captured input JSON")
 machines:=flag.String("machines","","matching custom machine directory")
 out:=flag.String("out","","output directory")
 flag.Parse();if *inputPath==""||*machines==""||*out==""{panic("all path flags required")}
 check(os.MkdirAll(*out,0700));started:=time.Now()
 write:=func(name string,v any){bytes,e:=json.MarshalIndent(v,"","  ");check(e);check(os.WriteFile(filepath.Join(*out,name),append(bytes,'\n'),0600))}
 file,e:=os.Open(*inputPath);check(e);digest:=sha256.New();_,e=io.Copy(digest,file);check(e);check(file.Close())
 inputSHA:=hex.EncodeToString(digest.Sum(nil));if inputSHA!="bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90"{panic("wrong captured terminal input")}
 write("phase.json",map[string]any{"phase":"DECODING_INPUT","inputSHA256":inputSHA})
 file,e=os.Open(*inputPath);check(e);var encoded server_api.InputJSON;check(json.NewDecoder(file).Decode(&encoded));check(file.Close())
 if encoded.ExpectedEndState==nil{panic("missing expected four-field result")};expected:=*encoded.ExpectedEndState
 input,e:=server_api.ValidationInputFromJson(&encoded);check(e);encoded=server_api.InputJSON{};runtime.GC()
 const root="0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b"
 locator,e:=server_common.NewMachineLocator(*machines);check(e)
 cfg:=server_arb.DefaultArbitratorSpawnerConfig;cfg.Workers=1;cfg.OutputPath=*out;cfg.ExecutionRunTimeout=4*time.Hour
 cfg.Execution.CachedChallengeMachines=2
 ctx,cancel:=context.WithTimeout(context.Background(),4*time.Hour);defer cancel()
 spawner,e:=server_arb.NewArbitratorSpawner(locator,func()*server_arb.ArbitratorSpawnerConfig{return &cfg},server_arb.WithWrapper(func(m server_arb.MachineInterface) server_arb.MachineInterface{return &progressMachine{m,filepath.Join(*out,"machine-progress.json")}}));check(e);check(spawner.Start(ctx));defer spawner.Stop()
 execution,e:=spawner.CreateExecutionRun(common.HexToHash(root),input,true).Await(ctx);check(e);defer execution.Close()
 write("phase.json",map[string]any{"phase":"POPULATING_REAL_EXECUTION_CACHE","moduleRoot":root,"cachedMachines":2,"inputSHA256":inputSHA})
 terminal,e:=execution.GetLastStep().Await(ctx);check(e)
 if terminal.Status!=validator.MachineStatusFinished||terminal.GlobalState!=expected{panic("terminal execution does not match all expected fields")}
 write("phase.json",map[string]any{"phase":"CHECKING_PREFIX_API","terminalStep":terminal.Position,"actualEnd":terminal.GlobalState})
 zero,e:=execution.GetStepAt(0).Await(ctx);check(e);one,e:=execution.GetStepAt(1).Await(ctx);check(e)
 if zero.Status!=validator.MachineStatusFinished||zero.GlobalState!=input.StartState||one.Status!=validator.MachineStatusRunning||one.Position!=1{panic("BoLD one-step offset mismatch")}
 hashes,e:=execution.GetMachineHashesWithStepSize(0,1,3).Await(ctx);check(e);if len(hashes)!=3||hashes[0]!=zero.Hash||hashes[1]!=one.Hash{panic("history hash prefix mismatch")}
 proof,e:=execution.GetProofAt(0).Await(ctx);check(e)
 witnesses:=[]map[string]any{{"step":"0","reason":"real_execution_run_bold_boundary","before":hex.EncodeToString(zero.Hash[:]),"after":hex.EncodeToString(one.Hash[:]),"proof":hex.EncodeToString(proof)}}
 write("execution-boundary-proofs.json",witnesses)
 report:=map[string]any{"passed":true,"scope":"real pinned ArbitratorSpawner execution-run/cache API completed one recorded terminal compute block and exported authentic initial history/proof; not a complete BoLD contract dispute or whole24m-move interpreter trace","moduleRoot":root,"inputSHA256":inputSHA,"allFourGlobalStateFieldsMatch":true,"terminal":terminal,"prefixHashes":hashes,"initialProofBytes":len(proof),"cachedChallengeMachines":2,"guestEnginePolicyChanged":false,"progressWrapperOnlySplitsHostStepRequests":true,"fullBoLDDisputeExecuted":false,"entire24mWAVMMoveExecuted":false,"allExecutionOnRunpod":true,"publicDeployment":false,"seconds":time.Since(started).Seconds(),"goVersion":runtime.Version()}
 write("execution-run-result.json",report);fmt.Println("EXECUTION_RUN_API_PASSED")
}
