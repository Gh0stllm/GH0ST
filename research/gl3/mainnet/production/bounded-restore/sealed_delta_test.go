package precompiles

import (
 "bytes"
 "crypto/sha256"
 "encoding/binary"
 "reflect"
 "testing"

 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/state"
 "github.com/ethereum/go-ethereum/core/tracing"
 "github.com/ethereum/go-ethereum/core/types"
 "github.com/ethereum/go-ethereum/core/vm"
)

type gl3DeltaReader struct { vm.StateDB; uncached,ordinary int }
func(r *gl3DeltaReader)GetCodeUncached(a common.Address)[]byte{r.uncached++;return r.StateDB.(interface{GetCodeUncached(common.Address)[]byte}).GetCodeUncached(a)}
func(r *gl3DeltaReader)GetCode(a common.Address)[]byte{r.ordinary++;return r.StateDB.GetCode(a)}
type gl3FallbackReader struct { vm.StateDB }
func gl3DeltaBody(prior [32]byte, offset int,value byte)[]byte{
 body:=make([]byte,80);copy(body,"GSD1");copy(body[4:36],prior[:]);binary.LittleEndian.PutUint32(body[36:40],65536);binary.LittleEndian.PutUint32(body[40:44],1);binary.LittleEndian.PutUint32(body[44:48],uint32(offset));copy(body[48:],bytes.Repeat([]byte{value},32));return body
}
func TestGL3SealedDeltaCommittedHistoryFallbackAndCorruption(t *testing.T){
 db:=state.NewDatabaseForTesting();s,err:=state.New(types.EmptyRootHash,db);if err!=nil{t.Fatal(err)}
 ctx:=&Context{gasSupplied:1_000_000_000}
 var head [32]byte
 for i:=0;i<768;i++ {head,err=sliceWriteDelta(ctx,s,gl3DeltaBody(head,(i%64)*32,byte(i)));if err!=nil{t.Fatal(err)}}
 root,err:=s.Commit(0,false,false);if err!=nil{t.Fatal(err)}
 open:=func()*state.StateDB{x,e:=state.New(root,db);if e!=nil{t.Fatal(e)};return x}
 fast:=&gl3DeltaReader{StateDB:state.NewHookedState(open(),nil)};normal:=&gl3FallbackReader{StateDB:open()}
 want,got:=make([]byte,65536),make([]byte,65536)
 m:=sliceMeta{Deltas:768,Head:head}
 a,b:=map[common.Address]common.Hash{},map[common.Address]common.Hash{}
 if e:=sliceApplyDeltas(fast,m,got,a);e!=nil{t.Fatal(e)}
 if e:=sliceApplyDeltas(normal,m,want,b);e!=nil{t.Fatal(e)}
 if !bytes.Equal(got,want)||!reflect.DeepEqual(a,b)||fast.uncached!=768||fast.ordinary!=0{t.Fatal("fallback/read identity",fast.uncached,fast.ordinary)}
 if fast.StateDB.IntermediateRoot(false)!=normal.StateDB.IntermediateRoot(false){t.Fatal("read root")}
 // A forged body can satisfy its self-hash while violating delta cell ordering.
 malformed:=gl3DeltaBody([32]byte{},0,1);binary.LittleEndian.PutUint32(malformed[44:48],1)
 forged,e:=sliceWriteDelta(ctx,open(),malformed);if e!=nil{t.Fatal(e)}
 forgedState:=open();_,e=sliceWriteDelta(ctx,forgedState,malformed);if e!=nil{t.Fatal(e)}
 if sliceApplyDeltas(forgedState,sliceMeta{Deltas:1,Head:forged},make([]byte,65536),map[common.Address]common.Hash{})==nil{t.Fatal("misaligned cell accepted")}
 for _,kind:=range []string{"payload","prefix","length","missing"}{
  bad:=open();address:=sliceDeltaAddress(head,0);code:=bytes.Clone(bad.GetCode(address))
  switch kind {case "payload":code[len(code)-1]^=1;case "prefix":code[1]^=1;case "length":binary.LittleEndian.PutUint32(code[len(sliceDeltaPrefix):],1);case "missing":code=nil}
  bad.SetCode(address,code,tracing.CodeChangeUnspecified)
  if _,e:=sliceReadDelta(bad,head);e==nil{t.Fatal(kind,"accepted")}
 }
 // Exercise a multi-chunk sealed body, including last-chunk length and SHA binding.
 large:=bytes.Repeat([]byte{0x55},3*sliceBlobPage+19);largeState:=open()
 digest,e:=sliceWriteDelta(ctx,largeState,large);if e!=nil{t.Fatal(e)}
 restored,e:=sliceReadDelta(largeState,digest);if e!=nil||!bytes.Equal(restored,large)||sha256.Sum256(restored)!=digest{t.Fatal("multi chunk",e)}
 t.Logf("%d committed historical deltas, optional/fallback bytes and code identities identical; write gas %d",fast.uncached,ctx.Burned())
}
