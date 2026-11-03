# Can GH0ST Watch make Qwen3.5-2B audits more accurate and cheaper?

**3 November 2026 · Research branch · Local experiments only.** Put an executable check before the model. On 25 small authored contracts, six scripted attacks reproduced all 12 intended defects and none of the 13 control cases. The stand-alone model did much worse even when told which defect to check. “Not reproduced in this test” is the strongest negative conclusion supported here.

## What changed when we changed the prompt?

Same Qwen3.5-2B Q4_K_M, native CPU, greedy, no reasoning output, four-token cap. A grammar constrained output format. Each method got the same complete Solidity fixture and the correct issue family. This is **easier than discovery**, and picking the best prompt on these cases creates selection bias. Twelve cases extend a 13-case development set with different guards, helpers and accounting patterns; they were written for this research and are not an independent project holdout. Ground truth: 12 positive / 13 negative; one positive repeats mint with an adversarial comment.

| Source-only instruction / allowed answers | Reproduced-label positives called positive / 12 | Controls falsely flagged / 13 | Unknown / 25 | Correct / 25, unknowns included in denominator |
|---|---:|---:|---:|---:|
| Claim verification: A, B, U | 0 | 1 | 19 | 3 |
| Added Solidity-specific guidance: A, B, U | 0 | 0 | 25 | 0 |
| Terse claim: A, B, U | 12 | 12 | 0 | 13 |
| Plain language: yes, no, unknown | 10 | 9 | 0 | 14 |

The plain prompt got 7/13 development and 7/12 transfer cases right. A model that always votes negative gets 13/25 here. Removing false alarms by abstaining on every case is unusable; accepting every warning is nearly as bad. Do not use these labels alone to approve code, close a finding or publish an alert. The [previous full-answer baseline](ICP-AUDIT-RESULTS.md) also invented a call that wasn't in the code. A valid JSON response is not evidence.

## Test the reported behavior

[Local transaction harness](run_evm_witness.cjs) and [25 recorded observations](audit-evm-witnesses.json). Solidity 0.8.24 compiled the original source unchanged. Each case ran on a fresh contract in a disposable Anvil chain. The harness chooses a recipe using the supplied family and known ABI. Expected labels are saved for scoring, not passed into the transaction recipe. The tests record receipts and observed state changes and make **zero ICP model requests**.

| Claim | What the recipe actually checks |
|---|---|
| Unrestricted mint | Ordinary caller mints 7 to itself; compare balance before/after. Also check the privileged caller can mint. |
| Origin-based authorization | Owner pays directly, then calls an intermediary that tries to redirect funds; check recipient's actual balance. |
| Reentrancy | Another depositor supplies liquidity. An attacker credits 7, attempts one reentry, then receives either 7 or 14. |
| Coupon replay | Submit the exact same valid signature twice from the same account; inspect the second receipt and change in points. |
| Unbacked token credit | Simulated token returns false without moving tokens. Inspect both token movement and credited balance; repeat with a successful transfer as control. |
| Arithmetic wrap | Burn one from zero; inspect the receipt and resulting balance, including whether it reached the maximum unsigned integer. |

This validates recipes on these fixtures, not arbitrary contracts. A real deployment needs verified bytecode/source, the actual proxy, roles, balances, token behavior and a pinned block. If a recipe cannot construct the required state, report “untested”; if it runs without reproducing the issue, report that path and inputs only. A reproduced state change still needs protocol context: for example, mint permission must actually be intended to be restricted.

Raw prompt results: [first 50 decisions](audit-improvement-results.json), [next 50 decisions](audit-short-results.json); [source harness](improve_audit.py).

Next checkpoint: compare model interpretation of execution evidence and missing-evidence controls; measure the actual cost of bounded responses on a local ICP replica.
