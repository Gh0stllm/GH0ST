#!/usr/bin/env python3
"""Stage the A14 game-admission sources for review without invoking a toolchain."""

import argparse
import hashlib
import json
from pathlib import Path

BASE_NAME = "ArbGhostChessSlices.go"
BASE_SHA256 = "43196fa745e0a7cbb03cc02c8a88a7747c654be156ac4345073e8030d9d99cd2"
ADDITION_NAME = "ArbGhostChessSlicesGame.go"
SEED_ADDITION_NAME = "ArbGhostChessSlicesSeed.go"


def replace_once(text, original, updated):
    if text.count(original) != 1:
        raise ValueError("Unexpected precompile source structure")
    return text.replace(original, updated, 1)


def abi_entry(name, mutability, inputs, outputs):
    def fields(items):
        return [{"name": field, "type": kind} for field, kind in items]

    return json.dumps({
        "name": name,
        "type": "function",
        "stateMutability": mutability,
        "inputs": fields(inputs),
        "outputs": fields(outputs),
    }, separators=(",", ":"))


def apply_overlay(raw, include_seed_migration=False):
    if hashlib.sha256(raw).hexdigest() != BASE_SHA256:
        raise ValueError("A14 base source differs from the pinned integration base")
    base = raw.decode("utf-8")
    end_abi = "\n]`\n\ntype ArbGhostChessSlices struct"
    methods = [
        abi_entry("gameCoordinator", "view", (), (("coordinator", "address"),)),
        abi_entry("engineStatus", "view", (), (
            ("moduleSha256", "bytes32"), ("seedRoot", "bytes32"), ("seedAvailable", "bool"),
        )),
        abi_entry("setGameCoordinator", "nonpayable", (("coordinator", "address"),), ()),
    ]
    if include_seed_migration:
        methods.extend((
            abi_entry("seedMigrationProgress", "view", (), (
                ("nextChunk", "uint32"), ("totalChunks", "uint32"),
            )),
            abi_entry("installSeedChunk", "nonpayable", (
                ("chunk", "uint32"), ("nonZeroPages", "uint16"),
                ("pages", "bytes"), ("siblings", "bytes32[14]"),
            ), (("complete", "bool"),)),
        ))
    base = replace_once(base, end_abi, ",\n " + ",\n ".join(methods) + end_abi)
    header = "func (p ArbGhostChessSlices) NewGame(c ctx, evm mech, job bytes32) (bytes32, error) {\n"
    old_auth = (
        "\tallowed, e := c.State.ChainOwners().IsMember(c.caller)\n"
        "\tif e != nil || !allowed {\n"
        "\t\treturn bytes32{}, errGhostChess\n"
        "\t}\n"
    )
    new_auth = (
        "\tcoordinator, e := p.GameCoordinator(c, evm)\n"
        "\tif e != nil {\n"
        "\t\treturn bytes32{}, e\n"
        "\t}\n"
        "\tif coordinator == (addr{}) || coordinator != c.caller || evm.ChainConfig().ArbitrumChainParams.AllowDebugPrecompiles {\n"
        "\t\treturn bytes32{}, errGhostChess\n"
        "\t}\n"
    )
    base = replace_once(base, header + old_auth, header + new_auth)
    store_seed = "\tif e = sliceMetaWrite(store, seed); e != nil {"
    base = replace_once(base, store_seed, (
        "\tif !validSliceGameSeed(seed) {\n"
        "\t\treturn bytes32{}, errGhostChess\n"
        "\t}\n"
        + store_seed
    ))
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_file", type=Path, help="Pinned ArbGhostChessSlices.go source")
    parser.add_argument("output", type=Path, help="New directory for the staged Go files")
    parser.add_argument("--seed-migration", action="store_true",
                        help="Include the exact seed installer in the separate upgrade candidate")
    args = parser.parse_args()
    overlay = apply_overlay(args.base_file.read_bytes(), args.seed_migration)
    additions = [ADDITION_NAME]
    if args.seed_migration:
        additions.append(SEED_ADDITION_NAME)
    sources = {name: Path(__file__).with_name(name).read_bytes() for name in additions}
    args.output.mkdir()
    (args.output / BASE_NAME).write_text(overlay, encoding="utf-8")
    for name, source in sources.items():
        (args.output / name).write_bytes(source)


if __name__ == "__main__":
    main()
