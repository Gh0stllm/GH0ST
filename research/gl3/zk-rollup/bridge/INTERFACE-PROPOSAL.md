# Ethrex bridge reference · not selected

**NOT SELECTED.** Preserved research reference only. GL3's selected architecture instead proves the canonical Nitro portable WAVM/STF and preserves GH0ST as the native gas asset through ERC20Bridge/ERC20Inbox/ERC20Outbox. The wrapped-token design below was not implemented or accepted.

The original proposal used the pinned ethrex L2 transaction/message machinery. The existing five-field, 160-byte L1 proof does not authenticate deposits or withdrawals and cannot be promoted by appending host-supplied bridge fields.

## Source boundary

Pinned ethrex revision: `890efb6bf5dcc09b650cf105b8444d3793dffdf0`, as locked by replay `d6687b13f06f39510cf71abafe0e6a5fe2ab3c80`. Ethrex is MIT OR Apache-2.0; the inspected Solidity bridge/messenger files carry MIT notices.

| Existing source | Relevant behavior |
| --- | --- |
| `crates/guest-program/src/l2/program.rs:39` | Executes blocks with `Evm::new_for_l2`; message digests come from those blocks and resulting receipts. |
| `crates/guest-program/src/l2/messages.rs:31` | Extracts actually included privileged transactions and actual L1 message receipts. |
| `crates/guest-program/src/l2/output.rs:7` | Commits initial/final state, withdrawal root, deposit digest, blob hash, last block, chain/count and cross-L2 outputs. |
| `crates/common/types/transaction.rs:1552` | Defines the canonical privileged deposit hash. |
| `crates/l2/common/src/privileged_transactions.rs:71` | Defines count-prefixed ordered deposit digest. |
| `crates/l2/contracts/src/l2/CommonBridgeL2.sol:21` | Privileged mint entry points require `msg.sender == address(this)`. |
| `crates/l2/contracts/src/l2/CommonBridgeL2.sol:85` | Burns the caller's wrapped tokens before emitting a withdrawal message. |
| `crates/l2/contracts/src/l2/Messenger.sol:14` | Only the fixed system bridge can emit recognized withdrawal messages. |
| `crates/l2/common/src/messages.rs:62` | Defines the leaf from the fixed bridge, data hash and message ID. |
| `crates/l2/common/src/merkle_tree.rs:31` | Sorted-pair Keccak Merkle tree, matching OpenZeppelin-style verification. |

Upstream `CommonBridge.depositERC20` accounts the requested amount before `safeTransferFrom` and does not check its received balance delta. Our fixed-token escrow must reject fee-on-transfer, rebasing or otherwise mismatched transfers rather than minting an unbacked amount.

## Proposed assets and authority

Parent: the immutable GH0ST ERC20 address. Child: one immutable wrapped-GH0ST ERC20, initially zero supply, whose only cross-chain mint/burn caller is the fixed L2 system bridge at `0x000000000000000000000000000000000000ffff`. The recognized messenger is `0x000000000000000000000000000000000000fffe`. Exact genesis code hashes, token pair and bridge roles must be included in the reviewed genesis/program identity.

This is **ERC20 wrapping**, not authority to mint a native currency. Native gas or fee-token registration is a separate proven chain configuration; the bridge must not silently repurpose ETH deposits or grant a sequencer generic mint authority.

The escrow has no owner-drain function and no unproved root publisher. A proof-finalized coordinator is its only source of withdrawal roots and deposit-consumption progress. Bootstrap must bind the exact coordinator once, before accepting deposits, or use reviewed predicted deployment addresses.

## Parent deposit queue

1. Reject zero amount and zero recipient. Pull the fixed parent token under a reentrancy guard; require the escrow's received balance delta to equal the requested amount exactly.
2. Increase accounted locked tokens only after that check. Unsolicited token transfers are surplus, not credits or authority to mint.
3. Append the next monotonic `uint64` deposit ID and emit all data needed to reconstruct the privileged transaction. No caller selects token addresses, privileged sender, target, gas policy or arbitrary calldata.
4. The canonical privileged transaction is chain ID = configured child; `from = to = fixed system bridge`; nonce = deposit ID; native value = zero; fixed reviewed gas limit; calldata = `mintERC20(parentToken, wrappedToken, recipient, amount)`; zero fee fields and empty access list.

Upstream transaction hash:

```
keccak256(childChainId32 || from20 || to20 || depositId32 ||
          nativeValue32 || gasLimit32 || keccak256(calldata))
```

Upstream digest is zero for no deposits, otherwise `count16be || keccak256(concat(transactionHashes))[2:32]`. The parent and guest must agree on the exact next queue prefix, order and count. The proposed per-batch bound is the pinned upstream budget of 300; no unchecked count truncation is permitted.

The guest must derive the digest from **actual executed privileged transactions**, not a host-provided list. It must also enforce omitted canonical fields (fee values/access list), reject foreign-chain privileged transactions and reject unsupported cross-L2 message/balance-diff outputs. The coordinator atomically verifies the proof, verifies the next queued prefix and advances the consumed cursor with the finalized state head. Replayed, skipped, reordered or changed deposits must fail.

## Withdrawal commitment and claim

L2 withdrawal burns wrapped GH0ST belonging to the caller, then atomically calls the fixed messenger. The guest derives the batch root from actual successful execution receipts at that messenger. Merely accepting a supplied list or root is insufficient.

Upstream message encoding:

```
dataHash = keccak256(parentToken20 || wrappedToken20 || recipient20 || amount32)
leaf     = keccak256(fixedSystemBridge20 || dataHash32 || messageId32)
```

The coordinator exposes a root only after proof finalization. A proposed view is `finalizedWithdrawalRoot(uint64 batchId) -> (bool finalized, bytes32 root)`. The escrow verifies the exact token pair, recipient, amount, message ID and sorted-pair proof against that root. The caller may relay a claim, but can never redirect the recipient.

Use a bridge/domain-scoped global message-ID nullifier, since the authenticated messenger's counter is global and part of the state. This prevents the same withdrawal being claimed through another finalized batch. Mark it before external token transfer; require both escrow debit and recipient credit to equal the amount exactly. Any failure reverts the nullifier and accounting atomically. No transfer/reentrancy failure becomes a successful payout.

## Required coordinator/guest envelope

The reviewed program/public codec must bind parent chain, child chain, coordinator, escrow, token pair, genesis/program identity, initial/final state head, ordered data commitment, deposit consumed start/count/digest and withdrawal root. Batch sequence and previous finalized head must prevent proof replay or forks. Cross-domain replay must fail even if two deployments accidentally reuse a chain ID.

This proposal does not select the coordinator's final binary codec. Root owns that codec and must agree before bridge integration.

## Acceptance sequence

First run bounded isolated contract tests for deposit accounting, queue/hash agreement, exact transfer behavior, nullifier/reentrancy and domain/replay rejection. A fixture coordinator in those tests is explicitly not a completed proof flow.

Then run a genuine L2 execution fixture: deposit 100, execute privileged mint 100, transfer 20, burn/withdraw 10, prove the actual transition and message root, reject an unfinalized claim, finalize the matching proof and release exactly 10 on the parent. Required final accounting: escrow 90 equals wrapped supply 90; claimed 10 plus locked 90 equals deposited 100. Replay, forged recipient/amount/token/root/domain, duplicated deposit consumption, unbacked mint and repeated claim must all fail. Parent and child receipts plus final balances are required.

A matching real guest proof, canonical parent data availability and end-to-end accounting remain gates. Forced inclusion/censorship recovery, durable operation and external security review remain separate from these isolated bridge tests. No timeout refund may release tokens outside proven state: a deposit may already have executed a mint before its proof is finalized.
