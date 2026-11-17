from pathlib import Path
import json,subprocess
base=Path('/root/gl3-final-pairing/source05');out=base.parent/'source06';out.mkdir(exist_ok=True)
paths=['validator/valnode/valnode.go','validator/valnode/rpc_request_limit.go','cmd/nitro-val/nitro_val.go','cmd/nitro/nitro.go','validator/client/validation_client.go','validator/client/validation_upload_admission.go','staker/experimental_execution_cache.go']
for f in paths:
 q=out/f;q.parent.mkdir(parents=True,exist_ok=True)
 q.write_text((base/f).read_text() if (base/f).exists() else (base.parent/Path(f).name).read_text())
def edit(f,fn):
 q=out/f;q.write_text(fn(q.read_text()))
def rep(s,a,b):
 assert s.count(a)==1,(a[:100],s.count(a));return s.replace(a,b)
def val(s):
 s=rep(s,'type Config struct {','type Config struct {\n\tRPCRequestMaxBytes int64 `koanf:"rpc-request-max-bytes"`')
 for key in ['var DefaultValidationConfig = Config {','var TestValidationConfig = Config {']:
  key=key.replace('Config {','Config{');s=rep(s,key,key+'\n\tRPCRequestMaxBytes: DefaultRPCRequestMaxBytes,')
 return rep(s,'func ValidationConfigAddOptions(prefix string, f *pflag.FlagSet) {','func ValidationConfigAddOptions(prefix string, f *pflag.FlagSet) {\n\tf.Int64(prefix+".rpc-request-max-bytes", DefaultValidationConfig.RPCRequestMaxBytes, "maximum validation HTTP/WS request bytes, positive and at most 3 GiB")')
edit(paths[0],val)
def valmain(s):
 s=rep(s,'\n\t"math"','');s=rep(s,'\tstackConf.HTTPBodyLimit = math.MaxInt\n\tstackConf.WSReadLimit = math.MaxInt64\n','')
 s=rep(s,'\tstack, err := node.New(&stackConf)','\tif err := nodeConfig.Validation.ApplyRPCRequestLimit(&stackConf); err != nil {\n\t\tlog.Error("invalid validation RPC request limit", "err", err)\n\t\treturn 1\n\t}\n\tstack, err := node.New(&stackConf)')
 return rep(s,'\treturn &nodeConfig, nil','\tif err := nodeConfig.Validation.ValidateRPCRequestLimit(); err != nil {\n\t\treturn nil, err\n\t}\n\treturn &nodeConfig, nil')
edit(paths[2],valmain)
def client(s):
 s=rep(s,'\twasmModuleRoots []common.Hash','\twasmModuleRoots []common.Hash\n\tuploadAdmission validationUploadAdmissionPolicy')
 s=rep(s,'func (c *ValidationClient) Launch(entry *validator.ValidationInput, moduleRoot common.Hash) validator.ValidationRun {','func (c *ValidationClient) Launch(entry *validator.ValidationInput, moduleRoot common.Hash) validator.ValidationRun {\n\tuseUploadAdmission := c.uploadAdmission.enabled.Load()')
 s=rep(s,'\t\tinput := server_api.ValidationInputToJson(entry)','\t\tif useUploadAdmission {\n\t\t\trelease, err := gl3AcquireValidationUpload(ctx)\n\t\t\tif err != nil { return validator.GoGlobalState{}, err }; defer release()\n\t\t}\n\t\tinput := server_api.ValidationInputToJson(entry)')
 s=rep(s,') containers.PromiseInterface[validator.ExecutionRun] {\n\treturn stopwaiter.LaunchPromiseThread',') containers.PromiseInterface[validator.ExecutionRun] {\n\tuseUploadAdmission := c.uploadAdmission.enabled.Load()\n\treturn stopwaiter.LaunchPromiseThread')
 return rep(s,'\t\tvar res uint64\n\t\terr := c.client.CallContext','\t\tif useUploadAdmission {\n\t\t\trelease, err := gl3AcquireValidationUpload(ctx)\n\t\t\tif err != nil { return nil, err }; defer release()\n\t\t}\n\t\tvar res uint64\n\t\terr := c.client.CallContext')
edit(paths[4],client)
def staker(s):
 s=rep(s,'\t"context"','\t"context"\n\t"encoding/hex"\n\t"strings"')
 marker='func experimentalCacheNil(value any) bool {'
 s=rep(s,marker,'''type experimentalValidationUploadEnabler interface { EnableValidationUploadAdmission() error }

// Enabled operator profiles require an explicit root, never the unrelated local latest alias.
func RequiredExperimentalCacheModuleRoot(c *BlockValidatorConfig) (common.Hash, error) {
 if c == nil { return common.Hash{}, fmt.Errorf("block validator configuration missing") }
 raw, err := hex.DecodeString(strings.TrimPrefix(c.CurrentModuleRoot, "0x"))
 if err != nil || len(raw) != common.HashLength { return common.Hash{}, fmt.Errorf("experimental execution cache requires an explicit 32-byte hexadecimal current-module-root") }
 root := common.BytesToHash(raw)
 if root == (common.Hash{}) { return common.Hash{}, fmt.Errorf("experimental execution cache requires a nonzero current-module-root") }
 return root, nil
}

'''+marker)
 s=rep(s,'\tif v.latestWasmModuleRoot == (common.Hash{}) {\n\t\treturn fmt.Errorf("resolve a nonzero module root before enabling experimental execution cache")\n\t}', '\tif _, err := RequiredExperimentalCacheModuleRoot(v.config); err != nil { return err }')
 s=rep(s,'\t\tlifecycle, ok := v.execSpawners[i].(experimentalExecutionClientLifecycle)','\t\tif _, ok := v.execSpawners[i].(experimentalValidationUploadEnabler); !ok { return fmt.Errorf("execution client %d cannot enable validation upload admission", i) }\n\t\tlifecycle, ok := v.execSpawners[i].(experimentalExecutionClientLifecycle)')
 s=rep(s,'\ttargets := make(map[rawdb.WasmTarget]struct{})','\trequiredRoot, err := RequiredExperimentalCacheModuleRoot(v.config)\n\tif err != nil { return err }\n\ttargets := make(map[rawdb.WasmTarget]struct{})')
 s=rep(s,'\t\tif err = spawner.Start(ctx); err != nil {\n\t\t\t// A real RPC','\t\tif err = spawner.(experimentalValidationUploadEnabler).EnableValidationUploadAdmission(); err != nil { return fmt.Errorf("enabling upload admission client %d: %w", i, err) }\n\t\tif err = spawner.Start(ctx); err != nil {\n\t\t\t// A real RPC')
 s=rep(s,'\t\tstartedExecutions = append(startedExecutions, spawner)','\t\tstartedExecutions = append(startedExecutions, spawner)\n\t\troots, rootErr := spawner.WasmModuleRoots()\n\t\tif rootErr != nil { return fmt.Errorf("reading execution client %d module roots: %w", i, rootErr) }\n\t\tsupported := false\n\t\tfor _, root := range roots { if root == requiredRoot { supported = true; break } }\n\t\tif !supported { return fmt.Errorf("execution client %d does not support required module root %s", i, requiredRoot) }')
 return s
edit(paths[6],staker)
def main(s):
 s=rep(s,'\tlegacystaker "github.com/offchainlabs/nitro/staker/legacy"','\t"github.com/offchainlabs/nitro/staker"\n\tlegacystaker "github.com/offchainlabs/nitro/staker/legacy"')
 s=rep(s,'\tstackConf := node.DefaultConfig','''\tcacheProfileEnabled := nodeConfig.Node.BlockValidator.ExperimentalBOLDExecutionCache.Enable
 var requiredCacheRoot common.Hash
 if cacheProfileEnabled {
  if nodeConfig.Node.Dangerous.NoL1Listener || !nodeConfig.Validation.Wasm.EnableWasmrootsCheck { log.Error("experimental cache profile requires parent and WASM compatibility checks"); return 1 }
  requiredCacheRoot, err = staker.RequiredExperimentalCacheModuleRoot(&nodeConfig.Node.BlockValidator)
  if err != nil { log.Error("invalid experimental cache module root", "err", err); return 1 }
 }
\tstackConf := node.DefaultConfig''')
 s=rep(s,'\tif nodeConfig.Node.Staker.OnlyCreateWalletContract {','''\tif cacheProfileEnabled {
  if err := checkWasmModuleRootCompatibility(ctx, nodeConfig.Validation.Wasm, l1Client, rollupAddrs, requiredCacheRoot); err != nil { log.Error("experimental cache parent module compatibility failed", "err", err); return 1 }
 }
\tif nodeConfig.Node.Staker.OnlyCreateWalletContract {''')
 s=rep(s,'if nodeConfig.Node.ParentChainReader.Enable && nodeConfig.Validation.Wasm.EnableWasmrootsCheck {','if !cacheProfileEnabled && nodeConfig.Node.ParentChainReader.Enable && nodeConfig.Validation.Wasm.EnableWasmrootsCheck {')
 # Before the stack is constructed: apply the validation cap only when embedding validation.
 s=rep(s,'\tstack, err := node.New(&stackConf)','\tif sameProcessValidationNodeEnabled {\n\t\tif err := nodeConfig.Validation.ApplyRPCRequestLimit(&stackConf); err != nil { log.Error("invalid validation RPC request limit", "err", err); return 1 }\n\t}\n\tstack, err := node.New(&stackConf)')
 s=rep(s,'rollupAddrs chaininfo.RollupAddresses) error {','rollupAddrs chaininfo.RollupAddresses, expectedRoots ...common.Hash) error {')
 s=rep(s,'\t// Check if the on-chain WASM module root belongs to the set of allowed module roots','\tif len(expectedRoots) > 1 { return errors.New("exactly one expected module root is supported") }\n\tif len(expectedRoots) == 1 && (expectedRoots[0] == (common.Hash{}) || moduleRoot != expectedRoots[0]) { return fmt.Errorf("on-chain WASM module root %s differs from required cache root %s", moduleRoot, expectedRoots[0]) }\n\t// Check if the on-chain WASM module root belongs to the set of allowed module roots')
 return s
edit(paths[3],main)
gofmt='/root/bounded-restore/toolchain/go/bin/gofmt'
if not Path(gofmt).exists():
 hits=list(Path('/root').glob('go*/bin/gofmt'))+list(Path('/usr/local').glob('go*/bin/gofmt'));assert hits;gofmt=str(hits[0])
subprocess.run([gofmt,'-w']+[str(out/f) for f in paths],check=True)
(out/'overlay.json').write_text(json.dumps({'Replace':{str(base/f):str(out/f) for f in paths}},indent=2)+'\n')
print('STAGED',len(paths),gofmt)
