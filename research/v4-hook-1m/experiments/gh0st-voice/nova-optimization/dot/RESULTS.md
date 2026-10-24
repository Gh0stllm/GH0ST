# Exact N0VA dot-product optimization

These are isolated local EVM measurements. No network was forked, no public RPC
was used, and no public transaction was submitted. All model data runtimes were
injected with `hardhat_setCode`; deployment gas here is therefore only the model
constructor, not the price of deploying its weight data.

The neural parameter values, quantization, activation rounding, sampling and API
are unchanged. `unroll48.sol` removes the packed-dot loop. `core-combined.sol`
combines this with the root agent's exact assembly data reader and activations.
`simd11-unroll35.sol` additionally uses the independently checked 11-lane data
encoding from `../layout/simd11`, with 35 unrolled packed multiplications per row.
Its model-data commitment changes because its byte encoding changes.

| Variant | Zero-state direct step | Extreme-state direct step | Mixed-state direct step | Runtime bytes |
|---|---:|---:|---:|---:|
| Original SIMD8 | 20,964,552 | 21,107,802 | 21,174,650 | 14,862 |
| SIMD8 unroll48 | 17,204,802 | 17,348,052 | 17,414,900 | 15,523 |
| SIMD8 unroll48 + reader/activation assembly | 14,520,150 | 14,660,429 | 14,722,916 | 15,226 |
| SIMD11 unroll35 + reader/activation assembly | 13,321,016 | 13,461,295 | 13,523,782 | 15,806 |
| SIMD11 unroll35 + pinned flat-page reader | 12,610,619 | 12,750,898 | 12,813,385 | 18,127 |

Each optimized variant returned exactly the same complete ABI bytes as the
original model for all three vectors. The comparison includes all 768 recurrent
state values, all 197 evaluated branch logits, token ID, punctuation ID, emitted
text, and terminal flag. Boundary vectors exercise both state endpoints, feature
endpoints, minimum/maximum temperatures, and the beginning-of-stream token.

The final `simd11-flat.sol` also caches the first catalogue page for each matrix
in four private immutable values. Every matrix has fewer than 1024 data shards,
so the pinned first page is its only page. Its dot reader copies directly from
that pinned page's shard addresses and computes the packed sum in one assembly
block. The constructor still validates all original catalogue sizes and hashes;
this change removes repeated root-to-page lookups, not validation.

The flat variant passed **23 complete-return comparisons**: three initial
vectors, 16 additional varied vectors, and four targeted branch-tail vectors.
The additional vectors cover all-state endpoints, alternating endpoints, sparse,
ramp and random states, features at both endpoints, previous words across the
vocabulary, punctuation classes, temperatures from 64 to 4096, and the largest
uint64 sequence. The maximum direct gas across all 23 was **12,894,626**.

The four tail vectors explicitly sample token IDs 0, 63, 8128, and 8191,
covering the first and last words of groups 0 and 127. Their seeds were found by
an offline search using the model's original sampler; runtime logits and
sampling were not altered. Full output parity includes the resulting comma,
period, question mark and exclamation classes across the complete test set.

Flat source SHA256:
`1ee3a4dcb586c4e2d04026bb55daece53121e46f6a4f5162ccebaaf967c6a2c8`.

This is a direct-model benchmark. It does not by itself prove whole-swap gas,
two-swap block packing, or contract integration security; those remain the root
integration harness's responsibility. The existing guards are preserved in these
model variants.

Reproduce from the research project root:

```sh
node experiments/gh0st-voice/nova-optimization/dot/benchmark.mjs
node experiments/gh0st-voice/nova-optimization/dot/benchmark.mjs core
node experiments/gh0st-voice/nova-optimization/dot/benchmark.mjs simd11
node experiments/gh0st-voice/nova-optimization/dot/make-flat.mjs
node experiments/gh0st-voice/nova-optimization/dot/benchmark.mjs flat
node experiments/gh0st-voice/nova-optimization/dot/benchmark.mjs flat-more
node experiments/gh0st-voice/nova-optimization/dot/benchmark.mjs flat-tail
```

Evidence is in `results.json`, `core-results.json`, `simd11-results.json`,
`flat-results.json`, `flat-more-results.json`, and `flat-tail-results.json`.
The SIMD11 row coefficient proof is in `../layout/packing-proof.json`.
