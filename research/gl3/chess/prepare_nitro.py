"""Prepare only the isolated custom chess source; never modifies the clean core."""
from pathlib import Path
import json,os,shutil,subprocess,hashlib,platform
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[2];source=HERE/'.cache/nitro-chess';core=REPO/'research/chess/l3/core/node';go=core/'.cache/go-1.25.12/go/bin/go'
if not source.exists():
 if platform.system()=='Darwin':subprocess.run(['cp','-cR',str(core/'.cache/nitro-core'),str(source)],check=True)
 else:shutil.copytree(core/'.cache/nitro-core',source,symlinks=True)
for p in (HERE/'overlay').glob('*.go'):shutil.copy2(p,source/'precompiles'/p.name)
for p in (HERE/'system_overlay').glob('*.go'):shutil.copy2(p,source/'system_tests'/p.name)
# The pinned local Geth predates an optional deep-reorg test flag. No reorg is used here.
p=source/'system_tests/external_l1.go';s=p.read_text();s=s.replace('"--engine.maxreorgdepth", "0",','// GL3 forward-only fixture retains the pinned Geth default reorg limit.');p.write_text(s)
p=source/'precompiles/precompile.go';s=p.read_text();anchor='insert(MakePrecompile(precompilesgen.ArbInfoMetaData, &ArbInfo{Address: types.ArbInfoAddress}))';assert anchor in s
if 'makeGhostChessPrecompile' not in s:s=s.replace(anchor,'insert(debugOnly(makeGhostChessPrecompile()))\n\t'+anchor)
p.write_text(s)
subprocess.run([str(go),'mod','edit','-require=github.com/Gh0stllm/GH0ST/gl3/chessruntime@v0.0.0','-replace=github.com/Gh0stllm/GH0ST/gl3/chessruntime='+str(HERE/'runtime')],cwd=source,env={**os.environ,'GOTOOLCHAIN':'local'},check=True)
subprocess.run([str(go.parent/'gofmt'),'-w',*[str(p) for p in (source/'precompiles').glob('ArbGhostChess*.go')]],check=True)
print('Custom A13 overlay prepared; only experimental debug-chain profile enables it')

# Native-only reporting exposes the replay's real computed global state.
# It is not compiled into the Wasm STF and cannot supply or alter any result.
p=source/'wavmio/native.go';s=p.read_text()
if 'GL3_REPLAY_END' not in s:
 s=s.replace('lastBlockHash      common.Hash','lastBlockHash      common.Hash\n\tlastSendRoot       common.Hash')
 s=s.replace('func OnFinal() {','func OnFinal() {\n\tfmt.Printf("GL3_REPLAY_END %s %s %d %d\\n", lastBlockHash.Hex(), lastSendRoot.Hex(), seqMsgPos+seqAdvanced, posWithinMsg)')
 s=s.replace('func SetSendRoot(hash [32]byte) {\n}', 'func SetSendRoot(hash [32]byte) {\n\tlastSendRoot = hash\n}')
 p.write_text(s)
