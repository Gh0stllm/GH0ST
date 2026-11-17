package main

import (
 "context"
 "errors"
 "net/http/httptest"
 "strings"
 "testing"

 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/common/hexutil"
 "github.com/ethereum/go-ethereum/ethclient"
 "github.com/ethereum/go-ethereum/rpc"
 "github.com/offchainlabs/nitro/cmd/chaininfo"
 "github.com/offchainlabs/nitro/cmd/nitro/config"
 "github.com/offchainlabs/nitro/validator/valnode"
)

type gl3ParentRootAPI struct {root common.Hash; fail bool}
func(a *gl3ParentRootAPI)Call(context.Context,map[string]interface{},string)(hexutil.Bytes,error){if a.fail{return nil,errors.New("parent read failed")};return a.root.Bytes(),nil}
func TestGL3ProductionTransportParentExactRootBinding(t *testing.T){
 for _, name:=range []string{"exact","different","zero","parent failure","legacy no expected"} {t.Run(name,func(t *testing.T){
 root:=common.Hash{9};api:=&gl3ParentRootAPI{root:root}
 if name=="different" {api.root=common.Hash{8}};if name=="zero" {api.root=common.Hash{}};if name=="parent failure" {api.fail=true}
 s:=rpc.NewServer();if err:=s.RegisterName("eth",api);err!=nil {t.Fatal(err)};h:=httptest.NewServer(s);defer h.Close();defer s.Stop()
 c,err:=ethclient.DialContext(context.Background(),h.URL);if err!=nil {t.Fatal(err)};defer c.Close()
 wasm:=valnode.DefaultWasmConfig;wasm.AllowedWasmModuleRoots=[]string{api.root.Hex()}
 if name=="legacy no expected" {err=checkWasmModuleRootCompatibility(context.Background(),wasm,c,chaininfo.RollupAddresses{Rollup:common.Address{1}})} else {err=checkWasmModuleRootCompatibility(context.Background(),wasm,c,chaininfo.RollupAddresses{Rollup:common.Address{1}},root)}
 want:=name=="exact"||name=="legacy no expected"
 if (err==nil)!=want {t.Fatal(name,err)}
 if name=="different"&&!strings.Contains(err.Error(),"differs from required cache root") {t.Fatal(err)}
 if name=="parent failure"&&!strings.Contains(err.Error(),"parent read failed") {t.Fatal(err)}
 })}
}
func TestGL3ProductionTransportOrdinaryTypedConfigurationValidate(t *testing.T){
 args:=[]string{"--persistent.chain",t.TempDir(),"--init.dev-init","--node.parent-chain-reader.enable=false","--parent-chain.id=5","--chain.id=421613","--node.sequencer","--execution.sequencer.enable","--node.feed.output.enable","--node.feed.output.port=9642","--node.transaction-streamer.track-block-metadata-from=10","--validation.rpc-request-max-bytes=4096","--validation.use-jit=false","--log-level=WARN"}
 c,_,err:=config.ParseNode(context.Background(),args);if err!=nil {t.Fatal(err)}
 if err=c.Validate();err!=nil {t.Fatal(err)}
 if c.Validation.RPCRequestMaxBytes!=4096||c.Validation.UseJit||c.LogLevel!="WARN" {t.Fatal("typed profile drift")}
 if err=c.Validation.ValidateRPCRequestLimit();err!=nil {t.Fatal(err)}
 t.Log("ordinary typed ParseNode + NodeConfig.Validate + dedicated cap validation passed; no dump or node/service start")
}
