#!/bin/sh
# Explicit restore only. No service, chain, wallet, or public listener is started.
set -eu
MODE=${1:---check}
case "$MODE" in --check|--install-aliases) ;; *) exit 2;; esac
RUNTIME=/workspace/gl3/durable/reset-runtime-v1
export PYTHONHOME="$RUNTIME" PYTHONNOUSERSITE=1 LD_LIBRARY_PATH="$RUNTIME/lib"
exec "$RUNTIME/lib/ld-linux-x86-64.so.2" --library-path "$RUNTIME/lib" "$RUNTIME/bin/python3.12" -I -S -B - "$MODE" <<'PY'
from pathlib import Path
import hashlib,json,os,sys
mode=sys.argv[1];base=Path('/workspace/gl3/durable/reset-runtime-v1');m=json.loads((base/'manifest.json').read_text());assert m['passed']
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
for n,x in m['files'].items():assert sha(base/n)==x['SHA256'],n
for n,x in m['officialBinarySHA256'].items():assert sha(Path(n))==x,n
links={'/root/dispute':'/workspace/gl3/durable/neutral/dispute','/root/gl3-base-launch/bin/nitro':'/workspace/gl3/durable/bin/nitro','/root/gl3-base-launch/machines':'/workspace/gl3/durable/machines','/root/gl3-base-launch/nitro-clean':'/workspace/gl3/durable/nitro-clean','/root/terminal-acceptance/bin/geth':'/workspace/gl3/durable/bin/geth'}
missing=[]
for p,t in links.items():
 p=Path(p);assert Path(t).exists()
 if p.exists()or p.is_symlink():assert p.resolve()==Path(t).resolve(),'Refuse to replace existing path '+str(p)
 elif mode=='--install-aliases':p.parent.mkdir(parents=True,exist_ok=True);p.symlink_to(t)
 else:missing.append(str(p))
print(json.dumps({'runtimeHashesMatch':True,'mode':mode,'missingAliases':missing,'servicesStarted':False,'walletFilesRead':False}))
PY
