"""Recreate derived integer/Solidity shards from one frozen analysis checkpoint."""
import argparse
import json
from pathlib import Path
import sys

import torch

from analysis_codec import sha256, vocabulary_spec
from evaluate_analysis import export_integer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError("export destination must be fresh")
    sys.path.insert(0, str(args.source_root.resolve()))
    raw = args.checkpoint.read_bytes()
    saved = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    if saved.get("format") != "s0ul-analysis-training-v1" or saved.get("codec") != vocabulary_spec():
        raise ValueError("checkpoint/codec mismatch")
    args.output.mkdir(parents=True, exist_ok=True)
    _, result = export_integer(saved, args.checkpoint, args.output)
    if sha256(raw) != result["checkpoint_sha256"] or args.checkpoint.read_bytes() != raw:
        raise ValueError("checkpoint changed during export")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
