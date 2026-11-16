package state

import (
 "bytes"
 "fmt"
 "testing"

 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/stateless"
 "github.com/ethereum/go-ethereum/core/tracing"
 "github.com/ethereum/go-ethereum/core/types"
 "github.com/ethereum/go-ethereum/crypto"
)

func gl3HistoricalCode(t *testing.T, count int) (*StateDB, Database, common.Hash, map[common.Address][]byte) {
 t.Helper()
 db := NewDatabaseForTesting()
 s, err := New(types.EmptyRootHash, db); if err != nil { t.Fatal(err) }
 codes := make(map[common.Address][]byte)
 for i:=0; i<count; i++ {
  addr := common.BytesToAddress([]byte{byte(i>>8),byte(i),1})
  code := bytes.Repeat([]byte{byte(i),byte(i>>8),0x5b},8192)
  codes[addr] = code; s.SetCode(addr, code, tracing.CodeChangeUnspecified)
 }
 root, err := s.Commit(0,false,false); if err != nil { t.Fatal(err) }
 s, err = New(root,db); if err != nil { t.Fatal(err) }
 return s,db,root,codes
}

type gl3ObservedReader struct { Reader; calls int; missing bool; hashes map[common.Address]common.Hash }
func (r *gl3ObservedReader) Code(a common.Address, h common.Hash) []byte {
 r.calls++; r.hashes[a]=h
 if r.missing { return nil }; return r.Reader.Code(a,h)
}

func TestGL3UncachedHistoricalCodeDoesNotRetain(t *testing.T) {
 s,db,root,codes := gl3HistoricalCode(t,128)
 observed := &gl3ObservedReader{Reader:s.reader,hashes:make(map[common.Address]common.Hash)}; s.reader=observed
 for a,want := range codes {
  if got:=s.GetCodeUncached(a); !bytes.Equal(got,want) { t.Fatalf("code %s",a) }
  if len(s.getStateObject(a).code)!=0 || s.getStateObject(a).dirtyCode { t.Fatal("historical account retained bytes") }
  if observed.hashes[a]!=crypto.Keccak256Hash(want) { t.Fatal("reader lost authenticated code hash") }
 }
 if observed.calls!=len(codes) || s.CodeLoadBytes!=len(codes)*24576 { t.Fatal("reader/metrics path not preserved",observed.calls,s.CodeLoadBytes) }
 if s.IntermediateRoot(false)!=root { t.Fatal("read changed state root") }
 normal,err:=New(root,db); if err!=nil {t.Fatal(err)}
 for a,want:=range codes { if !bytes.Equal(normal.GetCode(a),want)||len(normal.getStateObject(a).code)==0 {t.Fatal("baseline read") } }
 if normal.IntermediateRoot(false)!=s.IntermediateRoot(false) {t.Fatal("roots differ")}
 t.Logf("%d historical accounts, %d bytes retained in account cache after optional reads; baseline retains %d",len(codes),0,len(codes)*24576)
}

func TestGL3UncachedCachedDirtyCopyAndRevert(t *testing.T) {
 s,db,root,codes:=gl3HistoricalCode(t,1)
 var addr common.Address; var old []byte; for a,c:=range codes {addr,old=a,c}
 baseline,err:=New(root,db);if err!=nil {t.Fatal(err)}
 baseline.GetCode(addr);s.GetCodeUncached(addr)
 for label,subject:=range map[string]*StateDB{"original":s,"copy":s.Copy()} {
  snap:=subject.Snapshot()
  replacement:=[]byte{0x60,0x99,0x00}
  previous:=subject.SetCode(addr,replacement,tracing.CodeChangeUnspecified)
  if !bytes.Equal(previous,old) || !bytes.Equal(subject.GetCodeUncached(addr),replacement) {t.Fatal(label,"dirty read or prior journal code lost")}
  subject.RevertToSnapshot(snap)
  if !bytes.Equal(subject.GetCodeUncached(addr),old) || subject.GetCodeHash(addr)!=crypto.Keccak256Hash(old) {t.Fatal(label,"revert")}
  if subject.IntermediateRoot(false)!=baseline.IntermediateRoot(false) {t.Fatal(label,"root")}
 }
 // Explicit empty dirty code must not reload old bytes from the backing reader.
 s.SetCode(addr,nil,tracing.CodeChangeUnspecified)
 if len(s.GetCodeUncached(addr))!=0 || s.GetCodeHash(addr)!=types.EmptyCodeHash {t.Fatal("dirty empty code ignored")}
}

func TestGL3UncachedWitnessHookAndErrors(t *testing.T) {
 s,db,root,codes:=gl3HistoricalCode(t,1)
 var a common.Address;var code []byte;for k,v:=range codes {a,code=k,v}
 s.witness=&stateless.Witness{Codes:make(map[string]struct{})}
 h:=NewHookedState(s,nil)
 if !bytes.Equal(h.GetCodeUncached(a),code) {t.Fatal("hook forwarding")}
 if _,ok:=s.witness.Codes[string(code)];!ok {t.Fatal("witness code omitted")}
 for _,uncached:=range []bool{false,true} {
  broken,err:=New(root,db);if err!=nil {t.Fatal(err)}
  broken.reader=&gl3ObservedReader{Reader:broken.reader,missing:true,hashes:make(map[common.Address]common.Hash)}
  var got []byte;if uncached {got=broken.GetCodeUncached(a)} else {got=broken.GetCode(a)}
  if len(got)!=0 || broken.Error()==nil || broken.Error().Error()!=fmt.Sprintf("code is not found %x",crypto.Keccak256(code)) {t.Fatal("missing-code error path differs",uncached,broken.Error())}
 }
 if s.GetCodeUncached(common.HexToAddress("0xabcdef"))!=nil {t.Fatal("missing account")}
}
