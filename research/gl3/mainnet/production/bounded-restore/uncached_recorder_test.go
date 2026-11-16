package arbitrum

import (
 "bytes"
 "reflect"
 "testing"

 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/state"
 "github.com/ethereum/go-ethereum/core/tracing"
 "github.com/ethereum/go-ethereum/core/types"
 "github.com/ethereum/go-ethereum/crypto"
)

func TestGL3UncachedTipRecordingMatchesOrdinary(t *testing.T) {
 db:=state.NewDatabaseForTesting()
 s,err:=state.New(types.EmptyRootHash,db);if err!=nil{t.Fatal(err)}
 a:=common.HexToAddress("0x1234");code:=bytes.Repeat([]byte{0,0x47,0x4c,0x33},4096)
 s.SetCode(a,code,tracing.CodeChangeUnspecified)
 root,err:=s.Commit(0,false,false);if err!=nil{t.Fatal(err)}
 normalDB:=NewTipRecordingStateDatabase(db);uncachedDB:=NewTipRecordingStateDatabase(db)
 normal,err:=state.NewRecording(root,normalDB);if err!=nil{t.Fatal(err)}
 uncached,err:=state.NewRecording(root,uncachedDB);if err!=nil{t.Fatal(err)}
 if !bytes.Equal(normal.GetCode(a),uncached.GetCodeUncached(a)){t.Fatal("code")}
 normalDB.StopRecording();uncachedDB.StopRecording()
 assertRecordedCodeHashes(t,normalDB.CodeHashes(),crypto.Keccak256Hash(code))
 assertRecordedCodeHashes(t,uncachedDB.CodeHashes(),crypto.Keccak256Hash(code))
 if !reflect.DeepEqual(normalDB.Preimages(),uncachedDB.Preimages()){t.Fatal("authenticated trie preimages differ")}
 if normal.IntermediateRoot(false)!=uncached.IntermediateRoot(false){t.Fatal("root")}
 t.Logf("same account preimages (%d) and authenticated code hash",len(normalDB.Preimages()))
}
