package precompiles
import (
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "math/big"
 "os"
 "path/filepath"
 "testing"
 "time"
 sliced "github.com/Gh0stllm/GH0ST/gl3/slicedchess"
 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/rawdb"
 "github.com/ethereum/go-ethereum/core/state"
 "github.com/ethereum/go-ethereum/core/vm"
 "github.com/ethereum/go-ethereum/ethdb"
 "github.com/ethereum/go-ethereum/ethdb/pebble"
 "github.com/ethereum/go-ethereum/params"
 "github.com/ethereum/go-ethereum/triedb"
 "github.com/ethereum/go-ethereum/triedb/hashdb"
 "github.com/offchainlabs/nitro/arbos"
 "github.com/offchainlabs/nitro/arbos/arbosState"
 "github.com/offchainlabs/nitro/arbos/arbostypes"
 "github.com/offchainlabs/nitro/arbos/burn"
 "github.com/offchainlabs/nitro/cmd/chaininfo"
)
var gl3DiskRaw ethdb.Database
var gl3DiskTrie *triedb.Database
func gl3DiskOpen() state.Database {
 kv,e:=pebble.New(os.Getenv("GL3_DISK_PATH"),128,128,"gl3-disk-probe",false,&pebble.ExtraOptions{MaxConcurrentCompactions:func() int{return 2}});if e!=nil{panic(e)}
 gl3DiskRaw=rawdb.NewDatabase(kv);gl3DiskTrie=triedb.NewDatabase(gl3DiskRaw,&triedb.Config{Preimages:false,HashDB:hashdb.Defaults});return state.NewDatabase(gl3DiskTrie,nil)
}
func gl3DiskClose(){if gl3DiskTrie!=nil{gl3DiskTrie.Close();gl3DiskTrie=nil};if gl3DiskRaw!=nil{gl3DiskRaw.Close();gl3DiskRaw=nil}}
func gl3DiskBytes() int64 {var n int64;filepath.Walk(os.Getenv("GL3_DISK_PATH"),func(_ string,i os.FileInfo,e error)error{if e==nil&&i.Mode().IsRegular(){n+=i.Size()};return e});return n}
func gl3DiskMock(c,evmc *params.ChainConfig)*vm.EVM {
 db,e:=state.New(common.Hash{},gl3DiskOpen());if e!=nil{panic(e)}
 if _,e=arbosState.InitializeArbosState(db,burn.NewSystemBurner(nil,false),c,nil,arbostypes.TestInitMessage);e!=nil{panic(e)}
 ev:=vm.NewEVM(vm.BlockContext{BlockNumber:big.NewInt(0),GasLimit:^uint64(0)},db,evmc,vm.Config{});ev.ProcessingHook=&arbos.TxProcessor{};return ev
}
func gl3DiskCheckpoint(ev *vm.EVM,label,want string){
 at:=time.Now();root,e:=ev.StateDB.(*state.StateDB).Commit(ev.Context.BlockNumber.Uint64(),false,false);if e!=nil{panic(e)}
 if e=gl3DiskTrie.Commit(root,false);e!=nil{panic(e)};gl3DiskClose();size:=gl3DiskBytes()
 b,_:=json.MarshalIndent(map[string]any{"stateRoot":root,"physicalDatabaseBytes":size,"commitAndCloseSeconds":time.Since(at).Seconds(),"canonicalCheckpointSHA256":want},"","  ")
 if e=os.WriteFile(os.Getenv("GL3_DISK_PATH")+"-"+label+".json",append(b,'\n'),0600);e!=nil{panic(e)}
 db,e:=state.New(root,gl3DiskOpen());if e!=nil{panic(e)};ev.StateDB=db
}
func TestGL3DiskProcessRecovery(t *testing.T){
 path:=os.Getenv("GL3_DISK_PATH");if path==""{t.Fatal("explicit disk fixture required")}
 var saved struct{StateRoot common.Hash `json:"stateRoot"`;Expected string `json:"canonicalCheckpointSHA256"`};b,e:=os.ReadFile(path+"-terminal.json");if e!=nil{t.Fatal(e)};if e=json.Unmarshal(b,&saved);e!=nil{t.Fatal(e)}
 started:=time.Now();db,e:=state.New(saved.StateRoot,gl3DiskOpen());if e!=nil{t.Fatal(e)};defer gl3DiskClose()
 config:=chaininfo.ArbitrumDevTestChainConfig();ev:=vm.NewEVM(vm.BlockContext{BlockNumber:big.NewInt(1),GasLimit:^uint64(0)},db,config,vm.Config{});ev.ProcessingHook=&arbos.TxProcessor{}
 job:=[32]byte{23};owner:=common.HexToAddress("0x1234");burner:=burn.NewSystemBurner(nil,false)
 m,e:=sliceMetaRead(sliceStore(db,burner,sliceNamespace(owner,job)));if e!=nil{t.Fatal(e)};seed,e:=sliceMetaRead(sliceStore(db,burner,sliceSeedNamespace));if e!=nil{t.Fatal(e)}
 restored,e:=sliceRestoreSeed(ev,m,seed);if e!=nil{t.Fatal(e)};defer restored.VM.Close();canonical,e:=restored.VM.Canonical();if e!=nil{t.Fatal(e)};sum:=sha256.Sum256(canonical);got:=hex.EncodeToString(sum[:]);if got!=saved.Expected{t.Fatal("disk/process recovery changed canonical state",got)}
 report:=map[string]any{"passed":true,"scope":"separate OS-process recovery of committed actual EVM state from a closed/reopened Pebble database; not a complete sequencer reboot","canonicalCheckpointSHA256":got,"recoverySeconds":time.Since(started).Seconds(),"physicalDatabaseBytes":gl3DiskBytes(),"processID":os.Getpid(),"deltaCount":m.Deltas,"completeCanonicalBytes":len(canonical),"portableModuleSHA256":hex.EncodeToString(sliced.ModuleSHA[:]),"publicDeployment":false,"realChainSpend":0}
 b,_=json.MarshalIndent(report,"","  ");if e=os.WriteFile(path+"-recovery.json",append(b,'\n'),0600);e!=nil{t.Fatal(e)}
}
