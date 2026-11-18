# A14 activation through the Robinhood inbox

GL3 retains the literal renounced ArbOwner list `[0x0]`. The candidate
adds one consensus transition from ArbOS 61 to 62. It accepts a fixed
activation message only on sealed GL3, chain ID 4663001. The authorized
sender is the existing receipt-bound Robinhood UpgradeExecutor
`0xA632B4c45726C779086F60d8b09BEE7b09bA2541`.

## Build integration

Use the pinned, isolated Nitro source tree after staging the ordinary A14
ArbOS 62 overlay. Run `stage_parent_activation.py NITRO_TREE` before
building both the native node and Wasm replay from the same tree. The
script checks the full hashes of the files it changes and keeps all
other upgrade versions on their existing paths.

The build entry point stages activation and the restricted bootstrap
together. Each build uses a fresh variant directory.

```sh
python3 research/gl3/chess/build_replay.py --sliced --game-coordinator --candidate-arbos-version 62 --parent-authorized-a14
```

The revised native binary and matching proof machine were assembled
on the existing GL3 pod. Their checksums matched after copying to
persistent storage. The candidate module root is
`0xa3ae4f567770561a740f7658044d3cee6cf778726b18f49132d9a1264fa4174e`.
[Build and initial history comparison](parent-authorized-build-20261118.json)

The revised follower matched production at GL3 safe block **20,628**.
On a separate private chain, the canonical delayed message activated
A14 and an unrelated parent sender's copy of the payload did not.
The child owner remained zero. The revised machine reproduced the block
hash, send root and inbox position on both sides of the upgrade.
[Activation and replay evidence](parent-activation-evidence-20261118.json)

Both block production and replay require delayed request ID and the
prior and next header nonce to identify one newly consumed delayed
message. Regular sequencer messages have a fixed batch-poster sender
and no delayed request ID. Websocket feed, archived feed backfill and
Redis catch-up reject messages carrying the reserved authority alias.
The canonical inbox supplies those messages to the prover and to nodes
reading Robinhood. The ArbOS 62 branch requires the internal approval
marker before installing A14.

## Exact parent call

The executor role submits `UpgradeExecutor.executeCall(address,bytes)`
with the GL3 ERC20Inbox
`0xE4ce38967ED19B0177Ea52f2aA38cF817C1E2f89` and the ABI-encoded call
to `sendL2Message(bytes)`. The only permitted activation payload is

```text
0x03000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103000000000000000103
```

This is a valid batch of seven empty nested batches. The stock
transaction parser produces zero user transactions. The ERC20Inbox
applies the standard L1 alias to the executor, producing delayed
sender `0xb743b4c45726c779086f60d8b09bee7b09ba3652`. Only the new
block processor recognizes that exact message and schedules the built-in
start-block upgrade. After version 62, the token is again an empty batch.

The parent governance transaction is separate from the local build.
Review the candidate proof root and demonstrate a coordinated handoff
before authorizing the parent call. A preexisting pending upgrade
above version 61 or any change to the renounced owner list blocks
this transition.

## Restricted bootstrap

After activation, the same parent executor can nominate a single L3
seed installer through a canonical delayed contract transaction. That
account can submit only the pinned Merkle-checked seed chunks. It
receives no ArbOwner authority.

The parent executor can register one deployed coordinator after the
seed completes. A14 verifies the top-level delayed contract transaction,
its aliased origin and caller, and the canonical parent message poster.
The application continues to use the exact Stockfish image and 24M-node
search policy. The precompile leaves the global chain owner list intact.
