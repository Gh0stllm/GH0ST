# GH0ST · GPT-OSS on-chain research

**Research started: 22 October 2026. First target: GPT-OSS-20B.**

Goal: investigate efficient on-chain storage and execution of GPT-OSS, starting with a small, independently checkable arithmetic component. This branch is independent of the deployed S0UL pilot. No mainnet contracts or production frontend were changed.

## What exists now

- Three Solidity implementations of the same bounded MXFP4 dot product: a readable baseline, a control using packed operands, and an assembly kernel using a byte lookup and signed-int16 packed operands.
- A local EVM harness comparing all three implementations with an independent sign/exponent/mantissa CPU reference.
- A bounded downloader for revision-pinned metadata, checkpoint headers and four real expert-weight rows. It refuses servers that ignore byte ranges, so it cannot silently download a whole checkpoint.
- A completed **synthetic-fixture** benchmark and a roadmap for real-weight and full-model work.

**No full GPT-OSS inference, compressed model, GPT-OSS quality result or on-chain deployment is claimed.**

## Initial local result — arithmetic microkernel only

`evidence/synthetic-benchmark.json` records **33 successful three-way arithmetic comparisons** and **18 rejected invalid calls**. Cases include every FP4 nibble in both positions, signed-int16 extremes, all 65 supported scale encodings, deterministic randomized cases and four synthetic 2,880-element rows. Empty inputs also return zero on all paths.

| Synthetic row | Packed high-level control gas | Optimized packed gas | Reduction |
| --- | ---: | ---: | ---: |
| 0 | 3,527,492 | 486,939 | 86.196% |
| 1 | 3,527,816 | 486,903 | 86.198% |
| 2 | 3,527,769 | 486,855 | 86.199% |
| 3 | 3,527,306 | 486,891 | 86.197% |

These are **local Ganache Shanghai transaction receipts**, including intrinsic and calldata gas. The primary comparison uses the same packed operand format and calldata length on both paths. The additional `baseline` comparison includes an expanded int16-array ABI; its savings must not be attributed solely to arithmetic changes. Function selectors differ between paths.

**The ~86.2% saving applies only to this synthetic dot-product microbenchmark versus our straightforward high-level control. It is not a GPT-OSS inference speedup, mainnet gas saving or comparison with an existing optimized kernel.** All benchmark weights and activations are synthetic. Sampling is intentionally small; it is not a workload-representative model study.

The real-weight downloader fetched configuration and the checkpoint index, then was interrupted by an environment network-approval cancellation before weight sampling. No alternative download route was attempted. Real-weight parity remains pending.

## Arithmetic contract

The published MXFP4 format has 32 E2M1 values in 16 bytes, with one scale byte per block. The low nibble precedes the high nibble. For scale byte `s` and twice the FP4 value `v2`, the exact dyadic weight is:

```text
weight = v2 * 2**(s - 128)
Q32 block dot = sum(v2[i] * activation_int16[i]) * 2**(s - 96)
```

The kernel supports only `96 <= s <= 160`. Other scale encodings and malformed operand lengths revert. Signed zero becomes integer zero. No activation quantizer is provided; the int16 operands are fixtures, not GPT-OSS activations. Exactness here is exact dyadic arithmetic in this bounded domain, **not BF16 rounding equivalence with the complete model**.

The packed kernel decodes each byte into two values and sign-extends two big-endian int16 activations directly from calldata. It does not expand the weights to int256 arrays. It does not implement routing, RMSNorm, attention sinks, RoPE/YaRN, SwiGLU, attention, KV state, tokenizer, vocabulary projection or generation.

## Reproduce

```bash
cd research/gpt-oss-onchain
npm ci --ignore-scripts --no-audit --no-fund
node benchmark.mjs --synthetic
```

Environment: solc 0.8.30, optimizer 200 runs, via-IR, Shanghai EVM; Ganache 7.9.2, ethers 6.13.5. The native websocket module may fall back to JavaScript on newer Node versions; this affects host speed, not EVM gas accounting. No wallet secrets or mainnet RPC are needed.

When authorized network access permits bounded real-weight downloads:

```bash
python prepare.py
node benchmark.mjs
```

The downloader resolves and records a Hugging Face commit SHA for that run. It fetches both safetensors headers for a byte inventory, and only 6,120 bytes of real block/scale payload for four 2,880-element rows. It never loads the full model. Real-mode results use a separate `evidence/benchmark.json`; synthetic evidence is not overwritten. A successful real-mode sample would still not establish full-model fidelity or quality.

## Research sequence

1. Validate bounded real-weight decoding against the official MXFP4 reference, with immutable source identities and adversarial format checks.
2. Implement deterministic expert routing and use the published top-k selection; evaluate only selected experts at runtime while retaining the complete weights. Active parameter count does not mean other expert weights can be discarded losslessly.
3. Benchmark weight access from persistent on-chain storage separately from calldata-fed arithmetic. Measure routing, attention, nonlinearities, vocabulary projection and continuation state separately.
4. Integrate one complete block, then full-model inference with the published tokenizer and numerical policy. Measure reference agreement and task quality.
5. Evaluate more aggressive quantization, expert pruning and distillation as separate, lossy research variants. Compare task quality against an unmodified reference; do not label a distilled student as the original GPT-OSS model.
6. Benchmark Solidity and, if supported on the target chain, Stylus using identical inputs and explicit arithmetic semantics. Publish measured costs, not assumed speed multipliers.

## Primary sources

- Model and license: https://github.com/openai/gpt-oss
- Official MXFP4 decoder: https://github.com/openai/gpt-oss/blob/main/gpt_oss/torch/weights.py
- Reference model: https://github.com/openai/gpt-oss/blob/main/gpt_oss/torch/model.py
- Target configuration: https://huggingface.co/openai/gpt-oss-20b/blob/main/config.json
- Model card: https://openai.com/index/gpt-oss-model-card/

The official configuration currently describes 24 layers, 32 experts per layer, top-4 routing, hidden width 2,880, 64 query heads and 8 KV heads. These are architectural inputs to the research, not measured optimization outcomes. GPT-OSS-120B is a later scaling target; the current implementation is an arithmetic prototype for the 20B investigation.
