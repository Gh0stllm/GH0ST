"""Restore exact local artifacts; never connects to a chain or signs a transaction."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
EARLIER = HERE.parent / "nova-optimization"
EXPECTED_MODEL = "e7185cadb3feda3f8cffa01bdd1b6945ed911761603f8cae0668195c8fde0835"
EXPECTED_SENTENCE_HOOK = "20fa9fc808d36cf6ac8b3c2ed9cb5b382aafd752cd3e726bfc5513abce64a07d"
EXPECTED_COMPACT_HOOK = "86d0806dbbb6f6f29f75966edb313d4b0b5c6b1790b30a5440e7c083dc1c55f9"
sha = lambda data: hashlib.sha256(data).hexdigest()
if not (EARLIER / "selected/core.bin").exists():
    subprocess.run([sys.executable, str(EARLIER / "layout/restore_baseline.py")], check=True)
    subprocess.run([sys.executable, str(EARLIER / "prepare-selected.py")], check=True)
derived = HERE / "layout/b25x10a5"
if not (derived / "core.bin").exists():
    subprocess.run([sys.executable, str(HERE / "layout/export.py")], check=True)
manifest = json.loads((derived / "manifest.json").read_text())
assert manifest["parameters"] == 8_175_493
assert manifest["checkpoint_sha256"] == "904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3"
out = HERE / "selected"
out.mkdir(exist_ok=True)
for name, metadata in manifest["artifacts"].items():
    source = derived / name
    assert sha(source.read_bytes()) == metadata["sha256"], name
    shutil.copyfile(source, out / name)
assert sha((derived / "reference.npz").read_bytes()) == manifest["reference_sha256"]
shutil.copyfile(derived / "reference.npz", out / "reference.npz")
for source_name, target, expected in [
    ("kernels/assembly-b25x10a5.sol", "GRU2SIMDModel.sol", EXPECTED_MODEL),
    ("audit/NovaPoolHook12.sol", "NovaPoolHook.sol", None),
    ("kernels/NovaSentenceBufferedHook.sol", "NovaSentencePoolHook.sol", EXPECTED_SENTENCE_HOOK),
    ("kernels/NovaSentenceCompactHook.sol", "NovaSentenceCompactHook.sol", EXPECTED_COMPACT_HOOK),
]:
    data = (HERE / source_name).read_bytes()
    if expected:
        assert sha(data) == expected
    (out / target).write_bytes(data)
manifest.update(source_sha256=EXPECTED_MODEL, pool_hook_source="NovaPoolHook.sol",
                pool_hook_source_sha256=sha((out / "NovaPoolHook.sol").read_bytes()),
                sentence_hook_source="NovaSentencePoolHook.sol", sentence_hook_source_sha256=EXPECTED_SENTENCE_HOOK,
                compact_sentence_hook_source="NovaSentenceCompactHook.sol", compact_sentence_hook_source_sha256=EXPECTED_COMPACT_HOOK,
                optimization_status="GENERATED_LOCAL_CANDIDATE_TARGET_NOT_MET", mainnet_actions=0)
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"status": "PREPARED_LOCAL_ONLY", "parameters": manifest["parameters"], "output": str(out)}))
