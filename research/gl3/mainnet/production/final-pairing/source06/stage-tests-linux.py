from pathlib import Path
import json,subprocess
base=Path('/root/gl3-final-pairing/source05');out=base.parent/'source06';tests=out/'tests';tests.mkdir(exist_ok=True)
s=(base/'staker/experimental_execution_cache_test.go').read_text()
s=s.replace('startErr    error','startErr    error\n\tuploadErr error\n\trootErr error\n\troots []common.Hash\n\tuploads int')
s=s.replace('func (s *gl3OperatorExec) Started() bool', 'func (s *gl3OperatorExec) EnableValidationUploadAdmission() error { s.uploads++;return s.uploadErr }\nfunc (s *gl3OperatorExec) WasmModuleRoots() ([]common.Hash,error) { if s.roots!=nil {return s.roots,s.rootErr};return []common.Hash{{9}},s.rootErr }\nfunc (s *gl3OperatorExec) Started() bool')
s=s.replace('config := DefaultBlockValidatorConfig','config := DefaultBlockValidatorConfig\n\tconfig.CurrentModuleRoot = (common.Hash{9}).Hex()')
s=s.replace('v.latestWasmModuleRoot = common.Hash{}\n\t\t\tcase "max entries"','v.config.CurrentModuleRoot = (common.Hash{}).Hex()\n\t\t\tcase "max entries"')
s+='''
func TestGL3OperatorExactModuleSupport(t *testing.T) {
 for _, name := range []string{"empty","missing","error","valid non-latest"} {t.Run(name,func(t *testing.T){
 v,events,execs,_:=gl3OperatorValidator()
 switch name {case "empty":execs[1].roots=[]common.Hash{};case "missing":execs[1].roots=[]common.Hash{{8}};case "error":execs[1].rootErr=errors.New("module transport failure");case "valid non-latest":v.latestWasmModuleRoot=common.Hash{7}}
 err:=v.Start(context.Background())
 if name=="valid non-latest" {if err!=nil {t.Fatal(err)};if execs[0].uploads!=1||execs[1].uploads!=1 {t.Fatal("not all clients opted in")};v.Stop();return}
 if err==nil {t.Fatal("unsupported client accepted")}
 if !reflect.DeepEqual(*events,[]string{"exec0.start","exec1.start","exec1.stop","exec0.stop"}) {t.Fatal(*events)}
 })}
}
func TestGL3OperatorExplicitRootRequired(t *testing.T) {
 for _, root:=range []string{"latest","current","0x01","0x"+string(make([]byte,64)),(common.Hash{}).Hex()} {t.Run(root,func(t *testing.T){v,events,_,_:=gl3OperatorValidator();v.config.CurrentModuleRoot=root;if err:=v.Start(context.Background());err==nil {t.Fatal("invalid root accepted")};if len(*events)!=0 {t.Fatal(*events)}})}
}
func TestGL3OperatorColdOptionFailurePreservesOwner(t *testing.T) {
 v,events,execs,_:=gl3OperatorValidator();execs[1].uploadErr=errors.New("already owned")
 if err:=v.Start(context.Background());err==nil {t.Fatal("failed option accepted")}
 if !reflect.DeepEqual(*events,[]string{"exec0.start","exec0.stop"})||execs[1].Stopped() {t.Fatal("stopped unowned failing option client",*events)}
}
'''
(tests/'experimental_execution_cache_test.go').write_text(s)
for f in ['rpc_request_limit_test.go','validation_upload_admission_test.go']:
 src=base.parent/f
 if src.exists():(tests/f).write_text(src.read_text())
overlay=json.loads((out/'overlay.json').read_text())
for pkg,name in [('staker','experimental_execution_cache_test.go'),('validator/valnode','rpc_request_limit_test.go'),('validator/client','validation_upload_admission_test.go')]:
 if (tests/name).exists():overlay['Replace'][str(base/pkg/name)]=str(tests/name)
subprocess.run(['/root/bounded-restore/toolchain/go/bin/gofmt','-w']+[str(p) for p in tests.glob('*.go')],check=True)
(out/'test-overlay.json').write_text(json.dumps(overlay,indent=2)+'\n');print('TESTS_STAGED',len(overlay['Replace']))
