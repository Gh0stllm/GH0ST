#!/usr/bin/env python3
"""Stage the GL3 posting-fee upgrade in a copy of the pinned A14 source."""

import argparse
import hashlib
import os
from pathlib import Path
from tempfile import NamedTemporaryFile


OVERLAYS = {
    "gl3_fee_parent_authority.go": "go-ethereum/params/gl3_fee_parent_authority.go",
    "gl3_fee_parent_activation.go": "arbos/gl3_fee_parent_activation.go",
    "gl3_fee_parent_state.go": "arbos/arbosState/gl3_fee_parent_state.go",
    "ArbGL3PostingFees.go": "precompiles/ArbGL3PostingFees.go",
}

# These pin the post-A14 files produced by the tracked preparation scripts
# from Nitro v3.12.2 and go-ethereum 30456d24d3cff444d3b0f246e9c7609477c7d4a1.
A14_SOURCE_HASHES = {
    "go-ethereum/params/config_arbitrum.go": "aaa50ae39f1e9e53fb2f0efaa6fc152e01a065ad011b66aafaa36f11275f025c",
    "go-ethereum/params/config.go": "c3456d351e553e90341c07ab8f07c91b8a995ec52345630fe9c6c0952bc33e11",
    "go-ethereum/core/vm/contracts.go": "837dde70cf5e263d382be2f45a67fcf17a974bb35bbc653fe39b6c7b6a71ed82",
    "gethhook/geth-hook.go": "b67a8b1481fe3e5ede3f383279915e7d12dae0c5b55f7dc72fdd3e4c876a150b",
    "precompiles/precompile.go": "687b619192365da717be7168b53a6f001c7fad42b4bab5b2ccb39db6d451bcce",
    "arbos/arbosState/arbosstate.go": "6c2856f02b3a08881d89bc0e8be63a4d1bd4d57ef466b0e912ce364445143ec5",
    "arbos/internal_tx.go": "11754dd67722fe5226d98643bc956ef0cdb885bd6e269ce925ddf08febf7bfb5",
    "arbos/block_processor.go": "f3ab1517c6caf2b34c8f75ca3a15c38b2b61bc4e3d151ba0449a403a114cdc34",
    "arbnode/transaction_streamer.go": "4b8bc071ec0627dc1a46fc8e7abee9c5a6f55d8703616f89b8ec1fef92f7b170",
}

EDITS = {
    "go-ethereum/params/config_arbitrum.go": (
        (
            "const MaxArbosVersionSupported = ArbosVersion_GL3A14",
            """const ArbosVersion_GL3PostingFees = uint64(63)
const MaxArbosVersionSupported = ArbosVersion_GL3PostingFees""",
        ),
        (
            "\t\tarbosVersion == ArbosVersion_GL3A14\n}",
            """		(arbosVersion == ArbosVersion_GL3A14 || arbosVersion == ArbosVersion_GL3PostingFees)
}

func (c *ChainConfig) IsGL3PostingFees(arbosVersion uint64) bool {
	return arbosVersion == ArbosVersion_GL3PostingFees && c.IsGL3A14(arbosVersion)
}""",
        ),
    ),
    "go-ethereum/params/config.go": (
        (
            "type Rules struct {\n\tIsGL3A14 bool",
            "type Rules struct {\n\tIsGL3A14 bool\n\tIsGL3PostingFees bool",
        ),
        (
            "\t\tIsGL3A14:         c.IsGL3A14(currentArbosVersion),",
            "\t\tIsGL3A14:         c.IsGL3A14(currentArbosVersion),\n"
            "\t\tIsGL3PostingFees: c.IsGL3PostingFees(currentArbosVersion),",
        ),
    ),
    "go-ethereum/core/vm/contracts.go": (
        (
            "var PrecompiledAddressesGL3A14 []common.Address",
            """var PrecompiledAddressesGL3A14 []common.Address

var PrecompiledContractsGL3PostingFees = make(PrecompiledContracts)
var PrecompiledAddressesGL3PostingFees []common.Address""",
        ),
        (
            "\tcase rules.IsGL3A14:\n\t\treturn PrecompiledContractsGL3A14",
            """	case rules.IsGL3PostingFees:
		return PrecompiledContractsGL3PostingFees
	case rules.IsGL3A14:
		return PrecompiledContractsGL3A14""",
        ),
        (
            "\tcase rules.IsGL3A14:\n\t\treturn PrecompiledAddressesGL3A14",
            """	case rules.IsGL3PostingFees:
		return PrecompiledAddressesGL3PostingFees
	case rules.IsGL3A14:
		return PrecompiledAddressesGL3A14""",
        ),
    ),
    "gethhook/geth-hook.go": (
        (
            "\t\tvar wrapped vm.AdvancedPrecompile = ArbosPrecompileWrapper{precompile}",
            """		var wrapped vm.AdvancedPrecompile = ArbosPrecompileWrapper{precompile}
		if precompile.Precompile().ArbosVersion() == params.ArbosVersion_GL3PostingFees {
			if addr != params.GL3PostingFeesAddress() {
				panic("unexpected GL3 posting fee precompile address")
			}
			vm.PrecompiledContractsGL3PostingFees[addr] = wrapped
			continue
		}""",
        ),
        (
            "\taddAddresses(&vm.PrecompiledAddressesGL3A14, vm.PrecompiledContractsGL3A14)",
            """	addAddresses(&vm.PrecompiledAddressesGL3A14, vm.PrecompiledContractsGL3A14)

	if _, ok := vm.PrecompiledContractsGL3PostingFees[params.GL3PostingFeesAddress()]; !ok {
		panic("missing GL3 posting fee precompile")
	}
	if _, ok := vm.PrecompiledContractsGL3A14[params.GL3PostingFeesAddress()]; ok {
		panic("GL3 posting fee precompile present before activation")
	}
	addPrecompiles(vm.PrecompiledContractsGL3PostingFees, vm.PrecompiledContractsGL3A14)
	addAddresses(&vm.PrecompiledAddressesGL3PostingFees, vm.PrecompiledContractsGL3PostingFees)""",
        ),
    ),
    "precompiles/precompile.go": (
        (
            "\tinsert(makeGhostChessSlicesPrecompile()).arbosVersion = params.ArbosVersion_GL3A14",
            "\tinsert(makeGhostChessSlicesPrecompile()).arbosVersion = params.ArbosVersion_GL3A14\n"
            "\tinsert(makeGL3PostingFeesPrecompile())",
        ),
    ),
    "arbos/arbosState/arbosstate.go": (
        (
            "\t\t\t// Engine seed data is installed separately before admitting any game.",
            """			// Engine seed data is installed separately before admitting any game.

		case params.ArbosVersion_GL3PostingFees:
			if firstTime || state.arbosVersion != params.ArbosVersion_GL3A14 || !chainConfig.IsGL3PostingFees(nextArbosVersion) {
				return fmt.Errorf("GL3 posting fees require an existing sealed ArbOS 62 GL3 chain: %w", ErrFatalNodeOutOfDate)
			}
			approved, err := state.gl3PostingFeesParentApproved()
			if err != nil {
				return err
			}
			if !approved {
				return fmt.Errorf("GL3 posting fees lack parent-inbox authorization: %w", ErrFatalNodeOutOfDate)
			}
			addr := params.GL3PostingFeesAddress()
			if stateDB.GetCodeSize(addr) != 0 || stateDB.GetNonce(addr) != 0 {
				return fmt.Errorf("GL3 posting fee address already contains code or a nonce: %w", ErrFatalNodeOutOfDate)
			}
			// The versioned marker loop installs the new precompile. A14 and pricing state are retained.""",
        ),
    ),
    "arbos/internal_tx.go": (
        (
            "\tcase InternalTxStartBlockMethodID, gl3A14StartBlockMethodID:",
            "\tcase InternalTxStartBlockMethodID, gl3A14StartBlockMethodID, gl3PostingFeesStartBlockMethodID:",
        ),
        (
            '\t\t\treturn fmt.Errorf("invalid GL3 A14 internal start-block transaction")\n\t\t}',
            """			return fmt.Errorf("invalid GL3 A14 internal start-block transaction")
		}
		postingFeesActivation := selector == gl3PostingFeesStartBlockMethodID
		if postingFeesActivation && (len(tx.Data) != 4+32*4 || evm.Context.Coinbase != params.GL3PostingFeesAuthorityAlias()) {
			return fmt.Errorf("invalid GL3 posting fee internal start-block transaction")
		}""",
        ),
        (
            "\t\treturn state.UpgradeArbosVersionIfNecessary(currentTime, evm.StateDB, evm.ChainConfig())",
            """		if postingFeesActivation {
			if err := state.ScheduleGL3PostingFeesFromParent(evm.ChainConfig(), currentTime); err != nil {
				return err
			}
		}

		return state.UpgradeArbosVersionIfNecessary(currentTime, evm.StateDB, evm.ChainConfig())""",
        ),
    ),
    "arbos/block_processor.go": (
        (
            "\t\tcopy(startTx.Data[:4], gl3A14StartBlockMethodID[:])\n\t}",
            """		copy(startTx.Data[:4], gl3A14StartBlockMethodID[:])
	} else if shouldActivateGL3PostingFeesFromInbox(arbState.ArbOSVersion(), chainConfig, l1Header, l2Message,
		lastBlockHeader.Nonce.Uint64(), delayedMessagesRead) {
		copy(startTx.Data[:4], gl3PostingFeesStartBlockMethodID[:])
	}""",
        ),
    ),
}


def replace_once(source, original, updated, name):
    if source.count(original) != 1:
        raise ValueError(f"Unexpected source anchor in {name}")
    return source.replace(original, updated, 1)


def child_path(root, name):
    path = root / name
    if path.resolve() != path or path.is_symlink() or not path.parent.is_dir():
        raise ValueError(f"Refusing shared or invalid source path: {name}")
    return path


def replace_atomically(path, body):
    # Use a new inode even when the isolated tree was copied using hard links.
    with NamedTemporaryFile(dir=path.parent, delete=False) as staged:
        temporary = Path(staged.name)
        try:
            staged.write(body)
            staged.close()
            temporary.chmod(path.stat().st_mode & 0o777 if path.exists() else 0o644)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def stage(root):
    changes = {}
    for name, expected in A14_SOURCE_HASHES.items():
        path = child_path(root, name)
        if not path.is_file():
            raise ValueError(f"Missing pinned A14 source: {name}")
        current = path.read_bytes().decode("utf-8")
        edits = EDITS.get(name, ())
        if hashlib.sha256(current.encode()).hexdigest() == expected:
            for original, updated in edits:
                current = replace_once(current, original, updated, name)
            if edits:
                changes[path] = current.encode("utf-8")
            continue

        # A repeat is allowed only when the exact edits undo to the pinned source.
        for original, updated in reversed(edits):
            current = replace_once(current, updated, original, name)
        if hashlib.sha256(current.encode()).hexdigest() != expected:
            raise ValueError(f"Unexpected A14 source hash: {name}")

    here = Path(__file__).resolve().parent / "fee-control"
    for source, name in OVERLAYS.items():
        body = (here / source).read_bytes()
        path = child_path(root, name)
        if path.exists() and (not path.is_file() or path.read_bytes() != body):
            raise ValueError(f"Conflicting fee-control source: {name}")
        if not path.exists():
            changes[path] = body

    for path, body in changes.items():
        replace_atomically(path, body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nitro_tree", type=Path, help="Isolated Nitro source prepared with the live A14 overlays")
    args = parser.parse_args()
    try:
        stage(args.nitro_tree.resolve(strict=True))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
