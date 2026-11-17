# Native GH0ST bridge · selected architecture

**Selected design, tests not yet accepted.** GL3 will prove the canonical Nitro portable WAVM/STF, preserving native GH0ST gas and the actual ERC20Bridge/ERC20Inbox/ERC20Outbox semantics. The [ethrex wrapped-token proposal](INTERFACE-PROPOSAL.md) is an unselected reference. No bridge root may be accepted merely because an administrator supplied it.

## Parent contract graph

Pinned upstream contracts: `4341b132cfbdcc980ead03765ca5224ff6cb5d97`. Their BUSL-1.1 notices remain intact; licensing remains a launch gate separate from technical tests.

| Component | Initialization / authorization |
| --- | --- |
| Minimal versioned `GL3ExactERC20Bridge` | `initialize(IOwnable coordinator, address nativeGH0ST)`; native GH0ST token/decimals remain canonical. |
| Canonical `ERC20Inbox` | `initialize(bridge, sequencerInbox)`; approved delayed Inbox; pulls parent GH0ST and queues canonical native-credit messages. |
| Canonical `SequencerInbox` | `initialize(bridge, timeVariation, bufferConfig, feeTokenPricer)` with reviewed constructor immutables and exact posting/force-inclusion policy. |
| Canonical `ERC20Outbox` | `initialize(bridge)` caches coordinator as `rollup`; only that coordinator can call `updateSendRoot(root, blockHash)`. |
| New ZK coordinator | Proof-checks the complete committed execution envelope, advances its state head atomically, then calls `outbox.updateSendRoot(post.sendRoot, post.blockHash)`. No generic forwarder or administrator root setter. |

Native GH0ST is **not replaced by a separately minted wrapped fee token**. Production genesis must contain zero unbacked native allocations: any initial native allocation needs exact parent escrow backing, or must instead enter through the real delayed deposit queue.

## Fresh immutable deployment and sealing

Use an immutable factory to create and initialize fresh component clones and seal the entire graph in the same transaction. Coordinator `owner()` returns that factory only before sealing and zero afterward. During bootstrap the factory configures the canonical Bridge/Inbox/SequencerInbox roles directly; a coordinator internal call cannot impersonate its owner for `SequencerInbox.onlyRollupOwner`.

`seal(bridge, sequencerInbox, inbox, outbox)` should verify at least:

- The caller is the immutable bootstrap factory and the graph is attested as **freshly created for this coordinator** by that factory; seal is one-use.
- Every clone's exact 45-byte EIP-1167 runtime points to the reviewed immutable implementation, whose actual runtime code hash and constructor configuration are pinned.
- Bridge `rollup`, Inbox `bridge`/`sequencerInbox`, SequencerInbox `bridge`/`rollup`, and Outbox `bridge`/`rollup` all match the graph.
- The only allowed Outbox is this canonical Outbox. The allowed delayed Inbox list is the reviewed list; disable a temporary RollupEventInbox after its required genesis initialization message if applicable.
- No proxy-admin upgrade route is installed. Freeze owner/admin/root-setting paths, expected posting roles and batch-poster manager policy. A zero owner without a generic coordinator forwarding method blocks the canonical administrative entry points.
- Native token, decimals, maximum data size, chain domain, genesis/global state, fixed machine/profile and data registry are the reviewed identities.

Checking code and current role getters alone does **not** establish freshness. An old canonical Outbox could contain roots from an earlier fake rollup, then be reattached before seal. Fresh atomic factory creation is required; the coordinator must not seal arbitrary reused components. Batch-poster mappings are not enumerable, so a getter check alone also cannot prove that no extra poster was previously authorized.

Canonical EIP-1167 runtime:

```
363d3d373d3d3d363d73 || implementation20 || 5af43d82803e903d91602b57fd5bf3
```

## Exact published data commitments

Source: upstream `src/bridge/Messages.sol`, `AbsBridge.sol:106–193`, `SequencerInbox.sol:567–646,718–750`; guest serialization is Nitro `arbos/arbostypes/incomingmessage.go:106` and `arbstate/inbox.go:82`.

For delayed message `i`, the parent contract hashes:

```
messageHash = keccak256(kind1 || sender20 || blockNumberBE8 || timestampBE8 ||
                        indexBE32 || baseFeeBE32 || keccak256(rawData)32)
delayedAcc[i] = keccak256(previousDelayedAcc32 || messageHash32)
```

Previous accumulator is zero at index zero. The guest's delayed-message wire format differs: its sender is **left-padded to 32 bytes**, so it is a **113-byte header plus raw data**. Do not directly hash that wire format as the parent message hash.

```
guestDelayed = kind1 || senderLeftPadded32 || blockNumberBE8 || timestampBE8 ||
               indexBE32 || baseFeeBE32 || rawData
```

The sequencer header is exactly forty bytes, five big-endian `uint64` fields:

```
header = minTimestamp8 || maxTimestamp8 || minBlockNumber8 ||
         maxBlockNumber8 || afterDelayedMessagesRead8
fullDataHash = keccak256(header || calldataPayload)
seqAcc[i] = keccak256(previousSeqAcc32 || fullDataHash32 || delayedAcc32)
```

Here delayed accumulator is zero if the read count is zero, otherwise `bridge.delayedInboxAccs(afterDelayedMessagesRead - 1)`. Forced inclusion has **empty payload** and hashes only the forty-byte header. Its accumulator equation is identical. The registration functions must compare recomputed values to the actual canonical Bridge getters at the claimed index; caller-supplied accumulator values are not authority.

The first supported data profile is empty/force-inclusion or direct calldata Brotli (`0x00`). Reject DAS (`0x80`/`0x88`), blob (`0x50`), custom DA (`0x01`) and zero-heavy (`0x20`) until those formats have separately reviewed guest/data availability support. The full forty-byte header plus payload must obey the pinned maximum data size. Publishing only a hash without the actual authenticated bytes is insufficient.

## Canonical withdrawal claim

Preserve the actual ordered Outbox proof, not the sorted-pair ethrex proof:

```
item = keccak256(l2Sender20 || recipient20 || l2BlockBE32 || l1BlockBE32 ||
                 timestampBE32 || nativeValueBE32 || calldata)
leaf = keccak256(item32)
```

At proof level `j`, index bit `j` determines left/right order. The canonical Outbox checks proof length below 256, minimal path, a previously proof-finalized root and a global spent bitmap with 255 usable bits per word. It marks the output spent before the Bridge call and restores its context around nested calls. Transfer/call failure reverts the spent bit and state atomically.

Native value is normalized to eighteen decimals in the child; `ERC20Outbox` converts it to the native token's cached parent decimals before release. The proof-bound send root and block hash are the only root-publication authority. The new execution codec must bind all **four bytes32 and both uint64** fields in the actual selected portable machine GlobalState, including the MEL fields; a legacy two-field projection is insufficient.

## Minimal exact-transfer profile

Upstream ERC20Bridge assumes a non-rebasing token with no transfer fee/callback and does not verify received amount. Its concrete internal overrides are not virtual, so the smallest explicit profile is the [versioned source copy](contracts/GL3ExactERC20Bridge.sol) adding only per-transfer balance checks.

Incoming funding requires the Inbox debit and Bridge credit to equal the requested amount. Outgoing transfer checks the Bridge debit and recipient credit immediately around `safeTransfer`, **before** the canonical arbitrary recipient call. This preserves canonical callback/context logic; it does not add a global lock that would silently change nested Outbox semantics. Canonical self-directed escrow donations must not burn tokens. No extra storage fields or external function/event selectors are introduced; the new custom error is additive.

The bounded private units use a synthetic token to test exact accounting, faulty-transfer rollback, fresh clone/role configuration, root rejection and actual parent accumulators. They do not mint child native currency, publish a fake positive root or claim an end-to-end ZK withdrawal. A separate call-only unit fixture may exercise internal payout delta checks, explicitly without masquerading as a canonical proof claim.

The remaining end-to-end gate requires actual registered parent deposit data, canonical native credit and burn, a real matching SP1/WAVM proof, coordinator finalization of that proof's send root/block hash, canonical Outbox membership, one exact parent payout and repeat/invalid-root rejection with full asset accounting.
