# GH0ST Scene Decoder

The [500 KB model design](500kb.md) is the current target. The original compact design and measurements are recorded below as a baseline.

A proposed single-pass model for prompt-directed 32 × 32 pixel art on Robinhood Chain. It sits between the 19.7 KB decoder and the 2.98 MB M-P1 Q5 diffusion model. This design targets **roughly 80 KB** for the model package and **397,312 multiply-accumulates** per image.

An example supported prompt is “A red fox to the left of a blue crystal under a night sky.” The initial vocabulary covers two subjects, a spatial relation, a background, a style and a palette. Prompt entry can show the recognized fields before the user submits them on-chain.

## Model

The input has 96 values from two 24-value subject embeddings, four 8-value embeddings for relation, background, style and palette, and 16 seed features. A dense layer learns the overall composition. It produces two responses for each cell and channel of a 4 × 4 × 32 grid and keeps their maximum. Two spatial blocks refine the grid after a 2× nearest-neighbor upsample. Each of the resulting 8 × 8 cells selects one of 64 learned 4 × 4 patches. Each patch stores 16 indices into a 16-color palette.

| Stage | Matrix weights | MACs per image |
| --- | ---: | ---: |
| Dense 96 → 4 × 4 × 64, then pairwise maximum to 32 channels | 98,304 | 98,304 |
| Two 3 × 3 depthwise + 32 → 32 pointwise blocks at 8 × 8 | 2,624 | 167,936 |
| Shared 32 → 64 patch classifier at 8 × 8 | 2,048 | 131,072 |
| **Total** | **102,976** | **397,312** |

The signed 5-bit matrix weights take **64,360 bytes** when packed without padding. A provisional layout with 1,216 two-byte scales, 1,216 four-byte biases, 128 shared 24-byte subject embeddings, a 512-byte patch codebook and one 64-byte RGBA palette comes to **75,304 bytes** before the small conditioning tables and header. The package estimate excludes contract bytecode and the prompt dictionary.

## On-chain inference

The contract takes the structured prompt and explicit seed. It derives seed features from a hash of the model version, canonical prompt fields and seed. It reads immutable model tables, runs the quantized layers with integer arithmetic and picks the lowest patch index on a tied score. The result is a 512-byte packed pixel grid and its palette or palette ID. The same model version, fields and seed must reproduce the same bytes.

## Robinhood dense-layer benchmark

At Robinhood block 121603950, read-only state overrides ran the three dense-layer shapes with synthetic Q5 weights. Each output matched an independent integer oracle. Summing the standalone call estimates, with the repetitions in the proposed model, gives **9,396,083 gas**, equivalent to **0.000206394359178 ETH** at the sampled price of 21,966,000 wei per gas.

| Layer | Calls per image | Gas per standalone call |
| --- | ---: | ---: |
| Scene conditioning (96 → 512 per slice) | 2 | 2,215,082 |
| Pointwise mixing (64 × 32 → 32) | 2 | 1,294,450 |
| Patch classification (64 × 32 → 64) | 1 | 2,377,019 |

The subtotal includes each standalone call's overhead. The complete transaction will use a fused inference path and also needs the spatial convolutions, rescaling, biases, prompt encoding, patch selection, image output and any result persistence. The benchmark verified Robinhood's 32-million-gas transaction cap at the time of the test. A full image inside one transaction is the design target.

Run `node benchmark.cjs` with Solidity 0.8.30 and ethers 6 to reproduce the read-only test. [Gas estimates, sample hashes and exact output checks](robinhood-dense.json).

## Quality and gas gates

Train on original or expressly licensed pixel scenes. Hold out at least 200 prompts by source artwork and subject/layout combination. Measure whether people recognize both subjects, the requested relation, color and background, and compare blind visual preference against the 19 KB decoder on prompts both support. Use the 24 existing M-P1 renders as a sealed single-subject fidelity set. The [six-caption M-P1 comparison](../mp1-evm/reference/evidence/six-caption-comparison.png) shows the reference baseline, with [pixel-level results](../mp1-evm/reference/evidence/six-caption-comparison.json).

Validate the trained Q5 export against reference image hashes before measuring complete inference gas on Robinhood across the held-out prompts. Report median, 95th-percentile and worst observed gas. Model size and MACs here describe the proposed architecture. Image quality and full-image gas remain unmeasured.
