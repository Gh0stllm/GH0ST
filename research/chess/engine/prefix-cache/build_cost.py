#!/usr/bin/env python3
"""Build a synthetic local-only snapshot bandwidth probe, not a game engine."""
from pathlib import Path
import json,subprocess,sys
HERE=Path(__file__).resolve().parent;ENGINE=HERE.parent;CACHE=ENGINE/'.cache/prefix-cache-cost';CACHE.mkdir(parents=True,exist_ok=True)
cfg='''[build-wasm]
canister = "gh0st_prefix_restore_cost"
did_path = %s
cpp_paths = [%s]
cpp_include_dirs = []
cpp_compile_flags = ["-msimd128"]
cpp_link_flags = ["-Wl,-z,stack-size=8388608"]
c_paths = []
c_include_dirs = []
c_compile_flags = []
post_wasm_function = ""
'''%(json.dumps(str(HERE/'restore-cost.did')),json.dumps(str(HERE/'restore_cost.cpp')))
(CACHE/'icpp.toml').write_text(cfg)
if not(CACHE/'build-library').exists():(CACHE/'build-library').symlink_to(ENGINE/'build-library',target_is_directory=True)
subprocess.run([sys.executable,str(ENGINE/'tools/icpp_local.py'),'build-wasm','--config',str(CACHE/'icpp.toml'),'--to-compile','mine-no-lib','--generate-bindings','no'],cwd=ENGINE,check=True)
print(CACHE/'build/gh0st_prefix_restore_cost.wasm')
