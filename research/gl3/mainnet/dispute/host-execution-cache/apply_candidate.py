"""Apply an explicitly selected frozen host candidate to an isolated SDK.

Run on Runpod. This performs file reconstruction only, with exact baseline and
overlay hashes. It does not build, test, start a node, or select a machine root.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sdk", type=Path)
    parser.add_argument("--candidate", required=True, choices=["01", "02", "03"])
    args = parser.parse_args()
    target = args.sdk.resolve()
    frozen = Path(__file__).resolve().parent / ("candidate-" + args.candidate)
    manifest = json.loads((frozen / "source-manifest.json").read_text())
    for name, expected in manifest["baselineFiles"].items():
        if sha(target / name) != expected:
            raise SystemExit("Pristine host-source mismatch: " + name)
    patch = frozen / "sdk-host-only.patch"
    if sha(patch) != manifest["patchSHA256"]:
        raise SystemExit("Frozen patch checksum mismatch")
    for name, expected in manifest["sourceFiles"].items():
        if sha(frozen / "source" / name) != expected:
            raise SystemExit("Frozen overlay checksum mismatch: " + name)
        if name not in manifest["baselineFiles"] and (target / name).exists():
            if sha(target / name) != expected:
                raise SystemExit("Existing helper differs: " + name)
    subprocess.run(["git", "apply", "--check", str(patch)], cwd=target, check=True)
    subprocess.run(["git", "apply", str(patch)], cwd=target, check=True)
    for name, expected in manifest["sourceFiles"].items():
        dest = target / name
        if name not in manifest["baselineFiles"]:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((frozen / "source" / name).read_bytes())
        if sha(dest) != expected:
            raise SystemExit("Reconstructed source mismatch: " + name)
    print("Explicit frozen host candidate reconstructed; no build or test performed")


if __name__ == "__main__":
    main()
