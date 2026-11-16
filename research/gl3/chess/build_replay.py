"""Build the isolated full chess node, Go replay and direct C++ WAVM companion.

Uses previously verified clean Nitro/native dependencies and standard Wasm libraries.
Generating a machine is a build gate; it does not execute a complete chess block.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,time

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
 parser=argparse.ArgumentParser();parser.add_argument('--sliced',action='store_true');options=parser.parse_args()
 if options.sliced:
  SOURCE=CACHE/'nitro-sliced';BIN=CACHE/'bin-sliced';MACHINE=CACHE/'machine-sliced'
 started=time.monotonic()
 run(['python3',HERE/'prepare_nitro.py',*(['--sliced'] if options.sliced else [])])
 BIN.mkdir(exist_ok=True);MACHINE.mkdir(exist_ok=True)
 run([GO,'build','-mod=mod','-o',BIN/'nitro','./cmd/nitro'],cwd=SOURCE,env=env)
 run([GO,'build','-mod=mod','-o',BIN/'replay-native','./cmd/replay'],cwd=SOURCE,env=env)
 run([GO,'build','-mod=mod','-o',BIN/'replay.raw.wasm','./cmd/replay'],cwd=SOURCE,env={**env,'GOOS':'wasip1','GOARCH':'wasm','CGO_ENABLED':'0'})
 canon=OLD/'stylus-native/.cache/target/release/gh0st-wasm-canonicalizer'
 run([canon,BIN/'replay.raw.wasm',BIN/'replay.wasm'])
 if not options.sliced:run([canon,HERE/'engine/.cache/gl3chess.wasm',BIN/'gl3chess.wasm'])
 args=[OLD/'.cache/stylus-target/release/prover',BIN/'replay.wasm','--generate-binaries',MACHINE]
 standard=OLD/'.cache/nitro-build/target/machines/latest'
 for name in LIBS:args+=['-l',standard/(name+'.wasm')]
 if not options.sliced:args+=['-l',BIN/'gl3chess.wasm']
 run(args)
 if options.sliced:
  layout=CACHE/'machines-sliced';layout.mkdir(exist_ok=True)
  for name in ['latest',(MACHINE/'module-root.txt').read_text().strip()]:
   link=layout/name
   if link.is_symlink():link.unlink()
   if link.exists():raise RuntimeError('Refusing to replace a non-symlink machine directory')
   link.symlink_to(MACHINE.resolve(),target_is_directory=True)
 artifacts=[BIN/'nitro',BIN/'replay-native',BIN/'replay.raw.wasm',BIN/'replay.wasm',MACHINE/'machine.v2.wavm.br',MACHINE/'until-host-io-state.bin']
 if not options.sliced:artifacts.append(BIN/'gl3chess.wasm')
 report={'scope':'Complete custom machine generated; full engine-bearing replay/proof not implied','sliced':options.sliced,'machineGenerated':True,'moduleRoot':(MACHINE/'module-root.txt').read_text().strip(),'artifacts':{p.name:record(p) for p in artifacts},'standardLibraries':{name:record(standard/(name+'.wasm')) for name in LIBS},'seconds':time.monotonic()-started,'publicDeployment':False,'realSpend':0}
 (CACHE/('sliced-replay-build.json' if options.sliced else 'replay-build.json')).write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
