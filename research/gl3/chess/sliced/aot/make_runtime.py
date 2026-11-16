"""Install a tagged, explicit proof-only overlay into one disposable variant."""
from pathlib import Path
import sys
HERE=Path(__file__).resolve().parent
target=Path(sys.argv[1]).resolve()
assert '/.cache/aot-runtime-' in str(target)
target.mkdir(parents=True,exist_ok=True)
for name in ['go.mod','identity.go']:(target/name).write_bytes((HERE.parent/'runtime'/name).read_bytes())
source=HERE.parent/'runtime/runtime.go'
s=source.read_text();common=s[s.index('// A domain-separated Merkle root'):]
(target/'runtime.go').write_text('//go:build !wasm || !gl3aotproof\n\n'+s)
(target/'proof_runtime.go').write_text((HERE/'proof_runtime.go.txt').read_text()+'\n'+common)
