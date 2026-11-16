"""Verify upstream pin and overlay API anchors; does NOT typecheck full Nitro."""
import hashlib,json,difflib,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
src=root/'.cache/nitro-3.12.2'
assert hashlib.sha256((root/'.cache/nitro-v3.12.2.tar.gz').read_bytes()).hexdigest()=='8dabf6d465b25b261333fc6225a1bcda06b59f8a8227ce7ecd8f0bbb6629af4c'
paths=['precompiles/precompile.go','precompiles/context.go','arbos/storage/storage.go','arbos/arbosState/arbosstate.go']
blobs={p:hashlib.sha256((src/p).read_bytes()).hexdigest() for p in paths}
s=(src/paths[0]).read_text()
needle='\tinsert(MakePrecompile(precompilesgen.ArbInfoMetaData, &ArbInfo{Address: types.ArbInfoAddress}))'
assert s.count(needle)==1
changed=s.replace(needle,'\t// GH0ST local-development kernel only; never enable this debug chain for assets.\n\tinsert(debugOnly(makeGhostTensorPrecompile()))\n'+needle)
patch=''.join(difflib.unified_diff(s.splitlines(True),changed.splitlines(True),fromfile='a/precompiles/precompile.go',tofile='b/precompiles/precompile.go'))
(root/'register-debug-only.patch').write_text(patch)
p=subprocess.run(['git','apply','--check',str(root/'register-debug-only.patch')],cwd=src,capture_output=True,text=True)
assert p.returncode==0,p.stderr
assert 'func (c *Context) Burn(' in (src/paths[1]).read_text()
assert 'func (state *ArbosState) BackingStorage() *storage.Storage' in (src/paths[3]).read_text()
assert 'func (s *Storage) Get(key common.Hash) (common.Hash, error)' in (src/paths[2]).read_text()
assert 'func (s *Storage) Set(key common.Hash, value common.Hash) error' in (src/paths[2]).read_text()
report={'upstreamTag':'v3.12.2','sourceArchiveSHA256':hashlib.sha256((root/'.cache/nitro-v3.12.2.tar.gz').read_bytes()).hexdigest(),'sourceFilesSHA256':blobs,'registrationPatchAppliesToPinnedSource':True,'actualAPIDeclarationsFound':True,'sourceCheckPerformsTypecheck':False,'fullNitroBuilt':False,'proverBuilt':False,'debugOnly':True,'financialActions':False}
(root/'evidence/source-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
