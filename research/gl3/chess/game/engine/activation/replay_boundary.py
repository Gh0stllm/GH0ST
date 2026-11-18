#!/usr/bin/env python3
"""Compare the A14 proof machine's replay to the recorded private boundary."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


END_STATE = re.compile(
    r"End GlobalState:\s+BlockHash: (0x[0-9a-f]{64})\s+"
    r"SendRoot: (0x[0-9a-f]{64})\s+Batch: (\d+)\s+PosInBatch: (\d+)"
)
FIELDS = ("BlockHash", "SendRoot", "Batch", "PosInBatch")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def replay(prover, machine, source, destination, label, max_steps):
    data = json.loads(source.read_text())
    expected = data["ExpectedEndState"]
    proof = destination / f"proof-{label}.json"
    logfile = destination / f"proof-{label}.log"
    command = [
        prover, machine, "--json-inputs", source, "--require-success",
        "--max-steps", str(max_steps), "--proving-interval", "100000000", "-o", proof,
    ]
    with logfile.open("x") as log:
        subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
    log = re.sub(r"\x1b\[[0-9;]*m", "", logfile.read_text())
    final = END_STATE.search(log)
    if (final is None or "End machine status: Finished" not in log
            or "Computed state matches the expected one" not in log
            or final.groups() != tuple(str(expected[key]) for key in FIELDS)):
        raise ValueError(f"Exact replay state did not match for {label}")
    return {"expectedEndState": expected, "inputSHA256": sha256(source), "proofSHA256": sha256(proof)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prover", type=Path)
    parser.add_argument("machine_directory", type=Path)
    parser.add_argument("recording_directory", type=Path)
    parser.add_argument("new_output_directory", type=Path)
    parser.add_argument("--max-steps", type=int, default=8_000_000_000)
    args = parser.parse_args()
    if args.max_steps <= 0:
        parser.error("--max-steps must be positive")

    boundary = json.loads((args.recording_directory / "boundary.json").read_text())
    assembly = json.loads((args.machine_directory / "assembly.json").read_text())
    machine = args.machine_directory / "machine.v2.wavm.br"
    root = assembly["moduleRoot"]
    if boundary["moduleRoot"] != root or not boundary["nativeCapturePassed"]:
        raise ValueError("The recorded boundary was created for a different machine")
    if sha256(machine) != assembly["artifacts"][machine.name]["sha256"]:
        raise ValueError("The proof machine checksum does not match its build")
    if sha256(args.prover) != assembly["prover"]["sha256"]:
        raise ValueError("The prover checksum does not match its build")

    os.environ["RAYON_NUM_THREADS"] = "2"
    actual_root = subprocess.check_output(
        [args.prover, machine, "--print-wasmmoduleroot"], text=True, timeout=300,
    )
    if root not in actual_root:
        raise ValueError("The machine returned a different module root")

    args.new_output_directory.mkdir(mode=0o700)
    cases = {
        label: replay(args.prover, machine, args.recording_directory / f"input-{label}.json",
                      args.new_output_directory, label, args.max_steps)
        for label in ("before", "after")
    }
    report = {
        "scope": "Private native and proof replay across the A14 activation boundary",
        "moduleRoot": root,
        "checks": cases,
        "proofStepLimit": args.max_steps,
        "activationBoundaryReplayVerified": True,
        "mainnetActivationVerified": False,
    }
    output = json.dumps(report, indent=2) + "\n"
    (args.new_output_directory / "boundary-proof.json").write_text(output)
    print(output, end="")


if __name__ == "__main__":
    main()
