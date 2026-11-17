package client

import (
 "context"
 "encoding/base64"
 "errors"
 "net/http/httptest"
 "sync/atomic"
 "testing"
 "time"

 "github.com/ethereum/go-ethereum/common"
 "github.com/ethereum/go-ethereum/core/rawdb"
 "github.com/ethereum/go-ethereum/rpc"
 "github.com/offchainlabs/nitro/util/rpcclient"
 "github.com/offchainlabs/nitro/validator"
 "github.com/offchainlabs/nitro/validator/server_api"
)

type gl3UploadAPI struct {
 entered chan struct{}
 release chan struct{}
 validated chan string
 createErr bool
 creates atomic.Int64
}
func(*gl3UploadAPI)Name()string{return "upload-test"}
func(*gl3UploadAPI)StylusArchs()[]rawdb.WasmTarget{return []rawdb.WasmTarget{"mock"}}
func(*gl3UploadAPI)WasmModuleRoots()[]common.Hash{return []common.Hash{{9}}}
func(*gl3UploadAPI)Capacity()int{return 2}
func(a *gl3UploadAPI)CreateExecutionRun(ctx context.Context, root common.Hash,input *server_api.InputJSON,bold bool)(uint64,error){
 a.creates.Add(1)
 if a.entered!=nil {a.entered<-struct{}{}}
 if a.release!=nil {select{case<-a.release:case<-ctx.Done():return 0,ctx.Err()}}
 if a.createErr{return 0,errors.New("injected RPC failure")};return 7,nil
}
func(a *gl3UploadAPI)Validate(input *server_api.InputJSON,root common.Hash)(validator.GoGlobalState,error){
 a.validated<-input.DelayedMsgB64;return validator.GoGlobalState{Batch:4},nil
}
func(*gl3UploadAPI)ExecKeepAlive(uint64)error{return nil}
func(*gl3UploadAPI)CloseExec(uint64)error{return nil}
func gl3UploadWait(t *testing.T,fn func()bool){t.Helper();deadline:=time.Now().Add(3*time.Second);for !fn(){if time.Now().After(deadline){t.Fatal("condition deadline")};time.Sleep(time.Millisecond)}}
func gl3UploadClient(t *testing.T,a *gl3UploadAPI,enabled bool)*ExecutionClient{
 t.Helper();server:=rpc.NewServer();if err:=server.RegisterName("validation",a);err!=nil {t.Fatal(err)}
 h:=httptest.NewServer(server);t.Cleanup(h.Close);t.Cleanup(server.Stop)
 conf:=rpcclient.DefaultClientConfig;conf.URL=h.URL;conf.Timeout=3*time.Second;conf.Retries=0
 c:=NewExecutionClient(func()*rpcclient.ClientConfig{return &conf},nil)
 if enabled {if err:=c.EnableValidationUploadAdmission();err!=nil {t.Fatal(err)}}
 if err:=c.Start(context.Background());err!=nil {t.Fatal(err)};t.Cleanup(func(){c.Stop();c.StopAndWait()});return c
}
func TestGL3UploadGateCancelAndExactlyOnceRelease(t *testing.T){
 release,err:=gl3AcquireValidationUpload(context.Background());if err!=nil {t.Fatal(err)}
 ctx,cancel:=context.WithCancel(context.Background());cancel()
 if r,e:=gl3AcquireValidationUpload(ctx);e==nil||r!=nil {t.Fatal("canceled acquisition accepted")}
 if a,_:=GL3ValidationUploadAdmissionStats();a!=1 {t.Fatal(a)}
 release();release();if a,_:=GL3ValidationUploadAdmissionStats();a!=0 {t.Fatal("double release",a)}
}
func TestGL3UploadGateSharedBeforeConversionThroughResponse(t *testing.T){
 api:=&gl3UploadAPI{entered:make(chan struct{},1),release:make(chan struct{}),validated:make(chan string,1)}
 first:=gl3UploadClient(t,api,true);second:=gl3UploadClient(t,api,true)
 p:=first.CreateExecutionRun(common.Hash{9},&validator.ValidationInput{},true);<-api.entered
 entry:=&validator.ValidationInput{DelayedMsg:[]byte("before")};v:=second.Launch(entry,common.Hash{9})
 gl3UploadWait(t,func()bool{return ValidationUploadAdmissionWaiting()==1})
 select{case<-api.validated:t.Fatal("validation reached RPC while execution response blocked");default:}
 // The held shared lease guarantees the waiting callback has not read this input.
 entry.DelayedMsg=[]byte("after")
 // Test-only atomic policy mutation: a call uses its captured policy through release.
 second.uploadAdmission.enabled.Store(false)
 close(api.release);run,err:=p.Await(context.Background());if err!=nil {t.Fatal(err)};defer run.Close()
 if _,err=v.Await(context.Background());err!=nil {t.Fatal(err)}
 if got:=<-api.validated;got!=base64.StdEncoding.EncodeToString([]byte("after")){t.Fatal("converted before admission",got)}
 gl3UploadWait(t,func()bool{a,_:=GL3ValidationUploadAdmissionStats();return a==0})
 if _,peak:=GL3ValidationUploadAdmissionStats();peak!=1 {t.Fatal("more than one admitted upload",peak)}
}
func TestGL3UploadWaitingCancellationDoesNotReleaseOwner(t *testing.T){
 api:=&gl3UploadAPI{validated:make(chan string,1)};c:=gl3UploadClient(t,api,true)
 release,err:=gl3AcquireValidationUpload(context.Background());if err!=nil {t.Fatal(err)};defer release()
 p:=c.Launch(&validator.ValidationInput{},common.Hash{9});gl3UploadWait(t,func()bool{return ValidationUploadAdmissionWaiting()==1});p.Cancel()
 if _,err=p.Await(context.Background());!errors.Is(err,context.Canceled){t.Fatal(err)}
 if a,_:=GL3ValidationUploadAdmissionStats();a!=1 {t.Fatal("waiter released owner",a)}
 select{case<-api.validated:t.Fatal("canceled waiter sent RPC");default:}
}
func TestGL3UploadRPCFailureReleasesLease(t *testing.T){
 api:=&gl3UploadAPI{createErr:true,validated:make(chan string,1)};c:=gl3UploadClient(t,api,true)
 if _,err:=c.CreateExecutionRun(common.Hash{9},&validator.ValidationInput{},true).Await(context.Background());err==nil {t.Fatal("injected failure absent")}
 if _,err:=c.Launch(&validator.ValidationInput{},common.Hash{9}).Await(context.Background());err!=nil {t.Fatal(err)}
 if a,_:=GL3ValidationUploadAdmissionStats();a!=0 {t.Fatal("RPC failure leaked lease",a)}
}
func TestGL3UploadDefaultOptOutAndColdLifecycle(t *testing.T){
 api:=&gl3UploadAPI{validated:make(chan string,1)};c:=gl3UploadClient(t,api,false)
 if err:=c.EnableValidationUploadAdmission();err==nil {t.Fatal("started client changed")}
 release,err:=gl3AcquireValidationUpload(context.Background());if err!=nil {t.Fatal(err)};defer release()
 if _,err:=c.Launch(&validator.ValidationInput{},common.Hash{9}).Await(context.Background());err!=nil {t.Fatal(err)}
 if a,_:=GL3ValidationUploadAdmissionStats();a!=1 {t.Fatal("opt-out touched owned lease",a)}
 c.Stop();if err:=c.EnableValidationUploadAdmission();err==nil {t.Fatal("stopped client accepted")}
 var absent *ValidationClient;if err:=absent.EnableValidationUploadAdmission();err==nil {t.Fatal("nil accepted")}
}
