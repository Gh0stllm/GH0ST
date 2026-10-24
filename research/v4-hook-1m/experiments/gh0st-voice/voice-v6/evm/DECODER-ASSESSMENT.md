# Voice-v6 decoder assessment

**Recommendation:** retain the proven fused GRU H224 for the first larger-corpus
comparison. Test a more learnable tree assignment and matched Q10 training before
changing the output architecture. A128-cluster ×64-word head is a credible second
option, but its gas fit and quality gain remain untested.

## What is established

The selected previous checkpoint completed128 actual local v4 swaps, one generated
word per swap, at a maximum22,280,162 gas. All224 hidden values and13 visited
decoder scores matched the independent reference. Twelve natural sentence
endings preserved state. Its language was still malformed and changed subject;
this is a usable numerical baseline, not a quality-approved checkpoint.

Current per-word matrix work is150,528 recurrent MACs,4,032 feature MACs and2,912
output MACs: **157,472 total**. Input projection is exactly precomputed. The
224-value recurrent state compresses all history; keeping it forever does not
provide unlimited semantic memory. Teacher-forced short windows, corpus tone
mixture and float/Q10 mismatch remain possible bottlenecks independent of the head.

## Current tree: valid, but awkward supervision

The data builder assigns vocabulary leaves by reversing13 bits of a selected
frequency/priority rank. Thus the root split is effectively even versus odd
rank, rather than a grammatical or semantic distinction. Frequent words are
spread across both branches, helping branch coverage, but each upper linear
classifier must learn an arbitrary mixture of word types.

Thirteen binary losses form a valid normalized word distribution. The tree is
not inherently broken, and its role in the observed failures has not been
isolated. The cheapest controlled change is a **train-only leaf mapping** that
keeps related usage groups together, compared against a simple frequency-order
control. Keep word IDs and the GRU fixed; store an8192-entry leaf-to-token map
(16KiB), and train the head using the inverse mapping. A new mapping requires
new head training and a new committed export. Re-labeling an existing trained
tree cannot improve it.

## Two-level alternative

Factor the distribution as `P(cluster | state) × P(word | cluster, state)`.
Train cross-entropy over128 cluster logits and64 logits for the target cluster;
at inference sample a cluster and then a word within it. Use separately derived
random draws. Every cluster must contain exactly64 real vocabulary entries,
with a pinned cluster/slot-to-token mapping. No canned text or silent tokens.

| Output head | Dot products per word | Head parameters |
|---|---:|---:|
| Current13 binary decisions | 13×224 =2,912 | 8,191×225 =1,842,975 |
| 128 clusters +64 conditional words | 192×224 =43,008 | 8,320×225 =1,872,000 |

This adds40,096 MACs and29,025 learned parameters. Total matrix work rises25.5%
to197,568 MACs. Scaling the measured baseline suggests roughly27.6M gas before
accounting for two integer-softmax normalizations and changed memory/code reads.
**About28–30M is a hypothesis, not a benchmark.** A full8192-word softmax would
require1,835,008 output MACs and is not a viable scalar-kernel option here.

Frequency-balanced usage clusters may be easier to train than random groups,
but a wrong cluster still excludes the correct word. Build groups only from
training data, preserve function-word and terminal variants sensibly, and
compare held-out loss and matched-seed free generation. Do not assume semantic
grouping improves quality without that comparison.

## Decision gates

First compare the current tree and a usage/frequency grouping under the same
corpus, vocabulary, token budget and fixed-point sampler. Use identical Keccak
draws for float/Q10 comparisons to separate quantization effects from randomness;
training should approximate the actual gate LUTs and truncation if divergence is
material. If grouping and stronger corpus still fail, implement only the proposed
two-level head and measure its worst whole-swap gas before a larger training run.

Final acceptance requires256+ successful local swaps, exact state and all
evaluated-logit parity, natural-terminal continuation, multiple callers and
independent pools, failed-call rollback, boundary arithmetic/shard checks, and
every transaction below32M. A quality pass is separate. No mainnet or external
publication is authorized by this experiment.

Source evidence: `recurrent-v1/training/prepare_data.py`,
`recurrent-v1/gru-h224/training/model.py`,
`recurrent-v1/gru-h224/contracts/GRUWordModel.sol`, and
`recurrent-v1/gru-h224/evm/selected-voice-128-summary.json`.
