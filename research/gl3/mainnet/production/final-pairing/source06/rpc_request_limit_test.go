package valnode

import (
 "bytes"
 "encoding/hex"
 "io"
 "net/http"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"

 "github.com/ethereum/go-ethereum/node"
 "github.com/ethereum/go-ethereum/p2p"
 "github.com/ethereum/go-ethereum/rpc"
 "github.com/golang-jwt/jwt/v4"
 "github.com/gorilla/websocket"
 "github.com/spf13/pflag"
)

func TestGL3RequestLimitValidationAndFlags(t *testing.T) {
 if DefaultValidationConfig.RPCRequestMaxBytes != 3221225472 || TestValidationConfig.RPCRequestMaxBytes != 3221225472 {t.Fatal("default drift")}
 for _, n := range []int64{-1,0,1,4096,3221225472,3221225473} {
  t.Run(strings.ReplaceAll(time.Duration(n).String(),"/","_"),func(t *testing.T){ c:=DefaultValidationConfig;c.RPCRequestMaxBytes=n
   err:=c.ValidateRPCRequestLimit(); want:=n>0&&n<=DefaultRPCRequestMaxBytes
   if (err==nil)!=want {t.Fatal(n,err)}
   stack:=node.DefaultConfig; if got:=c.ApplyRPCRequestLimit(&stack);(got==nil)!=want {t.Fatal(n,got)}
   if want&&(stack.HTTPBodyLimit!=int(n)||stack.WSReadLimit!=n) {t.Fatal("effective cap mismatch")}
  })
 }
 var nilConfig *Config;if nilConfig.ValidateRPCRequestLimit()==nil {t.Fatal("nil config accepted")}
 if DefaultValidationConfig.ApplyRPCRequestLimit(nil)==nil {t.Fatal("nil stack accepted")}
 f:=pflag.NewFlagSet("validation",pflag.ContinueOnError);ValidationConfigAddOptions("validation",f)
 if err:=f.Parse([]string{"--validation.rpc-request-max-bytes=4096"});err!=nil {t.Fatal(err)}
 n,err:=f.GetInt64("validation.rpc-request-max-bytes");if err!=nil||n!=4096 {t.Fatal(n,err)}
}

type gl3CapAPI struct{}
func(*gl3CapAPI) Echo(s string) string{return s}

func TestGL3RequestLimitActualAuthenticatedHTTPAndFragmentedWS(t *testing.T) {
 const limit=1024
 secret:=bytes.Repeat([]byte{0x31},32) // ephemeral test-only authentication secret
 secretPath:=filepath.Join(t.TempDir(),"jwt");if err:=os.WriteFile(secretPath,[]byte(hex.EncodeToString(secret)),0600);err!=nil {t.Fatal(err)}
 stackConf:=node.Config{Name:"gl3-cap-test",DataDir:"",P2P:p2p.Config{NoDial:true,NoDiscovery:true,ListenAddr:""},AuthAddr:"127.0.0.1",AuthPort:0,AuthVirtualHosts:[]string{"localhost","127.0.0.1"},JWTSecret:secretPath,AuthModules:[]string{"validation"}}
 c:=DefaultValidationConfig;c.RPCRequestMaxBytes=limit
 if err:=c.ApplyRPCRequestLimit(&stackConf);err!=nil {t.Fatal(err)}
 stack,err:=node.New(&stackConf);if err!=nil {t.Fatal(err)}
 stack.RegisterAPIs([]rpc.API{{Namespace:"validation",Service:&gl3CapAPI{},Authenticated:true}})
 if err=stack.Start();err!=nil {t.Fatal(err)};defer stack.Close()
 token,err:=jwt.NewWithClaims(jwt.SigningMethodHS256,jwt.MapClaims{"iat":time.Now().Unix()}).SignedString(secret);if err!=nil {t.Fatal(err)}
 request:=func(body string) (int,string) {t.Helper();req,err:=http.NewRequest("POST",stack.HTTPAuthEndpoint(),strings.NewReader(body));if err!=nil {t.Fatal(err)};req.Header.Set("Authorization","Bearer "+token);req.Header.Set("Content-Type","application/json");resp,err:=http.DefaultClient.Do(req);if err!=nil {t.Fatal(err)};defer resp.Body.Close();b,_:=io.ReadAll(resp.Body);return resp.StatusCode,string(b)}
 code,body:=request(`{"jsonrpc":"2.0","id":1,"method":"validation_echo","params":["ok"]}`)
 if code!=200||!strings.Contains(body,`"result":"ok"`) {t.Fatal(code,body)}
 code,_=request(`{"jsonrpc":"2.0","id":2,"method":"validation_echo","params":["`+strings.Repeat("x",2048)+`"]}`)
 if code!=http.StatusRequestEntityTooLarge {t.Fatal("authenticated HTTP cap not enforced",code)}
 header:=http.Header{"Authorization":[]string{"Bearer "+token}}
 dialer:=websocket.Dialer{WriteBufferSize:128}
 conn,resp,err:=dialer.Dial(stack.WSAuthEndpoint(),header);if err!=nil {t.Fatal(err,resp)};defer conn.Close()
 if err=conn.WriteMessage(websocket.TextMessage,[]byte(`{"jsonrpc":"2.0","id":1,"method":"validation_echo","params":["ok"]}`));err!=nil {t.Fatal(err)}
 if _,b,err:=conn.ReadMessage();err!=nil||!bytes.Contains(b,[]byte(`"result":"ok"`)) {t.Fatal(string(b),err)}
 writer,err:=conn.NextWriter(websocket.TextMessage);if err!=nil {t.Fatal(err)}
 payload:=[]byte(`{"jsonrpc":"2.0","id":2,"method":"validation_echo","params":["`+strings.Repeat("x",2048)+`"]}`)
 // Flush chunks below the configured cap; the complete fragmented message exceeds it.
 for len(payload)>0 {n:=127;if len(payload)<n {n=len(payload)};if _,err=writer.Write(payload[:n]);err!=nil {break};payload=payload[n:]}
 _=writer.Close();_ = conn.SetReadDeadline(time.Now().Add(3*time.Second))
 if _,_,err=conn.ReadMessage();err==nil {t.Fatal("oversize fragmented authenticated WS accepted")}
 if !websocket.IsCloseError(err,websocket.CloseMessageTooBig) {t.Fatal("unexpected WS error",err)}
 t.Log("effective auth HTTP=1024/WS=1024; valid requests pass; HTTP413 and fragmented WS1009 observed")
}
