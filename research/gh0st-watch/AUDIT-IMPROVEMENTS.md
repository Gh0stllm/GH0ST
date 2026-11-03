# Can GH0ST Watch make Qwen3.5-2B audits more accurate and cheaper?

**3 November 2026 · Research branch · Local experiments only.** Put an executable check before the model. On 25 small authored contracts, six scripted attacks reproduced all 12 intended defects and none of the 13 control cases. The stand-alone model did much worse even when told which defect to check. “Not reproduced in this test” is the strongest negative conclusion supported here.

## What changed when we changed the prompt?

Same Qwen3.5-2B Q4_K_M, native CPU, greedy, no reasoning output, four-token cap. A grammar constrained output format. Each method got the same complete Solidity fixture and the correct issue family. This is **easier than discovery**, and picking the best prompt on these cases creates selection bias. Twelve cases extend a 13-case development set with different guards, helpers and accounting patterns; they were written for this research and are not an independent project holdout. Ground truth: 12 positive / 13 negative; one positive repeats mint with an adversarial comment.

| Source-only instruction / allowed answers | Defects called positive / 12 | Controls falsely flagged / 13 | Unknown / 25 | Correct / 25, unknowns included in denominator |
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

## When Qwen sees the test result

Using the same weights, on the same 25 cases, we changed the question to “Did this execution demonstrate the behavior?” The model saw only the family-specific question, receipt/state observations and a yes/no/unknown instruction. It never saw the expected answer, source, fixture name or the harness’s verdict. The code that interprets the receipt has already done the hard work. This **changes the task**; it does not establish improved independent vulnerability discovery.

| Inputs | Correct / 25 | Defects recognized / 12 | False positives / 13 controls | Abstentions / 25 | Average native prompt tokens |
|---|---:|---:|---:|---:|---:|
| Source + claim, plain prompt | 14 | 10 | 9 | 0 | 134.1 |
| Structured execution observations | 20 | 12 | 2 | 3 | 83.6 |
| Short sentences from the same observations | 10 | 10 | 2 | 13 | 61.0 |

The structured version got 11/13 development and 9/12 transfer cases right. It returned “unknown” on all six additional missing-evidence probes (one per family). Its two false positives were both failed reentrancy attempts: 7 wei deposited and only 7 received. It abstained three times on prevented arithmetic wraps. The shorter sentence format was designed after inspecting failures; it changed the fields, presentation and instruction together. It also returned unknown on all six empty probes, but lost ten correct answers on complete evidence. Saving 23 input tokens this way is a bad trade. Prefer the structured observation format for research. Use the deterministic comparison as the authority.

[Native trace interpreter](evidence_audit.py), [structured outputs](audit-evidence-results.json), [shortened-fact outputs](audit-facts-results.json).

## What ICP actually charged on the local replica

**Measured cycles; illustrative USD at $1.40 per trillion cycles.** Same GGUF and canister Wasm as the [prior baseline](ICP-AUDIT-RESULTS.md), fresh prompt cache per job; zero paid mainnet transactions. These are model calls for tiny fixtures. The evidence jobs read results produced by the local EVM; they are not equivalent full audits.

| Local application-subnet workload | Input / generated tokens | Observed answer | Total cycles | USD equivalent |
|---|---:|---|---:|---:|
| Earlier open-ended mint review | 154 / 91 | Invented reentrancy | 1.6141T | $2.26 |
| Source + supplied claim, open mint | 123 / 3 | `AA` (malformed) | 0.7722T | $1.08 |
| Source + supplied claim, protected mint | 128 / 2 | `A` (incorrect) | 0.7931T | $1.11 |
| Structured evidence, open mint | 73 / 1 | `yes` (correct) | 0.4512T | $0.63 |
| Structured evidence, protected mint | 73 / 1 | `no` (correct) | 0.4517T | $0.63 |

The open-mint evidence job used **72.0% fewer cycles** than the earlier open-ended job on that same fixture. The short source jobs allowed four generated tokens; one returned an invalid double letter and the other falsely accused the protected contract. The trace jobs used a one-token ceiling with yes/no/unknown; the constrained English labels had each taken one token in the native screen. The ceiling ends generation without requiring an end-of-generation token. Accept only a complete exact label. A valid answer still needs to agree with the evidence. These are single observations on two fixtures, not a throughput, reliability or tail-cost benchmark.

For **100 incoming events in 30 days**, using the average of the two measured trace jobs and the previous local idle estimate, the warm model costs **$66.41** if called 100 times, **$9.53** if called 10 times, and **$3.21** if never called. First-month totals including the previous one-time setup estimate are **$71.51, $14.63, $8.31** respectively. Ten calls is an assumed routing/deduplication policy, not an observed hit rate. With no model canister provisioned at all, the witness-only path incurs **zero model setup, idle or inference cycles**. EVM execution, RPC, evidence storage, engineering and human review still have costs. Account separately for failed attempts, external infrastructure and verification before a deployment. The local status and the public storage-price table differed in the baseline; confirm idle burn on the intended subnet before funding.

[Recomputed totals and assumptions](audit-improvement-summary.json) · [source: open mint](audit-icp-short-mint_vulnerable.json) / [protected](audit-icp-short-mint_fixed.json) · [evidence: open mint](audit-icp-trace-mint_vulnerable.json) / [protected](audit-icp-trace-mint_fixed.json).

## Where to spend the next engineering effort

1. **Use a reproducible transaction as the alert.** Show the call, caller role, block, receipt, before/after state and protocol invariant. Let deterministic code format known outcomes. No model canister is needed for this path. Never translate “not reproduced” or “unknown” into “safe.” Unrecognized cases go to review; they must not silently drop out of coverage.
2. **Avoid repeated work.** Cache source analysis by chain, implementation bytecode and linked dependencies, compiler/settings, rule version and configured roles. For state-dependent tests include block hash, execution environment, caller, pre-state and exact test inputs. An upgrade, role or relevant state change invalidates the previous result; an old receipt only describes its old block. Model renderings additionally key on evidence digest, model artifact, prompt, runtime and rules. Coalesce identical concurrent requests. No traffic cache-hit rate has been measured.
3. **If Qwen runs, give it one question and bounded evidence.** Cap input, output and total cycles; validate the *entire* returned string against the allowed labels. On malformed output, missing evidence or a disagreement with the witness, use the factual template; do not rerun automatically. Abstentions, invalid labels and retries consume budget. Reserve calls for a use that adds value beyond repeating a computed verdict.
4. **Fine-tune off-chain only after building a blind test.** Collect independently reviewed vulnerable/fixed pairs, balanced innocuous lookalikes, absent prerequisites and malicious comments. Include indirect calls, modifiers, proxies, token semantics and multi-contract state. Target a claim, exact location, necessary conditions and evidence reference, with abstention for insufficient evidence. Group by project, fork/clone family and time *before* splitting; keep reviewed cases from newer/private code separate to reduce pretraining overlap. Public [exploit reproductions](https://github.com/SunWeb3Sec/DeFiHackLabs) and [audit publications](https://github.com/trailofbits/publications) are starting points for curation, not clean train/test splits. Check permissions and re-run positives and patched negatives. Compare the current baseline to a small supervised adapter on untouched projects, then merge/quantize and repeat the *same* benchmark on the exact ICP artifact. [Qwen's model card](https://huggingface.co/Qwen/Qwen3.5-2B) identifies task-specific fine-tuning as an intended use. No training or new weights were produced here.
5. **Decide with operational metrics.** Track verified-finding precision, family-specific recall, false alerts per clean contract, abstention and reviewer hours; report costs per confirmed finding, including failed calls. Select thresholds before the holdout. Require separate evaluation on missing context and adversarial comments. Keep the model in shadow mode until it adds useful findings beyond the witness-only baseline at the chosen false-alert budget. Do not use more aggressive weight compression until it passes the same quality screen.

## Run the experiments

Run from this directory on a development machine. The script starts and stops its own disposable, unforked Anvil on loopback; it uses no production RPC, wallet or keys. Prerequisites: Node, Foundry Anvil 1.8.5, Solidity JS compiler 0.8.24, ethers 6.15.0. Set ANVIL if the executable is not on PATH.

```sh
deps=$(mktemp -d)
npm install --prefix "$deps" --ignore-scripts --no-audit solc@0.8.24 ethers@6.15.0
NODE_PATH="$deps/node_modules" node run_evm_witness.cjs audit-evm-witnesses.json
```

For native tests use Python 3.11+ with llama-cpp-python 0.3.36 and the exact [pinned 2B GGUF](audit-model-catalog.json). Set GGUF to its local path. No training is involved.

```sh
python improve_audit.py --model "$GGUF" --variants narrow guided --output audit-improvement-results.json
python improve_audit.py --model "$GGUF" --variants terse plain --output audit-short-results.json
python evidence_audit.py --model "$GGUF" --format raw --output audit-evidence-results.json
python evidence_audit.py --model "$GGUF" --format facts --output audit-facts-results.json
```

For local ICP use the [pinned runtime and load procedure](ICP-AUDIT-RESULTS.md#reproduction). Upload and hash-check the same 2B GGUF; use context 2048, batch/ubatch 4 and q8_0 KV cache. With icp-py-core 2.3.1, set LOCAL_URL to the disposable replica, CID to the loaded canister and DID to the pinned Candid file. Run the following for each mint case with a fresh prompt cache name. The probe rejects non-loopback hosts. Cycle deltas cover token-limit setup, fresh chat and the full update.

```sh
for c in mint_vulnerable mint_fixed; do
  python benchmark_icp_short.py --url "$LOCAL_URL" --cid "$CID" --did "$DID" --case "$c" --cache "source-$c-$(date +%s)" --output "audit-icp-short-$c.json"
  python benchmark_icp_short.py --url "$LOCAL_URL" --cid "$CID" --did "$DID" --case "$c" --cache "trace-$c-$(date +%s)" --trace-file audit-evm-witnesses.json --output "audit-icp-trace-$c.json"
done
python summarize_audit_improvements.py
```

The [cost calculator](summarize_audit_improvements.py) uses archived measurements and also runs without the canister or model.
