# Downloadable contract-audit models on ICP

3 November 2026. Initial feasibility checkpoint; superseded by [measured results and costs](ICP-AUDIT-RESULTS.md). No paid inference or production change.

## First checkpoint: feasibility before model ranking

The current GH0ST runtime is `onicai/llama_cpp_canister` commit `4276f526970b7916cc7105c357ad2f2ed018ed37` (v0.23.0rc4). Its separate llama.cpp fork is pinned to `702142008552e33844f99dddefc409550166d175`. Source files for that fork were not present in the inspected vendor checkout; the release manifest alone does not prove every GGUF architecture works on-chain.

[ICP's current resource limits](https://docs.internetcomputer.org/references/resource-limits/) are **4 GiB Wasm32 heap, 6 GiB Wasm64 heap, 2 GiB stable-memory reads per replicated message and 40 billion instructions per update**. Stable memory's 500 GiB capacity is not ordinary inference RAM. The current runtime loads a complete model within one update; larger files need a redesigned loader, not just smaller upload chunks. Wasm64 is a separate build/runtime migration and does not remove the per-message read limit.

The [pinned 1.7B guide](https://github.com/onicai/llama_cpp_canister/blob/4276f526970b7916cc7105c357ad2f2ed018ed37/docs/README-qwen3-1.7B.md) reports a Q8 load failure even though that file is below 2 GiB. Filesystem/metadata access and working buffers matter. File size below a limit is necessary but insufficient; actual loading and generation must be tested.

## Shortlist under investigation

| Candidate artifact | Exact file bytes | Initial implication |
| --- | ---: | --- |
| Qwen3-4B-Instruct-2507 Q4_K_M | 2,497,281,120 | Exceeds one-message stable-read budget; not a drop-in choice |
| Qwen3-4B-Instruct-2507 UD-IQ3_XXS | 1,674,376,800 | Smaller existing-architecture candidate; low-bit quality and Wasm kernels need validation |
| Qwen3-4B-Thinking-2507 UD-IQ3_XXS | 1,674,376,832 | Similar fit candidate, but reasoning tokens can dominate cost |
| Qwen3.5-4B Q4_K_M | 2,740,937,888 | Exceeds one-message stable-read budget |
| Qwen3.5-4B UD-IQ3_XXS | 1,949,047,968 | Close to read ceiling; hybrid architecture and overhead increase uncertainty |
| Qwen3.5-2B Q4_K_M | 1,280,835,840 | Useful smaller modern challenger; hybrid runtime compatibility unproven |
| Qwen2.5-Coder-3B-Instruct Q4_K_M | 2,104,932,800 | Very little read headroom; model card uses Qwen Research license, not Apache-2.0 |

Exact revisions and SHA-256 values are recorded in [audit-model-catalog.json](audit-model-catalog.json). These are Hugging Face artifact metadata checked today, not runtime memory measurements. The 4B instruct and thinking models are separate checkpoints. The thinking model's published coding scores use much larger output budgets than a cheap on-chain audit would permit.

Official model sources: [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), [Thinking-2507](https://huggingface.co/Qwen/Qwen3-4B-Thinking-2507), [Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B), [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B), [Qwen2.5-Coder-3B](https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct). Generic coding scores are not Solidity-audit recall.

## Cost method

Measure load/generation feasibility locally before spending real cycles. Keep native CPU timing separate from ICP instruction/cycle measurements. A useful cost result must include prompt ingestion, all reasoning/output tokens, all verification passes, failed attempts, coordinator calls, setup/upload and retained storage. The earlier $3-5 short-alert allowance cannot be reused as a full contract-audit price.

[ICP cycle pricing](https://docs.internetcomputer.org/references/cycle-costs/) fixes 1T cycles at 1 XDR. Use explicit cycle totals and a clearly labeled USD planning conversion rather than treating a dated USD example as today's exchange quote. A 13-node subnet charges 5,000,000 cycles per update plus instruction charges, and 127,000 cycles per GiB-second for storage; larger subnet costs differ.

Completed follow-up: [local execution, failures, audit screens and costs](ICP-AUDIT-RESULTS.md). It also reconciles a storage-rate discrepancy between the documentation quoted above and the tested runtime. No candidate qualifies as a dependable auditor.
