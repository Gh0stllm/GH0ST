# Models for contract auditing

**Follow-up:** [downloadable models tested on local ICP, including costs and failed audit checks](ICP-AUDIT-RESULTS.md). Qwen3.5-2B runs in the pinned canister; Qwen3-4B IQ3 loads but exceeds the inference instruction limit. No tested configuration qualifies as a dependable contract auditor.

Checked 3 November 2026. Recommendation and evaluation plan, not a completed GH0ST audit or an API deployment. The small Qwen alert-writing experiment is not evidence of contract-auditing ability.

## Downloading and running on ICP / ICPP

The user clarified that the model should be downloadable and run through the existing ICP / ICPP stack. **None of the models discussed is currently validated here as a capable contract auditor running on ICP.** The hosted-model recommendation below applies only if an off-chain audit service is acceptable.

| Model | Downloadable weights? | Status for the existing GH0ST ICP runtime |
| --- | --- | --- |
| GPT-6 Astra | No public downloadable weights; hosted service | Cannot load into the canister |
| GPT-6.1 Sol | No public downloadable weights; hosted service | Cannot load into the canister |
| Claude Opus 5.5 | No public downloadable weights; hosted service | Cannot load into the canister |
| Qwen3-1.7B | Yes, Apache-2.0 model; pinned Q4_K_M file is 1.11 GB decimal | Existing GH0ST ICP inference history; best-supported baseline among these, not a validated auditor |
| Qwen3-0.6B | Yes, Apache-2.0 model; pinned Q4_K_M file is 397 MB decimal | Native local test only in this study; canister compatibility/cost not yet measured |

Model sources: [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B), [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B). Tested third-party GGUF downloads: [pinned 1.7B Q4_K_M](https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf), [pinned 0.6B Q4_K_M](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf). Verify hashes in [benchmark_local.py](benchmark_local.py). File size excludes runtime, activation, KV-cache and canister overhead.

Downloadability does not establish ICPP compatibility or security quality. A larger open-weight coding/reasoning model is a separate research candidate: first test exact architecture and GGUF support in the pinned Wasm runtime, then memory/context fit, held-out vulnerability detection and false findings, and finally bounded cycle costs. Do not assume that arbitrary GGUF files load or that scaling parameters produces a practical on-chain auditor. This was the initial selection boundary. The linked follow-up downloads and tests 2B and 4B candidates locally; no production deployment occurred.

## Hosted alternative if off-chain auditing is acceptable

Use **GPT-6 Astra with high reasoning as the initial deep-review candidate**, paired with source inspection, Slither and local Foundry reproduction tests. Compare xhigh only if the same audit cases justify its additional cost. Use **Claude Opus 5.5 as an independent second-review candidate**, where available for the intended security workload. GPT-6.1 Sol is a lower-cost candidate for mapping the repository, preparing tests and screening changes; benchmark before letting its triage decide which code receives deeper review.

This is an engineering recommendation for the current workflow, not a proven universal Solidity ranking. No current head-to-head Solidity audit evaluation establishing an Astra-versus-Opus-5.5 winner was verified. No paid model runs were conducted here. General coding benchmarks and vendor security claims cannot establish contract-specific recall or precision.

| Role | Candidate | Published standard API input / output per 1M tokens | Evidence and limits |
| --- | --- | --- | --- |
| Deep review | GPT-6 Astra | $10 / $50 | [Official model page](https://developers.openai.com/api/docs/models/gpt-6-astra) positions it for demanding reasoning and coding; no GH0ST audit score |
| Independent review | Claude Opus 5.5 | $4 / $20 | [Official release](https://www.anthropic.com/claude-opus-5-5) reports strong agentic coding results; these are not a Solidity audit comparison |
| Lower-cost preparation | GPT-6.1 Sol | $2 / $10 | [Official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) supports complex coding at lower token prices; security recall remains to be tested |
| Optional short alert wording | Qwen3-1.7B Q4_K_M | Separate ICP cost model | Locally screened only; unsuitable as the principal contract auditor |

These hosted frontier models would run outside ICP. The existing canister cannot simply load their weights. An audit result hash recorded on-chain would attest to a report identity, not prove that model inference occurred on-chain or that the contract is secure. Keep audit execution, budgets and product labeling distinct from Watch's optional ICP explanations.

For illustration, **100,000 uncached input tokens plus 20,000 billed output tokens across a review** imply $2.00 Astra, $0.80 Opus 5.5 or $0.40 Sol in model-token charges at the listed rates. These are arithmetic examples, not per-audit quotations. Count all turns, repeated context, reasoning/output tokens, failed calls, tools, test compute and human validation. A long agentic audit can consume much more. Cached input has different rates; no cache saving is assumed here. Subscription access is not the same as API billing, and account eligibility was not checked.

## What audit-specific evidence actually shows

- The original [EVMbench paper, March 2026 version](https://arxiv.org/html/2603.04915v1), separates **Detect**, **Patch** and **Exploit**. In that version Claude Opus 4.6 leads Detect at 45.9%; GPT-5.3-Codex leads Patch at 41.7% and Exploit at 71.0%. Those are older models and different tasks. An exploit score is not an audit-completeness score.
- A [September 2026 preprint on audit skills](https://arxiv.org/html/2609.29454v1) reports Codex/GPT-5.5 with skills finding 97/120 reference vulnerabilities (80.8%), versus 79/120 without skills. Its corresponding reference-matching disclosure precision is 33.1% (97/293 reported findings). Unmatched findings are not all proven false positives; benchmark ground truth can be incomplete. This supports validating reported issues, not displaying every model allegation as confirmed. The study uses older model configurations, mostly single-run comparisons, and its own 120-vulnerability setup; do not compare its percentages directly with the earlier paper's different version or transfer them to GPT-6 Astra.

The literature supports testing the entire audit workflow, not choosing a model from a general coding leaderboard. A larger model may still miss a real bug or produce a persuasive false finding.

## Proposed workflow and cost controls

1. Pin the repository commit, compiler settings, dependencies, deployed implementation/proxy relationship and explicit security assumptions. Check deployed bytecode against the reviewed build when describing a live contract.
2. Run [Slither](https://github.com/crytic/slither) and compile/test the project. Treat static-analysis output as leads, not verdicts. Inventory privileged operations, external calls, storage changes, accounting and asset flows.
3. Give the deep-review model complete relevant call paths, invariants and deployment assumptions. Review access control, upgrades, reentrancy, precision, oracle freshness, signatures/replay and protocol-specific economic behavior. Require a source location, prerequisites, affected invariant and concrete impact for each claim.
4. Reproduce serious findings using local tests, fuzzing/invariants or an appropriate formal proof; keep unconfirmed hypotheses distinct. A second model should first analyze independently, then challenge the first report. Agreement alone is not proof.
5. After a fix, rerun the reproduction and regression tests and retain the evidence. Human security review remains part of a funds-at-risk release decision; no AI-generated “safe” certificate.

For Watch, audit at onboarding and when code, implementation or material configuration changes; do not re-audit every block or every alert. A cache key must include chain, runtime/implementation bytecode, source/build/dependency versions, relevant configuration and review/model version. A matching source hash alone does not cover changed proxy implementations or privileges. Schedule any broader review separately. This is a proposed design, not an enabled recurring monitor.

Before selecting a production model, use the same fixed budget and repository cases to compare Astra, Opus and Sol: known-vulnerable contracts plus patched controls, held-out logic/accounting bugs, multi-contract and upgrade cases. Record independently confirmed severity-weighted recall, false findings, reproducibility, runtime and total cost per validated finding. Preserve failures and all tool/model versions. No such paid benchmark or contract audit has been run in this research checkpoint.
