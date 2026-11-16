// Offline evidence decoder using unchanged Nitro Brotli, segment and L2 parsers.
package main
import (
 "bytes"
 "encoding/hex"
 "encoding/json"
 "fmt"
 "io"
 "math/big"
 "os"
 "strings"
 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/types"
 "github.com/ethereum/go-ethereum/rlp"
 "github.com/offchainlabs/nitro/arbcompress"
 "github.com/offchainlabs/nitro/arbos"
 "github.com/offchainlabs/nitro/arbos/arbostypes"
)
type batch struct { ParentTransactionHash string `json:"parentTransactionHash"`; SequenceNumber string `json:"sequenceNumber"`; ParentReceiptStatus int `json:"parentReceiptStatus"`; Data string `json:"data"` }
func main(){raw,e:=os.ReadFile(os.Args[1]);if e!=nil{panic(e)};var input struct{ExpectedChildTransactionHash string `json:"expectedChildTransactionHash"`;ExpectedChildSender string `json:"expectedChildSender"`;ChildChainID uint64 `json:"childChainId"`; Batches []batch `json:"batches"`};if e=json.Unmarshal(raw,&input);e!=nil{panic(e)}
 matched:=false;records:=[]map[string]any{}
 for _,b:=range input.Batches { data,e:=hex.DecodeString(strings.TrimPrefix(b.Data,"0x"));if e!=nil{panic(e)};if len(data)<1||data[0]!=0{panic("expected actualBrotli batch")};decompressed,e:=arbcompress.Decompress(data[1:],16*1024*1024);if e!=nil{panic(e)};stream:=rlp.NewStream(bytes.NewReader(decompressed),0);count:=0
 for {var segment []byte;e:=stream.Decode(&segment);if e==io.EOF{break};if e!=nil{panic(e)};count++;if len(segment)<1{continue};kind:=segment[0];if kind!=0&&kind!=1{continue};payload:=segment[1:];if kind==1{payload,e=arbcompress.Decompress(payload,arbostypes.MaxL2MessageSize);if e!=nil{panic(e)}}
 msg:=&arbostypes.L1IncomingMessage{Header:&arbostypes.L1IncomingMessageHeader{Kind:arbostypes.L1MessageType_L2Message},L2msg:payload};txs,e:=arbos.ParseL2Transactions(msg,new(big.Int).SetUint64(input.ChildChainID),61);if e!=nil{panic(e)}
 for _,tx:=range txs {sender,e:=types.Sender(types.LatestSignerForChainID(new(big.Int).SetUint64(input.ChildChainID)),tx);if e!=nil{panic(e)};hash:=tx.Hash().Hex();isMatch:=strings.EqualFold(hash,input.ExpectedChildTransactionHash);if isMatch {if b.ParentReceiptStatus!=1||sender!=common.HexToAddress(input.ExpectedChildSender){panic("parentreceipt/sender mismatch")};matched=true};records=append(records,map[string]any{"parentTransactionHash":b.ParentTransactionHash,"parentReceiptStatus":b.ParentReceiptStatus,"batchSequenceNumber":b.SequenceNumber,"decodedChildTransactionHash":hash,"decodedSender":sender.Hex(),"decodedChainId":tx.ChainId().String(),"decodedValue":tx.Value().String(),"matchesMinedChildReceipt":isMatch})}
 };_ = count
 }
 if !matched{panic("actual mined child transaction was not found in postedparentbatch")};out:=map[string]any{"scope":"Actual posted parent batch decompressed and parsed with exact standard Nitro; signed childtransactionhash and sender recovered","matchedMinedChildTransaction":matched,"records":records,"publicChain":false,"finalityClaim":false,"fraudProofClaim":false};j,_:=json.MarshalIndent(out,"","  ");fmt.Println(string(j))
}
