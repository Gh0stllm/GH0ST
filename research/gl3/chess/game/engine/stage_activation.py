#!/usr/bin/env python3
"""Stage the A14 activation candidate in an isolated Nitro source copy."""

import argparse
import hashlib
from pathlib import Path


def source_edits(candidate_version):
    rules = "func (c *ChainConfig) IsArbitrum() bool {"
    register = "\tinsert(makeGhostChessSlicesPrecompile())"
    wrap = "\t\tvar wrapped vm.AdvancedPrecompile = ArbosPrecompileWrapper{precompile}"
    elara = "\tcase rules.IsElara:\n\t\treturn "
    max_version = "const MaxArbosVersionSupported = ArbosVersion_61"
    upgrade = (
        "\t\tcase params.ArbosVersion_61:\n"
        "\t\t\t// ArbosVersion_MultiGasRefundFix: multi-dimensional gas bug fixes.\n"
        "\t\t\t// No state changes needed."
    )
    return {
        "go-ethereum/params/config_arbitrum.go": (
            "229c8897ce78450384d53ad21e091d4876fc35be70103656372a382fbf7714ac",
            (
                (rules, """func GL3A14Address() common.Address {
	return common.Address{18: 0x0a, 19: 0x14}
}

func (c *ChainConfig) IsGL3A14(arbosVersion uint64) bool {
	return c.IsArbitrum() && !c.DebugMode() && c.ChainID != nil &&
		c.ChainID.IsUint64() && c.ChainID.Uint64() == 4663001 &&
		arbosVersion == ArbosVersion_GL3A14
}

""" + rules),
                (max_version, (
                    f"const ArbosVersion_GL3A14 = uint64({candidate_version})\n"
                    "const MaxArbosVersionSupported = ArbosVersion_GL3A14"
                )),
            ),
        ),
        "go-ethereum/params/config.go": (
            "a8dee8f8ef54db8f3c95230aa0ad99df4166c39c6ccce761808f6894427efece",
            (
                ("type Rules struct {", "type Rules struct {\n\tIsGL3A14 bool\n"),
                ("\treturn Rules{", "\treturn Rules{\n\t\tIsGL3A14:         c.IsGL3A14(currentArbosVersion),"),
            ),
        ),
        "go-ethereum/core/vm/contracts.go": (
            "9c28e68e923a5077cfcd7896086320a9119d1b6f615c3fb60446e26da853ccbd",
            (
                ("func activePrecompiledContracts(", """var PrecompiledContractsGL3A14 = make(PrecompiledContracts)
var PrecompiledAddressesGL3A14 []common.Address

func activePrecompiledContracts("""),
                (elara + "PrecompiledContractsStartingFromArbOS60",
                 "\tcase rules.IsGL3A14:\n\t\treturn PrecompiledContractsGL3A14\n"
                 + elara + "PrecompiledContractsStartingFromArbOS60"),
                (elara + "PrecompiledAddressesStartingFromArbOS60",
                 "\tcase rules.IsGL3A14:\n\t\treturn PrecompiledAddressesGL3A14\n"
                 + elara + "PrecompiledAddressesStartingFromArbOS60"),
            ),
        ),
        "gethhook/geth-hook.go": (
            "8b7ce19efdb6c8cfc0ef8b00ba827520dd9a247bae65ab4cdda42fbb7111b92c",
            (
                (wrap, wrap + """
		if precompile.Precompile().ArbosVersion() == params.ArbosVersion_GL3A14 {
			if addr != params.GL3A14Address() {
				panic("unexpected GL3 A14 precompile address")
			}
			vm.PrecompiledContractsGL3A14[addr] = wrapped
			continue
		}"""),
                ("\t// process addresses for respective arbos version precompile maps", """	if _, ok := vm.PrecompiledContractsGL3A14[params.GL3A14Address()]; !ok {
		panic("missing GL3 A14 precompile")
	}
	if _, ok := vm.PrecompiledContractsStartingFromArbOS60[params.GL3A14Address()]; ok {
		panic("GL3 A14 precompile present in stock Elara table")
	}
	addPrecompiles(vm.PrecompiledContractsGL3A14, vm.PrecompiledContractsStartingFromArbOS60)
	addAddresses(&vm.PrecompiledAddressesGL3A14, vm.PrecompiledContractsGL3A14)

	// process addresses for respective arbos version precompile maps"""),
            ),
        ),
        "precompiles/precompile.go": (
            "e5000952f6e3b0be9a2d19d1febdda4aac8c3b46050c8adaac4100f3729c50c3",
            ((register, register + ".arbosVersion = params.ArbosVersion_GL3A14"),),
        ),
        "arbos/arbosState/arbosstate.go": (
            "d784755e8b24c799e374206f613f606f7a184d60df4040885ec2175dfd706faf",
            (
                (upgrade, upgrade + """

		case params.ArbosVersion_GL3A14:
			if firstTime || !chainConfig.IsGL3A14(nextArbosVersion) {
				return fmt.Errorf("GL3 A14 requires an existing GL3 chain in sealed mode: %w", ErrFatalNodeOutOfDate)
			}
			addr := params.GL3A14Address()
			if stateDB.GetCodeSize(addr) != 0 || stateDB.GetNonce(addr) != 0 {
				return fmt.Errorf("GL3 A14 address already contains code or a nonce: %w", ErrFatalNodeOutOfDate)
			}
			// The versioned marker loop installs A14 and preserves any balance at its address.
			// Engine seed data is installed separately before admitting any game."""),
            ),
        ),
    }


def replace_once(source, original, updated, filename):
    if source.count(original) != 1:
        raise ValueError(f"Unexpected activation source anchor in {filename}")
    return source.replace(original, updated, 1)


def sha256(source):
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def stage_activation(root, candidate_version):
    if candidate_version != 62:
        raise ValueError("This source candidate is only defined for the transition from pinned ArbOS 61 to 62")
    if not (root / "precompiles/ArbGhostChessSlicesGame.go").is_file():
        raise ValueError("Stage the game-coordinator overlay in a separate source copy first")

    staged = {}
    for filename, (expected_digest, edits) in source_edits(candidate_version).items():
        path = root / filename
        if path.resolve(strict=True) != path or not path.is_file():
            raise ValueError(f"Refusing to stage a shared or non-regular file in the Nitro copy: {filename}")
        current = path.read_bytes().decode("utf-8")
        if sha256(current) == expected_digest:
            updated = current
            for original, replacement in edits:
                updated = replace_once(updated, original, replacement, filename)
            staged[path] = updated
            continue

        # Accept re-staging only when undoing all candidate edits yields the exact pinned input.
        original_source = current
        for original, replacement in reversed(edits):
            original_source = replace_once(original_source, replacement, original, filename)
        if sha256(original_source) != expected_digest:
            raise ValueError(f"Nitro activation source differs from the pinned input: {filename}")

    # Validate every input before modifying any file in the isolated build tree.
    for path, updated in staged.items():
        path.write_bytes(updated.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nitro_tree", type=Path, help="Isolated Nitro copy with the A14 game overlay staged")
    parser.add_argument("--candidate-arbos-version", type=int, required=True)
    args = parser.parse_args()
    try:
        stage_activation(args.nitro_tree.resolve(strict=True), args.candidate_arbos_version)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
