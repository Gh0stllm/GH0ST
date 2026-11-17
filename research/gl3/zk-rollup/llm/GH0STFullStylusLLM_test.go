package precompiles_test

import (
 "bytes"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "math/big"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"

 "github.com/ethereum/go-ethereum/accounts/abi"
 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core"
 "github.com/ethereum/go-ethereum/core/rawdb"
 "github.com/ethereum/go-ethereum/core/state"
 "github.com/ethereum/go-ethereum/core/tracing"
 "github.com/ethereum/go-ethereum/core/types"
 "github.com/ethereum/go-ethereum/core/vm"
 "github.com/holiman/uint256"
 "github.com/offchainlabs/nitro/arbcompress"
 "github.com/offchainlabs/nitro/arbos"
 "github.com/offchainlabs/nitro/arbos/arbosState"
 "github.com/offchainlabs/nitro/arbos/programs"
 "github.com/offchainlabs/nitro/cmd/chaininfo"
 _ "github.com/offchainlabs/nitro/gethhook"
 "github.com/offchainlabs/nitro/solgen/go/precompilesgen"
)

const ghostLLMABI=`[
 {"type":"function","name":"modelInfo","inputs":[],"outputs":[{"type":"bytes32"},{"type":"uint32"},{"type":"uint32"},{"type":"uint32"},{"type":"uint32"},{"type":"uint32"},{"type":"bytes32"}]},
 {"type":"function","name":"registerPage","inputs":[{"type":"uint32"},{"type":"address"}],"outputs":[]},
 {"type":"function","name":"infer","inputs":[{"type":"uint256"},{"type":"uint32[]"}],"outputs":[{"type":"uint32"},{"type":"bytes32"},{"type":"bytes32"},{"type":"bytes"}]},
 {"type":"function","name":"result","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"},{"type":"uint32"},{"type":"bytes32"},{"type":"bytes32"},{"type":"bytes32"}]}
]`

func TestGH0STFullOrdinaryStylusLLM(t *testing.T) {
 started:=time.Now();root:=os.Getenv("GH0ST_FULL_STYLUS_LLM_DIR");if root==""{t.Skip("explicit isolated full model fixture required")}
 read:=func(name string)[]byte{b,e:=os.ReadFile(filepath.Join(root,name));if e!=nil{t.Fatal(e)};return b}
 digest:=func(b []byte)string{d:=sha256.Sum256(b);return hex.EncodeToString(d[:])}
 wasm:=read(".cache/tinystories-stylus.wasm");model:=read(".cache/model.bin")
 if len(model)!=4401034||digest(model)!="6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f"{t.Fatal("wrong complete model")}
 var build struct{Artifacts map[string]struct{SHA256 string `json:"SHA256"`} `json:"artifacts"`};if e:=json.Unmarshal(read("evidence/build.json"),&build);e!=nil{t.Fatal(e)}
 if digest(wasm)!=build.Artifacts["tinystories-stylus.wasm"].SHA256{t.Fatal("adapter build identity")}
 localTarget:=rawdb.LocalTarget();if e:=programs.SetTarget(localTarget,"",true);e!=nil{t.Fatal(e)}
 cfg:=chaininfo.ArbitrumDevTestChainConfig();cfg.ArbitrumChainParams.InitialArbOSVersion=60
 _,db:=arbosState.NewArbosMemoryBackedArbOSStateWithConfig(cfg)
 caller:=common.HexToAddress("0x1234");other:=common.HexToAddress("0x5678");program:=common.HexToAddress("0x3434")
 for _,a:=range []common.Address{caller,other}{db.AddBalance(a,uint256.MustFromBig(new(big.Int).Exp(big.NewInt(10),big.NewInt(24),nil)),tracing.BalanceChangeUnspecified)}
 compressed,e:=arbcompress.Compress(wasm,arbcompress.LEVEL_WELL,arbcompress.EmptyDictionary);if e!=nil{t.Fatal(e)}
 if len(compressed)+3>24576{t.Fatal("requires root/fragment deployment",len(compressed))}
 db.SetCode(program,append(state.NewStylusPrefix(byte(arbcompress.EmptyDictionary)),compressed...),tracing.CodeChangeUnspecified)
 block:=vm.BlockContext{CanTransfer:core.CanTransfer,Transfer:core.Transfer,GetHash:func(uint64)common.Hash{return common.Hash{}},BlockNumber:big.NewInt(1),GasLimit:1000000000,ArbOSVersion:60,Time:3600,BaseFee:big.NewInt(1),BlobBaseFee:big.NewInt(1)}
 txCounter:=uint32(0)
 makeEVM:=func(sender common.Address)*vm.EVM{
   db.Finalise(true);db.SetTxContext(common.BigToHash(big.NewInt(int64(txCounter))),int(txCounter),txCounter);txCounter++
   rules:=cfg.Rules(block.BlockNumber,true,block.Time,block.ArbOSVersion);db.Prepare(rules,sender,common.Address{},&program,vm.ActivePrecompiles(rules),nil)
   evm:=vm.NewEVM(block,db,cfg,vm.Config{});evm.SetTxContext(vm.TxContext{Origin:sender,GasPrice:uint256.NewInt(1)})
   evm.ProcessingHook=arbos.NewTxProcessor(evm,&core.Message{From:sender,TxRunContext:core.NewMessageCommitContext([]rawdb.WasmTarget{localTarget})});return evm
 }
 activationABI,e:=abi.JSON(strings.NewReader(precompilesgen.ArbWasmMetaData.ABI));if e!=nil{t.Fatal(e)}
 input,_:=activationABI.Pack("activateProgram",program)
 evm:=makeEVM(caller);out,left,_,e:=evm.Call(caller,types.ArbWasmAddress,input,vm.NewGasBudget(1000000000,0),uint256.MustFromBig(new(big.Int).Exp(big.NewInt(10),big.NewInt(21),nil)))
 if e!=nil{t.Fatalf("actual ArbWasm activation failed: %v %x",e,out)}
 activated,e:=activationABI.Unpack("activateProgram",out);if e!=nil{t.Fatal(e)}
 activationGas:=1000000000-left.RegularGas
 contractABI,e:=abi.JSON(strings.NewReader(ghostLLMABI));if e!=nil{t.Fatal(e)}
 pack:=func(name string,args ...any)[]byte{b,e:=contractABI.Pack(name,args...);if e!=nil{t.Fatal(e)};return b}
 records:=[]map[string]any{};negative:=[]string{}
 call:=func(sender common.Address,input []byte,gas uint64)([]byte,uint64,error){evm:=makeEVM(sender);out,left,_,e:=evm.Call(sender,program,input,vm.NewGasBudget(gas,0),uint256.NewInt(0));return out,gas-left.RegularGas,e}
 result:=func(sender common.Address)[]any{out,_,e:=call(caller,pack("result",sender),100000000);if e!=nil{t.Fatal("result",e)};v,e:=contractABI.Unpack("result",out);if e!=nil{t.Fatal(e)};return v}
 reject:=func(name string,sender common.Address,input []byte,gas uint64){before:=result(sender);out,used,e:=call(sender,input,gas);if e==nil{t.Fatal("expected actual Stylus rejection",name)};after:=result(sender);if !bytes.Equal(pack("infer",before[0],[]uint32{before[1].(uint32)}),pack("infer",after[0],[]uint32{after[1].(uint32)})){t.Fatal("nonce/token mutation on rejection",name)};for i:=2;i<5;i++{if before[i]!=after[i]{t.Fatal("commitment mutation on rejection",name)}};negative=append(negative,name);records=append(records,map[string]any{"name":name,"expectedRevert":true,"gasUsed":used,"error":e.Error(),"returnHex":hex.EncodeToString(out)})}
 info,_,e:=call(caller,pack("modelInfo"),100000000);if e!=nil{t.Fatal(e)};meta,e:=contractABI.Unpack("modelInfo",info);if e!=nil||meta[1].(uint32)!=3745984||meta[3].(uint32)!=64||meta[4].(uint32)!=50257||meta[5].(uint32)!=8{t.Fatal("full geometry",meta,e)}
 reject("missing model pages",caller,pack("infer",big.NewInt(0),[]uint32{7454}),100000000)
 bad:=common.HexToAddress("0xbad1");badData:=append([]byte{0},model[:24000]...);badData[9]^=1;db.SetCode(bad,badData,tracing.CodeChangeUnspecified)
 reject("wrong immutable page rejected",caller,pack("registerPage",uint32(0),bad),100000000)
 registrationGas:=uint64(0);pageAddresses:=[]common.Address{}
 for offset,index:=0,0;offset<len(model);offset,index=offset+24000,index+1{
   end:=offset+24000;if end>len(model){end=len(model)};address:=common.BigToAddress(big.NewInt(int64(0x100000+index)));pageAddresses=append(pageAddresses,address)
   db.SetCode(address,append([]byte{0},model[offset:end]...),tracing.CodeChangeUnspecified)
   ret,used,e:=call(caller,pack("registerPage",uint32(index),address),100000000);if e!=nil{t.Fatalf("page %d register: %v %x",index,e,ret)};registrationGas+=used
 }
 var goldens []struct{Prompt []uint32 `json:"prompt"`;NextToken uint32 `json:"nextToken"`;LogitsSHA256 string `json:"logitsSHA256"`;CheckpointSHA256 string `json:"checkpointSHA256"`;LogitsFile string `json:"logitsFile"`}
 if e:=json.Unmarshal(read(".cache/goldens.json"),&goldens);e!=nil{t.Fatal(e)}
 for index,g:=range goldens{
   budget:=uint64(100000000);if len(g.Prompt)==64{budget=1000000000}
   input:=pack("infer",big.NewInt(int64(index)),g.Prompt);before:=db.IntermediateRoot(true);start:=time.Now();ret,used,e:=call(caller,input,budget);seconds:=time.Since(start).Seconds();if e!=nil{t.Fatalf("full ordinary Stylus prompt %v at gas cap %d: %v %x",g.Prompt,budget,e,ret)}
   decoded,e:=contractABI.Unpack("infer",ret);if e!=nil{t.Fatal(e)};logits:=decoded[3].([]byte);expected:=read(".cache/"+g.LogitsFile)
   if decoded[0].(uint32)!=g.NextToken||!bytes.Equal(logits,expected)||digest(logits)!=g.LogitsSHA256{t.Fatal("all 50,257 exact logits/argmax differ",index)}
   stateHash:=decoded[2].([32]byte);if hex.EncodeToString(stateHash[:])!=g.CheckpointSHA256{t.Fatal("complete canonical checkpoint/KV differs",index)}
   stored:=result(caller);promptHash:=sha256.Sum256(input[68:]);if stored[0].(*big.Int).Uint64()!=uint64(index+1)||stored[1].(uint32)!=g.NextToken||stored[2]!=decoded[1]||stored[3]!=decoded[2]||stored[4]!=promptHash{t.Fatal("authenticated per-caller stored result",index)}
   records=append(records,map[string]any{"name":"full inference","prompt":g.Prompt,"caller":caller.Hex(),"nonce":index,"nextToken":g.NextToken,"allLogitsCompared":50257,"logitsSHA256":digest(logits),"checkpointSHA256":g.CheckpointSHA256,"gasAllowance":budget,"gasUsed":used,"wallSeconds":seconds,"calldataHex":hex.EncodeToString(input),"returnSHA256":digest(ret),"preStateRoot":before.Hex(),"postStateRoot":db.IntermediateRoot(true).Hex()})
   t.Logf("actual ordinary Stylus prompt length %d: all 50,257 logits + full KV checkpoint + caller result match; gas=%d allowance=%d seconds=%f",len(g.Prompt),used,budget,seconds)
 }
 reject("replayed nonce",caller,pack("infer",big.NewInt(0),[]uint32{7454}),100000000)
 nextNonce:=big.NewInt(int64(len(goldens)))
 reject("invalid token",caller,pack("infer",nextNonce,[]uint32{50257}),100000000)
 reject("65 token context rejected",caller,pack("infer",nextNonce,make([]uint32,65)),100000000)
 reject("empty prompt",caller,pack("infer",nextNonce,[]uint32{}),100000000)
 reject("other caller cannot use prior nonce",other,pack("infer",big.NewInt(2),[]uint32{7454}),100000000)
 reject("out of gas rollback",caller,pack("infer",nextNonce,[]uint32{7454}),1000)
 reject("unknown selector",caller,[]byte{1,2,3,4},100000000)
 original:=append([]byte{0},model[:24000]...);corrupt:=append([]byte{},original...);corrupt[9]^=1;db.SetCode(pageAddresses[0],corrupt,tracing.CodeChangeUnspecified)
 reject("changed model code rejected on complete hash",caller,pack("infer",nextNonce,[]uint32{7454}),100000000);db.SetCode(pageAddresses[0],original,tracing.CodeChangeUnspecified)
 lengths:=[]int{};for _,g:=range goldens{lengths=append(lengths,len(g.Prompt))}
 arithmeticID:=meta[6].([32]byte)
 report:=map[string]any{"schema":"gl3.llm.ordinary-stylus.v1","scope":"Actual ordinary Nitro ArbWasm activation plus real Geth EVM Call and native Stylus full TinyStories inference with authenticated EVM code-data/model and per-caller result storage; artificial in-memory private state, not a sequencer transaction or zk proof","allExecutionOnRunpod":true,"nativeStylusActivated":true,"actualOrdinaryStylusCalls":true,"modelParameters":3745984,"modelBytes":len(model),"modelSHA256":digest(model),"arithmeticID":hex.EncodeToString(arithmeticID[:]),"layers":8,"contextSupported":64,"promptLengthsExecuted":lengths,"logitsCompared":50257*len(goldens),"wasmBytes":len(wasm),"wasmSHA256":digest(wasm),"compressedWasmBytes":len(compressed),"activationVersion":activated[0],"activationGasUsed":activationGas,"pageBytes":24000,"pageCount":len(pageAddresses),"pageRegistrationGasTotal":registrationGas,"pageCodeDepositGasOnly":len(model)*200+len(pageAddresses)*200,"pageDeploymentTransactionsExecuted":false,"modelPagesInstalledAsFixtureEVMCode":true,"records":records,"negativeTests":negative,"wallSeconds":time.Since(started).Seconds(),"zkVMExecutionOrValidityProof":false,"chainBooted":false,"financialAction":false,"limitations":[]string{"Native fixture prompts are separate calls; intermediate per-position numerical parity is recorded in build evidence","Prompt history and full KV recomputed each call; no persistent-KV speed claim","Private artificial fixture uses large local gas budgets; gas is not a fee quote","Page code installed directly for bounded activation/inference fixture; publication transactions and their full fee not tested","Native Stylus execution alone is not canonical zkVM execution or an accepted validity proof"}}
 body,_:=json.MarshalIndent(report,"","  ");if e:=os.WriteFile(filepath.Join(root,"evidence/native-stylus.json"),append(body,'\n'),0644);e!=nil{t.Fatal(e)};t.Logf("full ordinary Stylus model: %d exact logits and %d negative cases",50257*len(goldens),len(negative))
}
