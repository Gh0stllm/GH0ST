"""Build the isolated full chess node, Go replay and direct C++ WAVM companion.

Uses previously verified clean Nitro/native dependencies and standard Wasm libraries.
Generating a machine is a build gate; it does not execute a complete chess block.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,time,re

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
CACHE=HERE/'.cache'
SOURCE=CACHE/'nitro-chess'
CORE=REPO/'research/chess/l3/core/node'
OLD=REPO/'research/chess/l3/nitro'
GO=CORE/'.cache/go-1.25.12/go/bin/go'
BIN=CACHE/'bin'
MACHINE=CACHE/'machine'
LIBS=['forward','soft-float','wasi_stub','host_io','user_host','arbcompress','arbcrypto','program_exec']
env={**os.environ,'GOTOOLCHAIN':'local'}

def run(args,**kw):return subprocess.run([str(x) for x in args],check=True,**kw)
def record(p):return {'bytes':p.stat().st_size,'SHA256':hashlib.sha256(p.read_bytes()).hexdigest()}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--sliced',action='store_true');parser.add_argument('--variant',default='');parser.add_argument('--aot-proof',action='store_true');parser.add_argument('--game-coordinator',action='store_true')
 parser.add_argument('--candidate-arbos-version', type=int, choices=[62],
                     help='Build the separate GL3-only upgrade candidate')
 parser.add_argument('--parent-authorized-a14', action='store_true',
                     help='Build the parent-authorized A14 profile for renounced GL3')
 options=parser.parse_args()
 assert not options.variant or (options.sliced and re.fullmatch('[a-z0-9-]+',options.variant))
 assert not options.aot_proof or (options.sliced and re.fullmatch(r'aot(?:-[a-z0-9-]+)?',options.variant)), 'AOT proof experiment requires a reserved aot variant'
 if options.game_coordinator and not options.sliced:
  parser.error('--game-coordinator requires the A14 sliced engine')
 if options.candidate_arbos_version and (not options.game_coordinator or options.aot_proof):
  parser.error('--candidate-arbos-version requires --game-coordinator and the same engine for native and proof')
 if options.parent_authorized_a14 and not options.candidate_arbos_version:
  parser.error('--parent-authorized-a14 requires --candidate-arbos-version')
 suffix='-'+options.variant if options.variant else ''
 profile='game-a14' if options.game_coordinator else 'sliced'
 if options.candidate_arbos_version:
  profile=f'game-a14-upgrade-{options.candidate_arbos_version}'
 if options.parent_authorized_a14:
  profile=f'game-a14-parent-{options.candidate_arbos_version}'
 if options.sliced:
  SOURCE=CACHE/('nitro-'+profile+suffix);BIN=CACHE/('bin-'+profile+suffix);MACHINE=CACHE/('machine-'+profile+suffix)
 if options.aot_proof:
  proof_report=json.loads((HERE/'sliced/aot/.cache/proof-parity.json').read_text())
  assert proof_report['passed'] and proof_report['artifactSHA256']==hashlib.sha256((HERE/'sliced/aot/.cache/companion.wasm').read_bytes()).hexdigest(), 'Proof companion has no matching parity/error result'
 started=time.monotonic()
 prepare=['python3',HERE/'prepare_nitro.py',*(['--sliced'] if options.sliced else []),
          *(['--variant',options.variant] if options.variant else []),
          *(['--game-coordinator'] if options.game_coordinator else [])]
 if options.candidate_arbos_version:
  prepare.extend(['--candidate-arbos-version',options.candidate_arbos_version])
 if options.parent_authorized_a14:
  prepare.append('--parent-authorized-a14')
 run(prepare)
 BIN.mkdir(exist_ok=True);MACHINE.mkdir(exist_ok=True)
 build_flags=['-mod=readonly','-trimpath'] if options.parent_authorized_a14 else ['-mod=mod']
 run([GO,'build',*build_flags,'-o',BIN/'nitro','./cmd/nitro'],cwd=SOURCE,env=env)
 run([GO,'build',*build_flags,'-o',BIN/'replay-native','./cmd/replay'],cwd=SOURCE,env=env)
 if options.aot_proof:
  aot_runtime=CACHE/('aot-runtime-game'+suffix if options.game_coordinator else 'aot-runtime'+suffix)
  run(['python3',HERE/'sliced/aot/make_runtime.py',aot_runtime])
  run([GO,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(aot_runtime)],cwd=SOURCE,env=env)
 run([GO,'build',*build_flags,*(['-tags=gl3aotproof'] if options.aot_proof else []),'-o',BIN/'replay.raw.wasm','./cmd/replay'],cwd=SOURCE,env={**env,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'})
 canon=OLD/'stylus-native/.cache/target/release/gh0st-wasm-canonicalizer'
 run([canon,BIN/'replay.raw.wasm',BIN/'replay.wasm'])
 if not options.sliced:run([canon,HERE/'engine/.cache/gl3chess.wasm',BIN/'gl3chess.wasm'])
 if options.aot_proof:run([canon,HERE/'sliced/aot/.cache/companion.wasm',BIN/'gl3aot.wasm'])
 args=[OLD/'.cache/stylus-target/release/prover',BIN/'replay.wasm','--generate-binaries',MACHINE]
 standard=OLD/'.cache/nitro-build/target/machines/latest'
 for name in LIBS:args+=['-l',standard/(name+'.wasm')]
 if not options.sliced:args+=['-l',BIN/'gl3chess.wasm']
 if options.aot_proof:args+=['-l',BIN/'gl3aot.wasm']
 run(args)
 if options.sliced:
  layout=CACHE/('machines-'+profile+suffix);layout.mkdir(exist_ok=True)
  for name in ['latest',(MACHINE/'module-root.txt').read_text().strip()]:
   link=layout/name
   if link.is_symlink():link.unlink()
   if link.exists():raise RuntimeError('Refusing to replace a non-symlink machine directory')
   link.symlink_to(MACHINE.resolve(),target_is_directory=True)
 artifacts=[BIN/'nitro',BIN/'replay-native',BIN/'replay.raw.wasm',BIN/'replay.wasm',MACHINE/'machine.v2.wavm.br',MACHINE/'until-host-io-state.bin']
 if not options.sliced:artifacts.append(BIN/'gl3chess.wasm')
 if options.aot_proof:artifacts.append(BIN/'gl3aot.wasm')
 report={'scope':'Complete custom machine generated; full engine-bearing replay/proof not implied','sliced':options.sliced,'experimentalAOTProof':options.aot_proof,'machineGenerated':True,'moduleRoot':(MACHINE/'module-root.txt').read_text().strip(),'artifacts':{p.name:record(p) for p in artifacts},'standardLibraries':{name:record(standard/(name+'.wasm')) for name in LIBS},'seconds':time.monotonic()-started,'publicDeployment':False,'realSpend':0}
 if options.game_coordinator:
  report['gameCoordinatorOverlay']={name:record(SOURCE/'precompiles'/name) for name in ['ArbGhostChessSlices.go','ArbGhostChessSlicesGame.go']}
 if options.candidate_arbos_version:
  report['gameCoordinatorOverlay']['ArbGhostChessSlicesSeed.go']=record(SOURCE/'precompiles/ArbGhostChessSlicesSeed.go')
  report['upgradeCandidate']={
   'arbosVersion':options.candidate_arbos_version,
   'historicalReplayVerified':False,
   'seedMigrationExecuted':False,
   'mainnetActivationVerified':False,
   'sourceOverlay':record(HERE/'game/engine/stage_activation.py'),
  }
  if options.parent_authorized_a14:
   report['upgradeCandidate']['parentAuthorizationOverlays']={
    name:record(HERE/'game/engine/ownerless'/name)
    for name in ['stage_parent_activation.py', 'stage_parent_bootstrap.py']
   }
 (CACHE/(profile+'-replay-build'+suffix+'.json' if options.sliced else 'replay-build.json')).write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
