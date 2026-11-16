"""Build the same pure integer runtime for native CPU and Wasm, without deployment."""
from pathlib import Path
import hashlib
import json
import platform
import shutil
import subprocess

HERE=Path(__file__).resolve().parent
cache=HERE/".cache"
cache.mkdir(exist_ok=True)
if not (cache/"model_layout.h").exists():
    raise SystemExit("Run prepare_model.py with a verified export first")
native=shutil.which("clang++")
wasi=HERE.parents[1]/"engine/.cache/toolchain/wasi-sdk/wasi-sdk-25.0/bin/clang++"
if not native or not wasi.exists():
    raise SystemExit("Native clang++ and the cached WASI SDK are required")
common=["-std=c++17","-O2","-fno-exceptions","-fno-rtti","-fwrapv","-fno-vectorize","-fno-slp-vectorize","-I",str(cache),str(HERE/"runtime.cpp")]
library=cache/("libruntime.dylib" if platform.system()=="Darwin" else "libruntime.so")
native_command=[native,*common,"-dynamiclib" if platform.system()=="Darwin" else "-shared","-fPIC","-o",str(library)]
wasm=cache/"runtime.wasm"
exports=["gh_model_ptr","gh_model_len","gh_seal_model","gh_accept_preverified_model","gh_reset","gh_begin","gh_advance",
    "gh_phase","gh_step","gh_position","gh_best_token","gh_logits_ptr","gh_logits_count",
    "gh_checkpoint_ptr","gh_checkpoint_capacity","gh_checkpoint_export","gh_checkpoint_restore"]
wasm_command=[str(wasi),*common,"-nostartfiles","-Wl,--no-entry","-Wl,--export-memory",
    *["-Wl,--export="+name for name in exports],"-Wl,--stack-first","-Wl,-z,stack-size=262144",
    "-Wl,--initial-memory=8388608","-Wl,--max-memory=33554432","-o",str(wasm)]
for command in [native_command,wasm_command]:
    subprocess.run(command,check=True,capture_output=True,text=True)
descriptor=json.loads((HERE/"model-descriptor.json").read_text())
report={"scope":"Native and generic Wasm build only, not Nitro activation or fraud proof",
    "modelSHA256":descriptor["flatModelSHA256"],"codeEmbedsModelWeights":False,
    "arithmetic":"integer INT8/Q12; no floating point or SIMD", "artifacts":{}}
for name,path in [("native",library),("wasm",wasm)]:
    data=path.read_bytes();report["artifacts"][name]={"file":path.name,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}
(HERE/"build-evidence.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
