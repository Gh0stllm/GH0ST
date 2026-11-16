"""Prepare only the isolated custom chess source; never modifies the clean core."""
from pathlib import Path
import json,os,shutil,subprocess,hashlib
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[2];source=HERE/'.cache/nitro-chess';core=REPO/'research/chess/l3/core/node';go=core/'.cache/go-1.25.12/go/bin/go'
if not source.exists():subprocess.run(['cp','-cR',str(core/'.cache/nitro-core'),str(source)],check=True)
for p in (HERE/'overlay').glob('*.go'):shutil.copy2(p,source/'precompiles'/p.name)
for p in (HERE/'system_overlay').glob('*.go'):shutil.copy2(p,source/'system_tests'/p.name)
p=source/'precompiles/precompile.go';s=p.read_text();anchor='insert(MakePrecompile(precompilesgen.ArbInfoMetaData, &ArbInfo{Address: types.ArbInfoAddress}))';assert anchor in s
if 'makeGhostChessPrecompile' not in s:s=s.replace(anchor,'insert(debugOnly(makeGhostChessPrecompile()))\n\t'+anchor)
p.write_text(s)
subprocess.run([str(go),'mod','edit','-require=github.com/Gh0stllm/GH0ST/gl3/chessruntime@v0.0.0','-replace=github.com/Gh0stllm/GH0ST/gl3/chessruntime='+str(HERE/'runtime')],cwd=source,env={**os.environ,'GOTOOLCHAIN':'local'},check=True)
subprocess.run([str(go.parent/'gofmt'),'-w',*[str(p) for p in (source/'precompiles').glob('ArbGhostChess*.go')]],check=True)
print('Custom A13 overlay prepared; only experimental debug-chain profile enables it')
