# GL3 · full private dispute passed

**The standard private BoLD lifecycle passes with actual exit 0 in 235.945 seconds.** The honest validator wins a genuine one-step proof, its exact assertion is confirmed, its nonzero ERC20 edge stake is refunded, and a second refund attempt is mined and reverted without changing the token balance. This runs on Runpod with official Nitro 3.12.2 and the standard `c10` machine, without chess or model execution.

[Full result](evidence/r44/full-lifecycle-report.json) · [actual process exit](evidence/r44/test-result.json) · [independent post-run audit](evidence/r44/post-run-audit.json) · [second result review](evidence/r44/base-dispute-final-result-review.json) · [complete evidence capsule](evidence/r44/base-full-dispute-evidence.tar.gz)

| Acceptance check | Actual result |
| :--- | :--- |
| Bridge and proof implementation | Real bridge and real one-step prover |
| Validator access | Whitelist disabled; fast confirmer is zero |
| Official transition | ArbOS 61, debug disabled, official `c10` module root |
| Exact proof ancestry | Actual OSP leaf → onchain child DAG → unique honest layer-zero roots → exact parent ClaimIds |
| Contested result | Honest assertion confirmed; its rival remains unconfirmed |
| Refund | Raw private ERC20 balance **1,984 → 1,989**, exactly **5 raw units** |
| Refund replay | Mined status **0**; token balance unchanged |
| Run / cleanup | **0 / 235.945 s**; no guard failure and zero active owned processes |

The stake amount is in raw units of the private fixture ERC20. It is not a public GH0ST payout, five ETH or five whole GH0ST tokens. The final report records the exact private OSP, assertion, edge, refund and replay transaction identities.

## What this accepts

The selected test uses a private upstream Geth parent and standard ETH child. Parent mining is 300 ms and test confirmation polling is one second. The source retains the real challenge managers and contract proof path through confirmation/refund, with no fast-confirm shortcut. These private timing settings are not proposed public finality periods.

The final ancestry check follows actual `LowerChildId` / `UpperChildId` links within each level, then the layer-zero root's exact `ClaimId` to its parent edge. It checks level, origin and recomputed mutual IDs, rejecting missing, ambiguous or cyclic ancestry. Intermediate length-one rivals may legitimately remain pending; the actual contested root and exact honest assertion must be confirmed. The refund requires an exact balance difference, matching `EdgeRefunded` event and a reverted replay receipt.

The [frozen source](gl3_base_bold_full_test.go) has SHA256 `4dfbfaa0f89240445db1f2d29087edd981d7f1d29777ed6e27f975d0c00b2a4d`. The actual test ELF is `66972a0b7151bbed7e7bcb6dd51960c018f51283cfbf01d6e9998fce6a01da63`, **194,033,832 bytes**, compiled with exit 0 in **20.05 seconds**. The [bounded controller](run-base-bold.py), official machine, native library, source inputs and binary received independent hash review before the run. Go race execution is not claimed: upstream selects this real challenge suite with `challengetest && !race`.

## Preserved setup and harness failures

| Attempt | Recorded outcome |
| :--- | :--- |
| Missing external Geth path | Exit 1 in 1.025 s, before private chain startup |
| Available Geth 1.17.4 CLI mismatch | Exit 1 in 1.019 s; required upstream flag unsupported |
| First exact-parent full run | Actual OSP and honest assertion confirmation; incorrect intermediate-edge test condition waits before refund; controlled stop, exit −9 / 519.164 s; **not a full pass** |
| Corrected ancestry run | Actual exit 0 / 235.945 s; confirmation, refund and replay checks all pass |

The exact Makefile-required private Geth dependency is built from `glamsterdam-devnet-8` commit `aa1f2fcf512988eb8890d9352e601b898d6fdb2c`, with source/module hashes, actual version and required-flag checks in [its provenance](evidence/r44/parent-geth/accepted-parent.json). Build exit is 0 / 100.175 s. This is a private test dependency; operating the real L3 does not require running this private Ethereum parent.

The capsule preserves the closed logs, source revisions, compile/test exits, partial checkpoint and reviews for all attempts. It excludes executables, private-chain databases and generated fixture keys. The early `precompile-pins.json` inside the capsule is historical inventory; the final acceptance uses [compiled pins](evidence/r44/compiled-pins.json), [the final review](evidence/r44/base-dispute-final-ancestry-review.json) and [source manifest](test-source-manifest.json). The 369,136-byte capsule has SHA256 `4398071d0e0b977f34bc449217f87a1e38813da45f2e4072998619e5f5333a0e`; sealing happened on Runpod, and the compressed bytes were independently checked after transfer.

## Production boundary

The separate [native GH0ST flow](../withdrawal-recovery/) passes deposit, spend, recovery and outbox payout on a genuine private Nitro parent. Its sparse balance-owner remap and privileged confirmation limits remain. This standard-ETH dispute result does not combine those fixtures into a final production-native-token validation pass.

Final custody, validators/collateral, gas pricing, canonical production configuration, operational activation and the applicable licensing arrangement remain in the [unsigned deployment packet](../launch/DEPLOYMENT-PACKET.md). Robinhood has no factory in the reviewed [canonical factory table](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts); the self-deployment route is documented but unsupported upstream. [Licensing](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license) is a separate decision. No public chain, real funds or accepted terms result from these private tests.
