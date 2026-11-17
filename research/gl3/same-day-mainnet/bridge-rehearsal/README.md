# Native GH0ST bridge — verified persisted-state rehearsal

**The private bridge lifecycle passed across a verified restart.** A genuine official SDK validator created and fast-confirmed the actual withdrawal assertion. After preserving a later client harness failure, an isolated copy of the closed databases completed the payout and all three mined rejection checks. This is not a single uninterrupted run, a public deployment, or ZK finality.

## What actually passed

The stack is private Geth (1337) → actual official Nitro parent (4663) → actual official Nitro child (4663001). The parent uses the pinned GH0ST runtime and observed storage layout with an explicitly synthetic 1000-token balance fixture. There are no child native prefunds, public writes, real wallets, or real funds. Production cold-owner genesis and private TEST-owner genesis differ.

Before the user deposited, an actual 100-token parent escrow deposit funded the generated TEST administrator. Seven real ArbOwner calls configured minimum/current basefee 1e13 and explicit network/infra/reward recipients, then added zero and removed the temporary administrator. Final owners were `[zero]`, minters empty, management schedule zero and upgrade schedule zero. The former administrator's fee-changing call rejected.

The user then locked 32 tokens on the real Nitro parent, received 32 child-native tokens, spent 1 and burned 0.5. The official SDK computed nonzero execution history, created an assertion and called `fastConfirmAssertion` on that existing assertion. Its full state, parent assertion and inbox accumulator match the actual creation event and canonical child block/send root. The trace used no administrator root setter or manual zero history.

| Check | Actual result |
| --- | --- |
| Genuine SDK assertion | `0x74521613e5e6a190f354948d2b6707589a9ebf98f8bd05111b416692911197be` |
| Existing-assertion fast confirmation | `0x36131b1faf0a3ebb5e12ee91537c3b2e9f504eed5bedc7ee94efcbfd833adcb2` |
| Original database preservation | 157 source file hashes unchanged; copied bytes verified before opening |
| Restart binding | Same confirmation receipt, earlier assertion creation, canonical child header/send root, c10 machine, fast authority and final fee/owner state |
| Parent ERC20 payout | Receiver 0 → 0.5; escrow 132 → 131.5; canonical spent bit false → true |
| Mined negatives | Altered amount, unauthorized fast confirmer and repeated withdrawal all status0 |
| Post-replay balances | Unchanged |
| Process cleanup | Original chains, SDK backend/staker and copied chains stopped; no chain kept running |

The payout transaction is `0x6794368c96ba83e6d079d8e7f922be14c39b5da066ad736fc1c089296171ac74`.

The copied-state tail exited 0 in 13.563662 s; its actual transaction query exited 0 in 2.970278 s. A separate offline receipt audit exited 0 in 0.847942 s and decoded the actual assertion events, full fast-confirm calldata and ERC20 transfer log. It also checked the three status0 receipts, unchanged database hashes and stopped processes. The original run's exit 1 remains preserved.

## Evidence

- [Complete tail report](accepted-persisted-lifecycle/export/payout-tail/result.json), [direct exit](accepted-persisted-lifecycle/export/payout-tail/controller-exit.json) and [cleanup](accepted-persisted-lifecycle/export/payout-tail/cleanup.json).
- [Independent receipt audit](accepted-persisted-lifecycle/export/audit/independent-receipt-audit.json), including exact negative transaction hashes.
- [Original SDK confirmation receipt and trace](accepted-persisted-lifecycle/export/original-v4/fast-confirmation.json), [fee/owner policy](accepted-persisted-lifecycle/export/original-v4/actual-configure-renounce-policy.json) and [original failed verdict](accepted-persisted-lifecycle/export/original-v4/actual-exit.json).
- [Original source database hashes](accepted-persisted-lifecycle/export/payout-tail/origin-file-hashes.json), [post-run hashes](accepted-persisted-lifecycle/export/payout-tail/origin-file-hashes-after.json) and [copied-origin verification](accepted-persisted-lifecycle/export/payout-tail/copied-origin-verified.json).

## Fee initialization findings

Minimum must be set first. The minimum setter can leave the current header/quote at 1e8 even though the minimum is already 1e13. Each of the first two setters therefore has a genuine newer-header gate requiring header basefee, direct RPC quote and minimum all equal 1e13 before the next estimate/signature. Both gates passed through actual batch reports in V4; the canonical zero-amount parent-deposit fallback was not needed.

During a transition, ordinary `eth_estimateGas` returned 500,795 while the direct L1 component still required 45.813 billion gas units. The local sender floors total signed gas at the maximum of the ordinary estimate and direct L1 component plus read-only compute, then adds the existing margins. A fresh explicit RPC quote supplies the fee cap, avoiding ethers' cached old fee. Signed transactions retain full charging; actual receipt compute stays below the unchanged 16,777,216 guard and the RPC fee cap stays 1000. Transition-only read calls may skip L1 charging; that override is disabled before the third administrator call.

## Preserved failures and limits

Earlier guard, estimate, fee-transition, upfront-balance and cached-fee failures remain in their separate capsules. V2 completed all seven administrator calls but its 16-token user lacked the type2 maximum upfront burn reserve; the final fixture uses32 actually escrow-backed tokens. V4 reached genuine SDK confirmation, then ethers refused to reuse an immutable decoded tuple for a negative call. The continuation deep-cloned the tuple and completed against verified persisted state. The future full runner includes the same plain-array fix but has not been rerun as one uninterrupted scenario.

Fast confirmation trusts the project operator. The private ordinary confirmation period was 2000 blocks and the fast path bypassed that fixed window. Real chain processing/fees remain; the observed burn-to-confirm interval 167.494 s included a private producer startup repair and is not a production latency promise. Permissionless challenge finality, public deployment and ZK execution were not tested by this fixture.

All execution stayed on Runpod. The bounded chain work used 2 CPUs, 2GiB owned RSS, 8GiB database allowance and 6GB free/56GB shared-memory reserves; the official SDK producer had its own guard. No model or chess engine ran or changed.
