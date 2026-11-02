# Downloadable contract auditing on ICP: measured results

3 November 2026. **Local research only. No paid deployment, production changes or mainnet fee measurement.**

## Decision

**No tested configuration qualifies as a dependable contract auditor.** The most useful newly verified deployment candidate is **Qwen3.5-2B Q4_K_M**: it downloads, loads and completes a bounded Solidity response in the existing ICPP canister. Its audit explanation was wrong. Treat it as an experimental screening/fine-tuning candidate, never as a contract clearance service.

Qwen3-1.7B Q4_K_M remains the established smaller runtime baseline, but its native audit screen also failed. The earlier recommendation for short Watch alert wording did not establish auditing ability. Qwen3-4B-Instruct-2507 UD-IQ3_XXS fits in memory but **cannot complete even its first one-token inference update in the tested runtime**. More cycle funding does not remove a per-message instruction ceiling.

This is a comparison of the exact tested artifacts and configurations, not a universal ranking of all downloadable models. It does not establish that fine-tuning, another quantization or different inference kernels cannot improve them.

## What actually ran

Pinned canister: `onicai/llama_cpp_canister` v0.23.0rc4, commit `4276f526970b7916cc7105c357ad2f2ed018ed37`; llama.cpp fork `702142008552e33844f99dddefc409550166d175`. The official release Wasm SHA-256 was verified:

`964787ece3a98badb85493839ad77a372295ca7b8ded9f87ac8222a616d3edb5`

Local ICP CLI 1.7.0, network-launcher `v16.1.0-2026-10-16-03-29`, application subnet, Normal cost schedule, Production instruction configuration. Both test canisters used 0 compute allocation, 0 memory allocation and a 3.75 GiB Wasm memory limit. Anonymous control was confined to an isolated localhost test network; no existing identity was exported or used. Test cycles have no monetary value. The isolated network was stopped after measurement.

| Artifact | Download | Local ICP result | Audit-quality result |
| --- | ---: | --- | --- |
| Qwen3.5-2B Q4_K_M | 1,280,835,840 bytes | Loaded; generated 32 capped probe tokens, then completed a separate 154-input/91-output contract response | Invented a `msg.sender` call and diagnosed reentrancy in a mint function with no external call |
| Qwen3-4B-Instruct-2507 UD-IQ3_XXS | 1,674,376,800 bytes | Loaded; first inference update rejected with IC0522 at the 40B instruction limit | Native screen also produced false findings and followed the malicious comment |
| Qwen3-1.7B Q4_K_M | 1,107,409,472 bytes | Existing upstream/GH0ST runtime evidence; not redeployed in this study | New native screen produced false findings and followed the malicious comment |

2B load settings: no warmup, context 2,048, batch/micro-batch 4, K/V cache q8_0. A one-token cap was used for the short metering probe; `max_tokens_update=0` enabled the runtime's instruction guard and self-call continuation for the complete response. The complete run ended at EOG with `partial=false`. It was execution success and **audit failure**.

The 4B failed with both context 2,048/batch 4 and context 512/batch 1, each with `max_tokens_update=1`. Its failed updates consumed approximately 40.03B cycles each. This rules out these settings/artifact on this build; it is not proof that every 4B model or quantization fails on ICP. Loading alone is insufficient evidence of usable inference.

Final 2B memory: 1,548,812,288 heap bytes + 1,400,963,072 stable bytes; management status reported 2,958,519,871 total bytes including other state. These are this small-context experiment's high-water values, not the model card's advertised context capacity.

Evidence: [runtime provenance](audit-runtime-provenance.json), [2B probe](audit-icp-2b.json), [complete 2B contract response](audit-icp-2b-contract.json), [4B failure](audit-icp-4b.json), [smaller-context failure](audit-icp-4b-small-context.json), [memory](audit-icp-memory.json), [2B management status](audit-icp-2b-status.json).

## Quality screen and limitations

The reproducible [native harness](benchmark_contract_audit.py) uses six short vulnerable/patched Solidity pairs: withdrawal ordering, tx.origin authorization, unrestricted mint, signature replay, unchecked token-return value, and unchecked subtraction. A thirteenth case adds a malicious instruction in a code comment. Expectations are review fixtures, not an independently validated public benchmark or executed exploit suite. Relevant control semantics are described in the [Solidity security guide](https://docs.soliditylang.org/en/latest/security-considerations.html).

At temperature 0, 256 output tokens and context 2,048, **all three models flagged all six patched controls as vulnerable**. Naming a vulnerability on an actually vulnerable contract was not sufficient: many explanations named the wrong cause or invented code. Both 1.7B and 4B changed the unrestricted-mint verdict to false when the malicious comment claimed approval. The 2B retained a true verdict but gave a largely fictitious explanation.

To check the effect of sampling, the 2B was also run with its vendor's recommended non-thinking text settings: temperature 1, top-p 1, top-k 20, min-p 0, presence penalty 2, repetition penalty 1, seed 42. It still falsely flagged **five of six** patched controls and invented facts. Its one clean verdict included invented EIP references. Four additional greedy thinking-mode trials each exhausted 1,024 output tokens without closing the reasoning section or returning a final answer. Qwen's [model card](https://huggingface.co/Qwen/Qwen3.5-2B) itself discusses thinking-loop risk and sampling dependence. These small tests do not establish intrinsic model accuracy; they establish that these bounded configurations are not ready for this task.

Raw outputs: [4B](audit-native-4b.json), [1.7B](audit-native-17b.json), [2B greedy](audit-native-2b.json), [2B recommended sampling](audit-native-2b-sampling.json), [2B bounded thinking](audit-native-2b-thinking.json). Native runtime was llama-cpp-python 0.3.36 on an ARM64 Mac, CPU only. Native outputs/timings are separate from the pinned Wasm tests; their outputs were not identical. One seed, short fixtures and no repository-scale tests mean no calibrated security score or severity-weighted recall is claimed.

## Cost: model engine, not a complete audit service

`T` = trillion cycles. 1T is pegged to 1 XDR; all USD figures below use **$1.40/T as a planning assumption**, not a live exchange quote. Raw local cycle-balance deltas include elapsed storage charges, ingress and runtime overhead. Funding/top-ups are not consumption. Local latency is not a mainnet service guarantee.

| Item | Cycles | Planning USD |
| --- | ---: | ---: |
| Upload 2B GGUF in 641 chunks | 3.023982T | $4.23 |
| Load model | 0.014916T | $0.021 |
| Setup budget: creation + upload + load + 0.1T install/other setup allowance | 3.638898T | **$5.09 once** |
| Retain measured canister state for 30 days, idle | 2.293452T | **$3.21/month** |
| Complete synthetic contract job, including token-limit setup and new session | 1.614082T | **$2.26/job** |

The measured job contained **154 input and 91 generated tokens**, took **183 seconds locally**, and produced an incorrect report. This is the cost of that complete bounded computation, not the price of a valid audit. Installation allowance is explicitly estimated, not a measured installation receipt. Setup excludes any target-subnet storage-reservation funding requirement.

**Storage discrepancy:** the public [cycle-cost page](https://docs.internetcomputer.org/references/cycle-costs/) lists 127,000 cycles/GiB-second. Our local management status instead reports 76,448,386,569 idle cycles/day. That matches the [IC source configuration inspected](https://github.com/dfinity/ic/blob/ce13323d0627df91e424176c1d376b95d9d2ecb5/rs/config/src/subnet_config.rs): 317,500 cycles/GiB-second plus 10,000 base cycles/second, to rounding. We therefore use the reported local idle rate. This is not a claim that the inspected source commit is deployed on a particular mainnet subnet; read the actual target canister status before funding. Do not reuse the lower documentation-only storage estimate as a verified bill.

| Monthly repetition of the same measured short job | Steady state, including idle | First month, including setup | First month with 20% extra job/retry budget |
| --- | ---: | ---: | ---: |
| 10 jobs | $25.81 | $30.90 | $35.42 |
| 100 jobs | $229.18 | $234.28 | $279.47 |
| 1,000 jobs | $2,262.93 | $2,268.02 | $2,719.96 |

These are same-workload projections, not guaranteed capacity or prices for arbitrary contracts. Full-month idle plus raw job deltas conservatively overlaps the small amount of idle charged during each job.

The separate one-token probe measured 7.825–8.027B cycles/input token and 8.039–8.076B/generated token. A deliberately simple projection using 8B input and 8.05B output gives **$3.59 for 256 input + 64 output**, **$14.35 for 1,024 + 256**, or **$43.06 for three such passes**, before setup/idle/external costs. These larger workloads were not measured. Batching, context, retries and cache behavior change cost; the completed self-call job was cheaper than applying the one-token rates blindly. Reasoning tokens and failed/unfinished attempts also consume budget.

Unpriced external components: source retrieval/RPC, scanner/fuzzer hosting and engineering, production coordinator calls, human confirmation and any target-subnet reservation. Thus no all-in project-audit service price is asserted. Regenerate all arithmetic with `python3 audit_costs.py`; [machine-readable costs](audit-costs.json).

## Why other downloadable models were not selected

See [artifact sizes and resource constraints](ICP-AUDIT-FEASIBILITY.md) and [exact model revisions/hashes](audit-model-catalog.json). The tested Qwen3/3.5 base model cards use Apache-2.0; third-party GGUF artifacts were pinned and hash-verified. Qwen2.5-Coder-3B uses the Qwen Research license, not the same license as Qwen3. Larger Q4 files exceed the loader's one-message stable-read budget; splitting the upload does not split model loading.

- [Qtum Qwen3-Coder-30B-A3B-Audit](https://huggingface.co/qtum/Qwen3-Coder-30B-A3B-Audit) is downloadable and specialized, but 30.5B total parameters are not 3B resident weights. Its card also discloses low absolute recall. It is not a drop-in current ICPP model.
- [Model Alpha](https://huggingface.co/l-lyubenov/model-alpha) is an 8B Solidity fine-tune in AWQ/compressed-tensors format, not a tested GGUF for this canister. [Qwen3.6 Solidity 27B](https://huggingface.co/samscrack/Qwen3.6-Solidity-27B) and [Qwen3.8 Solidity 27B](https://huggingface.co/Rami8612/Qwen3.8-27B-Solidity-v1-GGUF) are also outside this drop-in footprint. Author-reported scores do not supply ICP execution evidence.
- [DMind-3-mini](https://huggingface.co/DMindAI/DMind-3-mini) uses a Qwen3.5-4B base and recommends BF16/at least 12 GB VRAM; no verified compact audit configuration was established. [Fluxnat-Coder-3B](https://huggingface.co/k4ran909/Fluxnat-Coder-3B) describes general software security training, without a validated Solidity/ICP result.
- The [small-model distillation paper](https://arxiv.org/html/2606.03128v1) describes task-specific training and aggregation. No verified release of its trained audit weights was located. Its scores must not be assigned to stock Qwen3-0.6B.
- [CodeT5-Small-Solidity-Vulnerability](https://huggingface.co/angusleung100/CodeT5-Small-Solidity-Vulnerability) is a tiny downloadable classifier, but its card leaves dataset/limitations unspecified. Its reported perfect score is insufficient evidence. It also needs a separate classifier runtime/conversion; it is not an audit-explanation model ready for this canister.

## Recommended GH0ST direction

Use compiler checks, [Slither](https://github.com/crytic/slither), and local invariant/fuzz tests such as [Echidna](https://github.com/crytic/echidna) to create evidence outside ICP. Those tools' results still require review. Keep ICP for bounded experimental interpretation of evidence, provenance and receipts. This is a proposed hybrid design, not an implemented pipeline.

Audit only on onboarding or material code/configuration changes. Deduplicate by chain, deployed implementation, build, configuration and review version. Require a concrete source location and reproducible exploit/invariant failure before publishing a security finding. Cap input, output, reasoning, wall time, retries and total cycles per job. Do not release an automatic “safe” verdict. Fine-tune and independently evaluate a small model on held-out vulnerable and repaired contracts before treating it as an auditor.

For the 4B candidate, a different quantization, faster Wasm kernels or forward passes split across messages would require new implementation and metering. No such optimization was performed here. For 2B, the next decision gate is accurate evidence-grounded output, not another unvalidated size or benchmark claim.

## Reproduction

Use Python 3.11+ with `llama-cpp-python==0.3.36` for native screens; `icp-py-core==2.3.1` for the local ICP scripts. Download the pinned GGUFs in the catalog and verify SHA-256. Build an isolated local ICP project with the pinned release Wasm, set the memory limit above, and use only its localhost URL. Do not use the anonymous test controller on a public network.

`benchmark_icp_local.py --url LOCALHOST_URL --cid LOCAL_CANISTER --did PINNED_LLAMA_CPP_DID --model GGUF --sha256 EXPECTED_HASH --output RESULT_JSON` streams upload chunks, verifies the uploaded hash, loads the model and meters the one-token probe. It rejects non-local URLs. `--ctx 512 --batch 1` reproduces the smaller-context 4B failure. `benchmark_icp_audit.py` runs the complete synthetic case on an already-loaded, hash-checked local 2B canister. The scripts create only valueless local test cycles; they do not connect to mainnet.
