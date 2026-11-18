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
HISTORY_NAME = "ArbGhostChessSlicesHistory.go"
HISTORY_SHA256 = "23b8693fafd44355f11c5090146813502c69e6d5cee58ae841daf3154223d60f"
LEGACY_PRECOMPILE_SHA256 = "4add58156ceed4a4e1f520066aaf5fb75d71c74310153fcd99b06b981369c434"
LEGACY_RUNTIME_SHA256 = "8ef8d7e847587ef75cc59b7cec09095c29b2674c558af84afab075df8bb73d26"
DELTA_NAME = "ArbGhostChessSliceDelta.go"
DELTA_SHA256 = "2f9b1d40773a19094e51c2130a61a23ba76f4af493d56237cad2efeed3826344"


def replace_once(text, original, updated):
    if text.count(original) != 1:
        raise ValueError("Unexpected precompile source structure")
    return text.replace(original, updated, 1)


def read_pinned(path, expected_sha256):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError(f"{path.name} differs from the pinned integration source")
    return raw.decode("utf-8")


def stage_candidate_history(overlay_dir):
    history = read_pinned(overlay_dir / HISTORY_NAME, HISTORY_SHA256)
    legacy = read_pinned(overlay_dir / "ArbGhostChess.go", LEGACY_PRECOMPILE_SHA256)
    runtime = read_pinned(overlay_dir.parent / "runtime/runtime.go", LEGACY_RUNTIME_SHA256)

    # Copy the shared error and pure UCI validator from their pinned sources.
    # Nothing in A14 needs the legacy C++ engine behind those declarations.
    error = next(line for line in legacy.splitlines() if line.startswith("var errGhostChess = "))
    start = runtime.index("func ValidMove(s string) bool {")
    end = runtime.index("\nfunc execute(", start)
    validator = replace_once(runtime[start:end], "func ValidMove(", "func validSliceMove(")
    history = replace_once(history, '\tengine "github.com/Gh0stllm/GH0ST/gl3/chessruntime"', '\t"errors"')
    history = replace_once(history, "engine.ValidMove(m)", "validSliceMove(m)")
    return (history.rstrip() + "\n\n" + error + "\n\n" + validator + "\n").encode("utf-8")


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
    if args.seed_migration:
        overlay_dir = args.base_file.parent
        sources[HISTORY_NAME] = stage_candidate_history(overlay_dir)
        sources[DELTA_NAME] = read_pinned(overlay_dir / DELTA_NAME, DELTA_SHA256).encode("utf-8")
    args.output.mkdir()
    (args.output / BASE_NAME).write_text(overlay, encoding="utf-8")
    for name, source in sources.items():
        (args.output / name).write_bytes(source)


if __name__ == "__main__":
    main()
