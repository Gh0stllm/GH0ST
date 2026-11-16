// Prepare deployment bytes with the exact pinned Nitro Brotli/prefix helpers.
// This is an offline build helper, never part of the state transition.
package main
import (
 "crypto/sha256"
 "encoding/hex"
 "fmt"
 "os"
 "github.com/ethereum/go-ethereum/core/state"
 "github.com/offchainlabs/nitro/arbcompress"
)
func main(){
 if len(os.Args)!=2 {panic("normalized Wasm path required")}
 wasm,err:=os.ReadFile(os.Args[1]);if err!=nil{panic(err)}
 digest:=sha256.Sum256(wasm)
 if hex.EncodeToString(digest[:])!="e15336947f6bc96a6e29c5eab5d0ad84ffb8d76422f03866115766d1173b5527" {panic("unreviewed Wasm")}
 compressed,err:=arbcompress.Compress(wasm,arbcompress.LEVEL_WELL,arbcompress.EmptyDictionary);if err!=nil{panic(err)}
 runtime:=append(state.NewStylusPrefix(byte(arbcompress.EmptyDictionary)),compressed...)
 if len(runtime)>65535 {panic("helper init code length bound")}
 init:=fmt.Sprintf("61%04x61000f60003961%04x6000f3",len(runtime),len(runtime))
 fmt.Println("0x"+init+hex.EncodeToString(runtime))
}
