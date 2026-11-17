# Actual Robinhood deployment and private-bootstrap packet

**All 27 reviewed deployment actions are mined.** The separately corrected read-only audit passed; public services and child fee setup were not started by this checker. This is the standard official Nitro operator-fast profile, with no ZK verification at launch.

| Observed item | Exact value |
|---|---|
| Parent / child | Robinhood `4663` / GL3 `4663001` |
| Rollup | `0xeE811A8ee20C03E684ECB5BFd6f7721f85451b01` |
| Inbox | `0xE4ce38967ED19B0177Ea52f2aA38cF817C1E2f89` |
| Bridge | `0x0639727cfb8EF45DCcabc2462fFC02010C71836A` |
| Outbox | `0xcfe660edf227C60cBC24361791ccc339E27092aE` |
| Sequencer inbox | `0xBaaF819a28CceC669168344632Aa4660427aB2fA` |
| Creation transaction | `0xadf4ffccdc68d51fa9c5c6e2480ca14cf9072dbae21e7e9127a70ee8b7d0abcb` |
| Creation block | `116780593` |
| Creation block hash | `0xeeb217cc0643eee6530af76437c6a9b2772f034f13461fded430408522f47597` |
| Actual 27-transaction gas fees | `0.001627693426576 ETH` |
| Genesis JSON SHA256 | `2b199bb88d307aac0f25bffb26154ec1a02b43541f7f0d1bf551b9980983c8dc` |

The fee sum is `gasUsed × effectiveGasPrice` across the 27 canonical receipts. It is inside the sponsored `0.005 ETH` deployment reserve. This table does not claim a completed refund or add that reserve a second time.

## The final-checker failure and correction

The financial runner mined all 27 actions, then its final audit rejected the result. [The frozen diagnostic](verify27-diagnostic-result.json) reproduces the exact failure: `getter_mismatch:RollupUserLogic.genesisAssertionHash`, after 225 read-only requests in 26.034s. No financial runner was restarted and no deployment was repeated.

Pinned Nitro contracts `4341b132cfbdcc980ead03765ca5224ff6cb5d97`, `RollupCore.sol:579–597`, explicitly document that `genesisAssertionHash()` computes the **empty** genesis convenience value. It differs from a chain initialized with supplied nonempty genesis. The approved financial source remains unchanged at SHA256 `90c74ddb6b7d5df9a8942a633ca15266d3e4dc8c45b4656eb90a671c9b5bb098`.

The separate [audit-only checker](verify-deployment-audit27.mjs), SHA256 `e30421790cf86e690aa9a41b63259e4182fda36c9ea4b6cde9da76ddfa98c511`, preserves the preceding transaction/runtime/immutable/proxy/authority checks. It binds the complete supplied genesis state to its actual event, `computeAssertionHash(0, state, 0)`, stored confirmed assertion/configuration, `latestConfirmed`, and the canonical creation-event lookup block. The [corrected full result](verify27-corrected-result.json) passed in 27.080s with 230 read-only requests. Its SHA256 is `150f9bd795903b2e0b03471774771f1e8f7fe7402d2c2611715e2da9fbcf4567`.

The actual supplied genesis assertion is `0x26d1dc5585f03d3f1436999ab4af3cbd40819b16bb843ec3aeb41b11da7147c3`. The empty convenience value is `0x75c2df1d9a6f98d1de62c8fc955f91b87f16fefa2fafe4d6b52118fc30e1c278`. Sixteen [regression cases](nonempty-genesis-test-result.json) passed on Runpod: actual binding, this distinction, and fourteen altered-state/hash/status/configuration/block rejections. This is an initial-deployment audit; its `latestConfirmed == genesis` requirement intentionally precedes service operation.

## Receipt-derived files

[packet.json](packet.json) binds [deployment-verified.json](deployment-verified.json), [funding-verified.json](funding-verified.json), [chain-info.json](chain-info.json), the unchanged [genesis.json](genesis.json), the [receipt-bound profile](production-profile.receipt-bound.json), and [render-spec.draft.json](render-spec.draft.json). The builder independently matched all 27 actual unsigned transaction hashes and canonical receipts, plus all four sponsor transactions and the exact GH0ST transfer event. The build passed in 17.694s. No private key, signer, transaction submission or service startup is part of that builder.

Funding receipt acceptance proves the exact canonical transactions and transfer event. Current balances/allowances are separately timestamped observations; historical before/after balance deltas or an unspent funding balance are not claimed. The exact bounded validator allowance remains a separate root-operated action; automatic allowance increase stays disabled.

The packet's cold nonce observation was `latest == pending == 6476` at `2026-11-17T18:22:05.501Z`. It is not reserved and must be refreshed immediately before any later signing.

The renderer still needs a root-selected private parent-URL file reference. Effective configuration and the external private-start approval must be hash-bound through the [paired adapter contract](../../node/ASSEMBLY.md). The packet contains no startup approval. After an infrastructure reset, the explicit host guard/runtime closure must be checked before service execution. Child backed funding, actual fee setup/renunciation, bridge acceptance and public routing remain separate activation gates.
