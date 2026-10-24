"""Reproduce the selected runtime from accepted local Q10 artifacts. No network access."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
EXPECTED_SOURCE = "1ee3a4dcb586c4e2d04026bb55daece53121e46f6a4f5162ccebaaf967c6a2c8"
sha = lambda data: hashlib.sha256(data).hexdigest()

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--baseline", type=Path, default=HERE / "layout/baseline-restored")
parser.add_argument("--output", type=Path, default=HERE / "selected")
args = parser.parse_args()
assert args.output.resolve().is_relative_to(HERE), "Keep generated files in this research directory"
source = (HERE / "dot/simd11-flat.sol").read_bytes()
assert sha(source) == EXPECTED_SOURCE
subprocess.run([sys.executable, str(HERE / "layout/export_layout.py"),
                "--source", str(args.baseline.resolve()), "--out", str(args.output.resolve())], check=True)
shutil.copyfile(HERE / "dot/simd11-flat.sol", args.output / "GRU2SIMDModel.sol")
# This export-era hook is not the secured, pool-bound N0VA hook used by this experiment.
(args.output / "GRU2SIMDHook.sol").unlink(missing_ok=True)
manifest_path = args.output / "manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest.pop("hook_source_sha256", None)
manifest.update({
    "source_sha256": EXPECTED_SOURCE,
    "pool_hook_source": "../nova-pool/contracts/NovaPoolHook.sol",
    "pool_hook_source_sha256": sha((HERE.parent / "nova-pool/contracts/NovaPoolHook.sol").read_bytes()),
    "optimization_status": "LOCAL_INTEGRATION_AND_LOAD_TESTS_PASSED",
    "selected_inference_budget": 13_300_000,
    "tested_transaction_gas_limit": 17_500_000,
    "tested_block_gas_limit": 32_000_000,
    "mainnet_actions": 0,
})
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"status": "PASS", "selected_source_sha256": EXPECTED_SOURCE,
                  "parameters": manifest["parameters"], "output": str(args.output.resolve())}))
