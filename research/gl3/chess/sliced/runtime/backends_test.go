package slicedchess

import (
 "bytes"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "os"
 "reflect"
 "testing"
 "time"
)
func TestCompilerInterpreterContinuations(t *testing.T){
 r,e:=Shared();if e!=nil{t.Fatal(e)};v,e:=r.Instantiate();if e!=nil{t.Fatal(e)};defer v.Close();if e=v.Init();e!=nil{t.Fatal(e)}
 interpreter,e:=New(true);if e!=nil{t.Fatal(e)};defer interpreter.Close()
 p,e:=v.Begin("e2e4");if e!=nil{t.Fatal(e)};var records []map[string]any;start:=time.Now()
 for _,target:=range []uint32{4,4000,9850}{
  for p.Pending&&p.Step<target{p,e=v.Advance();if e!=nil{t.Fatal(e)}};if p.Step!=target{t.Fatal("checkpoint not reached",p)}
  image:=v.Image();other,e:=interpreter.Instantiate();if e!=nil{t.Fatal(e)};if e=other.Restore(image);e!=nil{t.Fatal(e)};at:=time.Now();var q Progress;count:=0
  for count<4&&p.Pending{p,e=v.Advance();if e!=nil{t.Fatal(e)};q,e=other.Advance();if e!=nil||p!=q{t.Fatal("compiler/interpreter progress",p,q,e)};count++}
  if !bytes.Equal(v.Memory(),other.Memory())||!reflect.DeepEqual(v.Globals(),other.Globals()){t.Fatal("complete VM image differs")}
  sum:=sha256.Sum256(v.Memory());records=append(records,map[string]any{"startingEngineStep":target,"stepsCompared":count,"endProgress":p,"memoryBytes":len(v.Memory()),"memorySHA256":hex.EncodeToString(sum[:]),"allBytesAndGlobalsMatch":true,"seconds":time.Since(at).Seconds()});other.Close();t.Log("exact backend checkpoint",target)
 }
 if p.Pending||p.Move!="e7e5"||p.Nodes!=24000033||p.Depth!=38{t.Fatal("full policy",p)};state,e:=v.Canonical();if e!=nil{t.Fatal(e)};sum:=sha256.Sum256(state);checkpoint:=hex.EncodeToString(sum[:]);if checkpoint!="5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6"{t.Fatal("canonical checkpoint",checkpoint)}
 b,_:=json.MarshalIndent(map[string]any{"scope":"complete native compiler decision; exact interpreter resumes at early, middle and final search frames; not a full WAVM block proof","passed":true,"fullCompilerDecision":true,"interpreterComparedAllImageBytes":true,"checkpoints":records,"canonicalCheckpointSHA256":checkpoint,"seconds":time.Since(start).Seconds()},"","  ");if e=os.WriteFile(".cache/backend-parity.json",append(b,'\n'),0600);e!=nil{t.Fatal(e)}
}
