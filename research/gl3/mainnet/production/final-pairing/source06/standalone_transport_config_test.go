package main

import (
 "context"
 "strconv"
 "testing"
)
func TestGL3ProductionTransportStandaloneTypedValidation(t *testing.T){
 for _,n:=range []int64{0,-1,1,4096,3221225472,3221225473} {t.Run(strconv.FormatInt(n,10),func(t *testing.T){
  c,err:=ParseNode(context.Background(),[]string{"--persistent.chain",t.TempDir(),"--validation.rpc-request-max-bytes="+strconv.FormatInt(n,10),"--log-level=WARN"})
  want:=n>0&&n<=3221225472
  if (err==nil)!=want {t.Fatal(n,err)}
  if want {if err=c.Validate();err!=nil {t.Fatal(err)};if c.Validation.RPCRequestMaxBytes!=n {t.Fatal("typed cap drift")}}
 })}
}
