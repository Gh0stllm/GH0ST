"""Prepare only the isolated custom chess source; never modifies the clean core."""
from pathlib import Path
import argparse,json,os,shutil,subprocess,hashlib,platform,re,sys,tempfile
parser=argparse.ArgumentParser();parser.add_argument('--sliced',action='store_true');parser.add_argument('--variant',default='');parser.add_argument('--game-coordinator',action='store_true')
parser.add_argument('--candidate-arbos-version', type=int, choices=[62],
                    help='Stage the GL3-only upgrade candidate against the pinned ArbOS 61 baseline')
options=parser.parse_args()
assert not options.variant or (options.sliced and re.fullmatch('[a-z0-9-]+',options.variant))
if options.game_coordinator and not options.sliced:
 parser.error('--game-coordinator requires the A14 sliced engine')
if options.candidate_arbos_version and not options.game_coordinator:
 parser.error('--candidate-arbos-version requires --game-coordinator')
suffix='-'+options.variant if options.variant else ''
HERE=Path(__file__).resolve().parent;REPO=HERE.parents[2]
profile='nitro-game-a14'+suffix if options.game_coordinator else 'nitro-sliced'+suffix if options.sliced else 'nitro-chess'
if options.candidate_arbos_version:
 profile=f'nitro-game-a14-upgrade-{options.candidate_arbos_version}'+suffix
source=HERE/'.cache'/profile;core=REPO/'research/chess/l3/core/node';go=core/'.cache/go-1.25.12/go/bin/go'
if not source.exists():
 if platform.system()=='Darwin':subprocess.run(['cp','-cR',str(core/'.cache/nitro-core'),str(source)],check=True)
 else:shutil.copytree(core/'.cache/nitro-core',source,symlinks=True)
if options.candidate_arbos_version:
 if (source/'precompiles/ArbGhostChess.go').exists():
  raise RuntimeError('Upgrade candidate requires an isolated copy without the legacy A13 engine')
else:
 for p in (HERE/'overlay').glob('*.go'):shutil.copy2(p,source/'precompiles'/p.name)
if options.game_coordinator:
 with tempfile.TemporaryDirectory() as temporary:
  staged=Path(temporary)/'overlay'
  subprocess.run([sys.executable,str(HERE/'game/engine/stage_overlay.py'),str(HERE/'overlay/ArbGhostChessSlices.go'),str(staged),
                  *(['--seed-migration'] if options.candidate_arbos_version else [])],check=True)
  for p in staged.glob('*.go'):shutil.copy2(p,source/'precompiles'/p.name)
for p in (HERE/'arbos_overlay').glob('*.go'):shutil.copy2(p,source/'arbos'/p.name)
if not options.candidate_arbos_version:
 for p in (HERE/'system_overlay').glob('*.go'):shutil.copy2(p,source/'system_tests'/p.name)
 # The pinned local Geth predates an optional deep-reorg test flag. No reorg is used here.
 p=source/'system_tests/external_l1.go';s=p.read_text();s=s.replace('"--engine.maxreorgdepth", "0",','// GL3 forward-only fixture retains the pinned Geth default reorg limit.');p.write_text(s)
p=source/'precompiles/precompile.go';s=p.read_text();anchor='insert(MakePrecompile(precompilesgen.ArbInfoMetaData, &ArbInfo{Address: types.ArbInfoAddress}))';assert anchor in s
registration='insert(makeGhostChessSlicesPrecompile())' if options.sliced else 'insert(debugOnly(makeGhostChessPrecompile()))'
if 'makeGhostChessPrecompile' not in s and 'makeGhostChessSlicesPrecompile' not in s:s=s.replace(anchor,registration+'\n\t'+anchor)
if options.sliced:
 s=s.replace('insert(debugOnly(makeGhostChessPrecompile()))',registration).replace('insert(debugOnly(makeGhostChessSlicesPrecompile()))',registration)
p.write_text(s)
if options.candidate_arbos_version:
 subprocess.run([sys.executable, str(HERE/'game/engine/stage_activation.py'), str(source),
                 '--candidate-arbos-version', str(options.candidate_arbos_version)], check=True)
else:
 subprocess.run([str(go),'mod','edit','-require=github.com/Gh0stllm/GH0ST/gl3/chessruntime@v0.0.0','-replace=github.com/Gh0stllm/GH0ST/gl3/chessruntime='+str(HERE/'runtime')],cwd=source,env={**os.environ,'GOTOOLCHAIN':'local'},check=True)
subprocess.run([str(go),'mod','edit','-require=github.com/Gh0stllm/GH0ST/gl3/slicedchess@v0.0.0','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(HERE/'sliced/runtime')],cwd=source,env={**os.environ,'GOTOOLCHAIN':'local'},check=True)
subprocess.run([str(go.parent/'gofmt'),'-w',*[str(p) for p in (source/'precompiles').glob('ArbGhostChess*.go')]],check=True)
print(f'Prepared isolated Nitro source: {profile}')

# Native-only reporting exposes the replay's real computed global state.
# It is not compiled into the Wasm STF and cannot supply or alter any result.
p=source/'wavmio/native.go';s=p.read_text()
if 'GL3_REPLAY_END' not in s:
 s=s.replace('lastBlockHash      common.Hash','lastBlockHash      common.Hash\n\tlastSendRoot       common.Hash')
 s=s.replace('func OnFinal() {','func OnFinal() {\n\tfmt.Printf("GL3_REPLAY_END %s %s %d %d\\n", lastBlockHash.Hex(), lastSendRoot.Hex(), seqMsgPos+seqAdvanced, posWithinMsg)')
 s=s.replace('func SetSendRoot(hash [32]byte) {\n}', 'func SetSendRoot(hash [32]byte) {\n\tlastSendRoot = hash\n}')
 p.write_text(s)
