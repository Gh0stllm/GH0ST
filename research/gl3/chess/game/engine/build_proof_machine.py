#!/usr/bin/env python3
"""Assemble the A14 candidate proof machine from verified replay and host libraries."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


PROVER_SHA256 = "7befb9d61622a018df714d28a7e4909cbdf775ac79e5698ac6cce35ca211f6c3"
LIBRARIES = {
    "forward": "1c45bf8429ca216ea9fa8b6ef4251e859800f7091f3d5be57a9566ffeeca6c99",
    "soft-float": "eed26863498c0b0a060da3bc42dc09dea84e8872cf763f91598e698fb54b604f",
    "wasi_stub": "03a9679220dc6854bc86abbf9a4138bbd92371d1a77cf2155708d223fa26662c",
    "host_io": "f524b7ca272ded1159c5c287c13c8754f8b10c98f0d31ee854d10096b3e0630f",
    "user_host": "a7a523d2e71ce1a4c7ae7f984032331b0298ea939f1dc6ccdc80ff6135ba34ac",
    "arbcompress": "31c244b2e373e2e6cc189853fb6824a0f1244061b61b9eb27b57df103cf96ada",
    "arbcrypto": "3ca6af8045178453415ed53aaa5a58e789e9a22b97cce0f502cff775576ef094",
    "program_exec": "dbadff49188bbc5a6477d6fef4dec17f210e4e08e9699aec986a050c029a3ecb",
}


def artifact(path):
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"bytes": path.stat().st_size, "sha256": digest}


def verify(path, expected):
    record = artifact(path)
    if record["sha256"] != expected:
        raise ValueError(f"Unexpected hash for {path.name}")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_replay", type=Path)
    parser.add_argument("raw_replay_sha256")
    parser.add_argument("canonicalizer", type=Path)
    parser.add_argument("prover", type=Path)
    parser.add_argument("library_directory", type=Path)
    parser.add_argument("new_output_directory", type=Path)
    args = parser.parse_args()

    try:
        raw = verify(args.raw_replay, args.raw_replay_sha256)
        prover = verify(args.prover, PROVER_SHA256)
        libraries = [args.library_directory / f"{name}.wasm" for name in LIBRARIES]
        library_records = {
            path.name: verify(path, expected)
            for path, expected in zip(libraries, LIBRARIES.values(), strict=True)
        }

        args.new_output_directory.mkdir(mode=0o700)
        replay = args.new_output_directory / "replay.wasm"
        subprocess.run([args.canonicalizer, args.raw_replay, replay], check=True)
        command = [args.prover, replay, "--generate-binaries", args.new_output_directory]
        for path in libraries:
            command.extend(["-l", path])
        subprocess.run(command, check=True, env={**os.environ, "RAYON_NUM_THREADS": "2"})

        root = (args.new_output_directory / "module-root.txt").read_text().strip()
        if not re.fullmatch(r"0x[0-9a-f]{64}", root):
            raise ValueError("The proof machine did not return a valid module root")
        outputs = ("replay.wasm", "machine.v2.wavm.br", "until-host-io-state.bin")
        report = {
            "scope": "Candidate proof machine assembly",
            "moduleRoot": root,
            "rawReplay": raw,
            "canonicalizer": artifact(args.canonicalizer),
            "prover": prover,
            "hostLibraries": library_records,
            "artifacts": {name: artifact(args.new_output_directory / name) for name in outputs},
            "activationBoundaryReplayVerified": False,
            "mainnetActivationVerified": False,
        }
        (args.new_output_directory / "assembly.json").write_text(json.dumps(report, indent=2) + "\n")
        print(root)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
