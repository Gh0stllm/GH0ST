#!/usr/bin/env python3
"""Stage the A14-only parent-inbox activation on a pinned isolated Nitro tree."""

import argparse
import hashlib
from pathlib import Path


HERE = Path(__file__).resolve().parent
OVERLAYS = {
    "gl3_a14_parent_authority.go": "go-ethereum/params/gl3_a14_parent_authority.go",
    "gl3_a14_parent_activation.go": "arbos/gl3_a14_parent_activation.go",
    "gl3_a14_parent_state.go": "arbos/arbosState/gl3_a14_parent_state.go",
    "gl3_a14_unconfirmed.go": "arbnode/gl3_a14_unconfirmed.go",
}

EDITS = {
    "arbos/block_processor.go": (
        "1a847ed646a64f8df933d44dcce75f7dd062890363927739395f077cd906ac34",
        (
            ("hooks, isMsgForPrefetch, runCtx, exposeMultiGas, nil,",
             "hooks, isMsgForPrefetch, runCtx, exposeMultiGas, nil, message.L2msg,"),
            ("\taddressChecker state.AddressChecker,\n) (*types.Block,",
             "\taddressChecker state.AddressChecker,\n\tl2Message []byte,\n) (*types.Block,"),
            (
                "\tstartTx := InternalTxStartBlock(chainConfig.ChainID, l1Header.L1BaseFee, l1BlockNum, header, lastBlockHeader)",
                """	startTx := InternalTxStartBlock(chainConfig.ChainID, l1Header.L1BaseFee, l1BlockNum, header, lastBlockHeader)
	if shouldActivateGL3A14FromInbox(arbState.ArbOSVersion(), chainConfig, l1Header, l2Message,
		lastBlockHeader.Nonce.Uint64(), delayedMessagesRead) {
		copy(startTx.Data[:4], gl3A14StartBlockMethodID[:])
	}""",
            ),
        ),
    ),
    "arbos/internal_tx.go": (
        "c48800495c1d4fa564c10948ea753b66be9ef47baf2c592064eb2ae01b96110a",
        (
            (
                "\tcase InternalTxStartBlockMethodID:",
                """	case InternalTxStartBlockMethodID, gl3A14StartBlockMethodID:
		a14Activation := selector == gl3A14StartBlockMethodID
		if a14Activation && (len(tx.Data) != 4+32*4 || evm.Context.Coinbase != params.GL3A14AuthorityAlias()) {
			return fmt.Errorf("invalid GL3 A14 internal start-block transaction")
		}""",
            ),
            (
                "\t\treturn state.UpgradeArbosVersionIfNecessary(currentTime, evm.StateDB, evm.ChainConfig())",
                """		if a14Activation {
			if err := state.ScheduleGL3A14FromParent(evm.ChainConfig(), currentTime); err != nil {
				return err
			}
		}

		return state.UpgradeArbosVersionIfNecessary(currentTime, evm.StateDB, evm.ChainConfig())""",
            ),
        ),
    ),
    "execution/gethexec/executionengine.go": (
        "0ab9f9907f47b31827e85811febccf5d4fad061d9a4caddfa1a1c8a30b8fd7ae",
        (
            ("\t\thooks,\n\t\tfalse,\n\t\tsession.runCtx,\n\t\ts.exposeMultiGas,\n\t\ts.addressChecker,\n",
             "\t\thooks,\n\t\tfalse,\n\t\tsession.runCtx,\n\t\ts.exposeMultiGas,\n\t\ts.addressChecker,\n\t\tnil,\n"),
            ("\t\t\tfilteringHooks,\n\t\t\tisMsgForPrefetch,\n\t\t\trunCtx,\n\t\t\ts.exposeMultiGas,\n\t\t\ts.addressChecker,\n",
             "\t\t\tfilteringHooks,\n\t\t\tisMsgForPrefetch,\n\t\t\trunCtx,\n\t\t\ts.exposeMultiGas,\n\t\t\ts.addressChecker,\n\t\t\tmsg.Message.L2msg,\n"),
        ),
    ),
    "arbos/arbosState/arbosstate.go": (
        # Digest after stage_activation.py installs the ArbOS 62 upgrade case.
        "07c379b3bafbc89ab35c53cbfc8ef6c2c084a070627aeb3a31af7639700206a8",
        (
            (
                "\t\t\taddr := params.GL3A14Address()",
                """			approved, err := state.gl3A14ParentApproved()
			if err != nil {
				return err
			}
			if !approved {
				return fmt.Errorf("GL3 A14 activation lacks parent-inbox authorization: %w", ErrFatalNodeOutOfDate)
			}
			addr := params.GL3A14Address()""",
            ),
        ),
    ),
    "arbnode/transaction_streamer.go": (
        "b8a19dd65b4245c241f185d4d8b3586e112b5e1ba1a3d1c076733dcde76da326",
        (
            (
                "\tbroadcastFirstMsgIdx, messages, err := parseBroadcastFeedMessages(feedMessages)\n\tif err != nil {\n\t\treturn err\n\t}",
                """	broadcastFirstMsgIdx, messages, err := parseBroadcastFeedMessages(feedMessages)
	if err != nil {
		return err
	}
	if err := s.rejectUnconfirmedGL3A14Authority(messages); err != nil {
		return err
	}""",
            ),
            (
                "batch ethdb.Batch) ([]*arbostypes.MessageWithMetadata, error) {\n\tvar confirmedReorg bool",
                """batch ethdb.Batch) ([]*arbostypes.MessageWithMetadata, error) {
	if !messagesAreConfirmed {
		if err := s.rejectUnconfirmedGL3A14Authority(messages); err != nil {
			return nil, err
		}
	}
	var confirmedReorg bool""",
            ),
        ),
    ),
}


def replace_once(text, original, replacement, name):
    if text.count(original) != 1:
        raise ValueError(f"Unexpected source anchor in {name}")
    return text.replace(original, replacement, 1)


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def in_tree(root, name):
    target = root / name
    if target.resolve() != target:
        raise ValueError(f"Refusing to write outside the isolated tree or through a symlink: {name}")
    return target


def stage(root):
    changes = {}
    for name, (expected, edits) in EDITS.items():
        path = in_tree(root, name)
        current = path.read_bytes().decode("utf-8")
        if digest(current) == expected:
            for original, replacement in edits:
                current = replace_once(current, original, replacement, name)
            changes[path] = current.encode("utf-8")
            continue
        for original, replacement in reversed(edits):
            current = replace_once(current, replacement, original, name)
        if digest(current) != expected:
            raise ValueError(f"Unexpected pinned input: {name}")

    for source, name in OVERLAYS.items():
        body = (HERE / source).read_bytes()
        path = in_tree(root, name)
        if path.exists() and path.read_bytes() != body:
            raise ValueError(f"Unexpected existing overlay: {name}")
        changes[path] = body

    for path, body in changes.items():
        path.write_bytes(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nitro_tree", type=Path, help="Isolated Nitro tree with ArbOS 62 already staged")
    args = parser.parse_args()
    try:
        stage(args.nitro_tree.resolve(strict=True))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
