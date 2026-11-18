#!/usr/bin/env python3
"""Install the parent-authorized A14 bootstrap in an isolated Nitro tree."""

import argparse
import hashlib
import json
from pathlib import Path


ABI = "ArbGhostChessSlices.go"
GAME = "ArbGhostChessSlicesGame.go"
SEED = "ArbGhostChessSlicesSeed.go"
BOOTSTRAP = "ArbGhostChessSlicesBootstrap.go"

SOURCE_PINS = {
    ABI: "ec603e5801ed86901a42ae06e2e9059b0cfb8b46ff6f2f4ef882db3e57c6ba7b",
    GAME: "b7078c9958239c6c2d5637f2dbe91780c75dff0f73702f36c054170c261e7418",
    SEED: "1cb2ff304ba6bb96037ac449bc4816781aac6bdc3422c89be8b5b1f2e3d03e7e",
}


def pinned_source(path, digest):
    if path.resolve(strict=True) != path or not path.is_file():
        raise ValueError(f"Refusing shared or non-regular source {path.name}")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Unexpected A14 source hash for {path.name}")
    return data.decode("utf-8")


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError("Unexpected A14 bootstrap source anchor")
    return source.replace(old, new, 1)


def abi_methods():
    installer = {"name": "installer", "type": "address"}
    for name, mutability, inputs, outputs in (
        ("seedInstaller", "view", [], [installer]),
        ("setSeedInstaller", "nonpayable", [installer], []),
    ):
        yield json.dumps(
            {
                "name": name,
                "type": "function",
                "stateMutability": mutability,
                "inputs": inputs,
                "outputs": outputs,
            },
            separators=(",", ":"),
        )


def stage_bootstrap(root):
    directory = root / "precompiles"
    target = directory / BOOTSTRAP
    if target.exists() or target.is_symlink():
        raise ValueError("Stage the A14 bootstrap in a fresh Nitro source copy")

    sources = {
        name: pinned_source(directory / name, digest)
        for name, digest in SOURCE_PINS.items()
    }
    end_abi = '\n]`\n\ntype ArbGhostChessSlices struct'
    sources[ABI] = replace_once(sources[ABI], end_abi, ",\n " + ",\n ".join(abi_methods()) + end_abi)

    game = sources[GAME]
    start = game.index("// SetGameCoordinator authorizes")
    end = game.index("func (p ArbGhostChessSlices) EngineStatus", start)
    sources[GAME] = game[:start] + """// SetGameCoordinator registers one game after the pinned seed is complete.
func (p ArbGhostChessSlices) SetGameCoordinator(c ctx, evm mech, coordinator addr) error {
	return p.setA14BootstrapCoordinator(c, evm, coordinator)
}

""" + game[end:]

    old_auth = """	owner, err := c.State.ChainOwners().IsMember(c.caller)
	if err != nil {
		return false, err
	}
	if !owner {
		return false, errGhostChess
	}
"""
    new_auth = """	installer, err := p.a14SeedInstallerAuthorized(c, evm)
	if err != nil {
		return false, err
	}
	if !installer {
		return false, errGhostChess
	}
"""
    sources[SEED] = replace_once(sources[SEED], old_auth, new_auth)
    template = Path(__file__).with_name("bootstrap_precompile.go").read_bytes()
    for name, source in sources.items():
        (directory / name).write_bytes(source.encode("utf-8"))
    target.write_bytes(template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nitro_tree", type=Path, help="Fresh isolated A14 Nitro source with activation staged")
    args = parser.parse_args()
    try:
        stage_bootstrap(args.nitro_tree.resolve(strict=True))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
