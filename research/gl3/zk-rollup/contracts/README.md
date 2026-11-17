# State, data and proof coordinator

**R55 · Registry/codec units pass on Runpod. Complete canonical proof finalization remains untested.**

The coordinator compiles with Solidity 0.8.17/London to 15,032 runtime bytes. Its source pins the verifier/key, machine/profile, six-field genesis state and immutable factory. Atomic sealing checks fresh-clone attestation, exact implementation/runtime hashes and canonical bridge roles. Only `finalize` can publish an Outbox send root after verifying a 736-byte statement and real proof.

Compilation is not acceptance of these transitions: the actual factory/seal and genuine new guest proof must still exercise this coordinator. No production guest key has been selected.

## Measured registry regression

| Run | Grouped cases | Actual exit | Whole job | Kernel max RSS |
| --- | ---: | ---: | ---: | ---: |
| Initial looping draft | 23 | 0 | 42.944 s | 332,080 KiB |
| Selected prefix-endpoint registry | 25 | 0 | 55.781 s | 338,628 KiB |

The selected run executes 46 private parent transactions, including 17 mined rejections. Independent source, signed-transaction hash, receipt/status/gas and process-cleanup audit passes. The three statement-decoding rejection variants use read-only calls. [Final result](evidence/prefix-registry/result.json) · [Independent audit](evidence/prefix-registry/independent-audit.json) · [Actual exit](evidence/prefix-registry/actual-exit.json).

The registry authenticates delayed and sequencer wires, rejects changed payload/header/index/padding, rejects unsupported DA flags, separates domains and rejects missing data and noncontiguous registration. The codec rejects the old 160-byte EVM statement, trailing bytes and noncanonical uint64 padding.

The previous 256-record cap is removed. Contiguous registration builds authenticated prefix hashes, allowing parent verification to check only the endpoints. A 262-record range passes. The private getter's transaction-style gas estimate is 27,273 for two records and 27,285 for 262: the 12-gas difference is calldata encoding, not a loop over 260 extra records. These are getter estimates on private Geth, not full finalization receipts or Robinhood fees. Registration itself still pays for its per-record storage.

The tests use an explicitly synthetic accumulator fixture. They establish codec/registry behavior, not a canonical guest execution, native child credit, bridge payout or real state transition proof. A separate factory integration will connect the registry to the real canonical bridge graph.

The full evidence capsules contain frozen sources, compilation artifacts and raw receipts/transactions; round-trip checks ran on Runpod and compressed-byte hashes were checked after transfer. [Selected capsule](evidence/prefix-registry/evidence.tar.gz) · [Capsule hash](evidence/prefix-registry/capsule.json) · [Earlier draft capsule](evidence/initial-registry/capsule.json).

The first independent-audit attempt incorrectly expected at least 18 mined reverts. The frozen scripts actually contain 16 in the initial run and 17 in the selected run; codec-only cases do not mine. The count assertion was corrected without changing any contract, test input, transaction or outcome, and its prior source is preserved in the capsule.

## Remaining integration gates

1. Fresh factory → canonical graph → sealed coordinator, with actual inbox registration and real-verifier rejection checks.
2. Authenticated canonical guest execution producing the exact statement from observed state and data reads.
3. A genuine new guest proof that finalizes a state/send root, then a canonical withdrawal with exact accounting and replay rejection.
4. Explicit ZK bootstrap/genesis validation in the node/operator path. Stock Nitro's BoLD genesis check can skip this new coordinator ABI; that skip is not a validation pass.

[Statement and prefix codec](../STATEMENT.md) · [Source](GL3ZkCoordinator.sol) · [Native bridge](../bridge/NATIVE-INTERFACE.md).
