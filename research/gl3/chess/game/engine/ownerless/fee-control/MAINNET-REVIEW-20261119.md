# GL3 fee-only mainnet review

**Unsigned. Signing is blocked until the sequencer handoff can preserve continuous writes.** The fee upgrade and price reset are pending. No production settings, balances or contracts changed during this review.

## Live preflight · 19 November 2026

| Check | Observed |
| --- | --- |
| GL3 chain | 4663001, ArbOS 62 |
| Public RPCs | Both served block 20,641, hash `0x3c7d7e8a0b00f92789f2791e428af93d7a4486c97c73d5b2383d8703a8058cc7` |
| Production sequencing | One active writer with the sequencer coordinator disabled. Two read followers forward writes to that writer. |
| Robinhood chain | 4663. The rollup still points to the ArbOS 62 proving root `0xa6d61281b9933ed55535fc12b6e62f77430b81f2d9d2b10b414ae972d5a5030d`. |
| Fee candidate | ArbOS 63. Built on the existing pod with isolated files and six matching private proof replays. [Build evidence](./build-evidence-20261119.json) |

The active writer opens the production databases exclusively. The previous database-sharing handoff had a six-second interval between writer exit and replacement readiness while both public RPCs served reads. An isolated follower build cannot take over as a coordinated writer on this configuration. A coordinated handoff needs an active writer already participating in coordination and a caught-up successor. [A14 handoff witness](../a14-corrected-handoff-20261119.json) · [Nitro planned maintenance](https://docs.arbitrum.io/launch-arbitrum-chain/run-a-node/high-availability-sequencer#planned-maintenance)

## Fee and Stockfish budget

| Item | Amount |
| --- | ---: |
| Posting price at block 20,641 | 0.219519310451393664 GH0ST per compressed byte |
| Proposed reset | **0.015 GH0ST per compressed byte** |
| Reduction from the observed price | 93.17% |
| Estimated posting charge for 7,113 chunks at the proposed rate | 3,050,045.55 GH0ST |
| Estimated posting and execution for the import | 3,687,045.55 GH0ST |
| Import plus the 1,000,000 GH0ST prize | 4,687,045.55 GH0ST |
| Treasury balance observed on GL3 | 5,563,244.57401027003327791 GH0ST |

The import model uses 203,336,370 GL3-priced compressed bytes and approximately 637,000 GH0ST of execution. The reset sets 937,500,000,000,000 wei of GH0ST per parent calldata gas unit. It compares against the old price before setting the new one, and subsequent batch reports can reprice it. Requote the import before starting and check the price during the upload. Robinhood's batch poster pays its ETH bill separately. [Nitro pricing update code](https://raw.githubusercontent.com/OffchainLabs/nitro/v3.12.2/arbos/l1pricing/l1pricing.go#L438-L481)

## Single review scope

This review covers activating the fee authority and resetting the posting price. Stockfish upload and prize funding require their own execution review.

1. Verify continuous writes through the candidate handoff and test both RPCs against the same canonical chain. Confirm the verifier serves both proving roots.
2. Use the existing Robinhood executor to register candidate proving root `0x51c5e0bcc151e3372771977386519abbd78a43d0796f7eeaa5ae931f77b41657`. Confirm the root on Robinhood and wait for a candidate-only validator checkpoint. Release promotion messages only when required to advance the checkpoint.
3. Queue the exact fee activation marker from the Robinhood executor through the Inbox. Before proceeding, verify ArbOS 63 and the fee precompile at `0x0000000000000000000000000000000000000a15` on both GL3 RPCs.
4. If still empty, fund the executor's GL3 alias with 20 GH0ST for the delayed fee call. Refresh the expected old price, release the authorized compare-and-set transaction, and confirm its fee event and resulting price on both RPCs.

| Proposed Robinhood action | Calldata Keccak-256 | Read-only gas estimate |
| --- | --- | ---: |
| Install candidate proving root | `0xa3dad407540e7974dc6713f2523266257a89035063387df277d5e9b04e21d5e0` | 61,742 |
| First promotion message | `0xf8b07b7898ff2e26b1a5680a40991478c4a88321f639bf3bdb950a9b4c6da19d` | 96,483 |
| Second promotion message | `0x67f97fd537eb0085d6ef5e2bd275e219aff4f1eff281ae16b7a96053c8e99fa3` | 96,507 |
| Optional third promotion message | `0x10e91f0d51f3ea531a2dfbd72deb1993bbaf0380330fbf1f6a321e11af094ebe` | 96,531 |
| Activate fee authority | `0xba917bba51b03fcaee2e60e5a5fc3492eed2fce6dd668f163e3bd5f8c8fb96da` | 124,251 |
| Set fee at the observed old price | `0x7f82d3a426c05259cb0b6bc06ea377c9f5180bdbfbae231d49255e0635b1d653` | 128,358 |

The read-only quote gives a provisional gas ceiling of 0.000030537887952 ETH for all listed Robinhood calls, with zero ETH call value. The conditional 20 GH0ST GL3 transfer carries a separate provisional gas ceiling of 93.3499 GH0ST at the pre-reset price. These are snapshot estimates. Refresh nonce, gas, balances and the exact expected old price before generating the signable review. The fee setter's calldata hash changes if the old price moves.
