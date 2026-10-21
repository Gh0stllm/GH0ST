# Robinhood-only quality-tolerance update

20 October 2026. The target is the existing Robinhood Chain. Dedicated-chain/genesis alternatives are excluded from the active project. No training, public transactions or paid model API use occurred.

The best new fidelity reference is **8-bit matrix weights with original BF16 non-matrix tensors**. This is a development reference, not a production-ready export or complete on-chain engine. Allowing a small quality change produces better size/fidelity choices than requiring every original weight to remain unchanged, but the total-million-gas deployment target is still unmet.

## New measurements

128 short generations were evaluated: original weights plus three complete-model precision variants, 32 prompts each. The first 16 prompts reproduce the previous development suite; 16 additional probes were fixed before evaluating the variants. The original model's first 16 generations exactly reproduce the previous baseline.

All three exports use affine group-64 matrix quantization with Q24 offsets/scales. Non-matrix tensors retain their exact original BF16 bits. The selective 4/8-bit configuration uses 4-bit feed-forward matrices and 8-bit other matrices, including the shared embedding/output head. All activations and arithmetic remain float32 on CPU. These results do not certify a future fixed-point contract runtime.

| Variant | Packed weight bytes | Lossless Zstd bytes | Same next-token predictions | Same first token | Identical full reply | Mean token KL |
|---|---:|---:|---:|---:|---:|---:|
| int8 | 102,640,017 | 92,861,718 | 98.82% | 32/32 | 25/32 | 0.001719 |
| int6 | 79,890,833 | 72,782,733 | 92.81% | 29/32 | 8/32 | 0.029602 |
| ff4_rest8 | 88,484,241 | 78,701,234 | 83.40% | 20/32 | 1/32 | 0.151891 |

Next-token agreement is measured over **765 positions on the same original-model continuations**. It is NOT task accuracy or a statement that a given percentage of model intelligence is retained. Mean KL measures probability-distribution drift under those same contexts; lower is closer to the original. Full replies are greedy continuations capped at 32 tokens and may be incomplete.

The 8-bit variant preserves 25/32 complete generated token sequences and all 32 first tokens. The 6-bit export is smaller but drifts more. The selective 4/8-bit configuration is larger than 6-bit and performs worse on both agreement and distribution drift. This particular handcrafted allocation is not a useful improvement; it does not rule out a better sensitivity-driven allocation.

## Storage economics

| Variant | Code deposit, packed weights | Code deposit, compressed weights | Modeled candidate RH compressed-shard deployment |
|---|---:|---:|---:|
| int8 | 20,528,003,400 | 18,572,343,600 | 20,167,841,603 |
| int6 | 15,978,166,600 | 14,556,546,600 | 15,808,009,887 |
| ff4_rest8 | 17,696,848,200 | 15,740,246,800 | 17,092,586,739 |

These are standard-Cancun arithmetic projections, using candidate 60 KiB shards. They are not live Robinhood fee quotes. Engine, tokenizer, index, agent, L1 charges and runtime decompression are excluded. The 8-bit Zstd stream is 49.05% smaller than original BF16 payload and would require 1,512 candidate weight shards. The packed uncompressed 8-bit format would require 1,671 shards and approximately 22.23 billion modeled weight-deployment gas.

No Solidity Zstd decoder exists in this project. Keeping Zstd compression at runtime could add substantial repeated decoding gas. Expanding it into permanent code restores the packed/uncompressed code-deposit bill. Therefore the compressed sizes cannot be treated as a finished low-cost inference architecture.

Robinhood's official fee documentation distinguishes execution fees from Ethereum data-posting fees, with both bundled by normal gas estimation. A smaller gas count and a smaller ETH bill are related but different optimization targets. No live all-in price is claimed here: https://docs.robinhood.com/chain/gas-and-fees/

## Quality limitations discovered

The original model already makes clear errors on additional probes. For example, it identifies the Red Planet as “Jupiters” and says to send a payment despite the prompt saying it was cancelled before execution. The 8-bit model can closely preserve these mistakes. Several other answers are cut off by the 32-token evaluation cap, so they are not scored as factual failures merely because they are unfinished.

The existing 14 exact-format checks score 3/14 for the original, 3/14 for 8-bit, 3/14 for 6-bit and 2/14 for selective 4/8-bit. This format score is not general semantic accuracy. None of these observations justifies claiming an autonomous, reliable general-purpose agent. Cancellation, spending limits, recipients and observed balances must remain enforced by contracts regardless of generated prose.

## Research interpretation and next implementation gate

Quamba2 supports investigating Mamba-specific post-training quantization and carefully selected precisions, but its published models and GPU implementations do not validate Falcon-H1-Tiny-90M or establish EVM gas savings. Its small-model embedding experiments and mixed-precision ablations also show why large-model headline accuracy numbers cannot simply be transferred to this project. We did not implement Quamba2, GPTQ, activation rotations or calibration in this follow-up. Primary source: https://arxiv.org/html/2503.22879v4

For Robinhood, use the new 8-bit export as a fidelity reference when implementing packed arithmetic, while retaining the unchanged model as the correctness reference. Keep weights shared across agents, and preserve independently enforced action policies. A full implementation still needs deterministic activation/nonlinear arithmetic, hybrid Mamba/attention state, tokenization, all-layer inference and full-token gas measurements. Further selective precision work should only be accepted after both held-out task testing and numerical validation of the actual contract runtime.

The new evidence supports a promising low-drift weight representation. It does **not** support promising millions of total deployment gas, minimal end-to-end quality loss, or usable conversation latency on Robinhood yet. No new-chain alternative is being substituted for the user's chosen chain.

## Reproduce

Run `quality_tolerance.py` using the existing Python environment and the pinned original model cache. It writes model binaries under `falcon-public-cache/quality-tolerance-exports`, outside the distributable archive. The model revision is unchanged and each binary has a SHA-256 in `quality-tolerance-results.json`. `quality-tolerance-costs.json` holds the corresponding standard-Cancun arithmetic projections; its formula is `costs.layout`. The test's complete prompts, replies, token IDs and metrics are retained in `quality-tolerance-results.json`.
