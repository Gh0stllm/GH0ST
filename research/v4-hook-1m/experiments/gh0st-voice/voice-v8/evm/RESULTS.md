# Exact SIMD8 recurrent-model feasibility

**H384 technical feasibility passed. H512 exceeded the32M direct-inference limit. These are random-weight fixtures, not trained language results.**

The runtime remains fully neural: two reset-after GRU layers, a128×64 adaptive lexical head and a five-class learned punctuation head. There are no runtime grammar masks, sentence templates, stored sentences or forced sentence endings.

## Measured H384 result

| Check | Result |
|---|---:|
| Source parameters |8,175,493|
| Primary actual local v4 swaps |4/4|
| Separate-pool isolation swap |passed|
| Persistent hidden-state values |768|
| Independently matched logits per step |197|
| Maximum whole primary swap |23,239,218 gas|
| Mean whole primary swap |22,993,922 gas|
| Direct model inference |20,969,049 gas|
| Model constructor |13,121,298 gas|
| Margin below32M |8,760,782 gas|

All768 states and197 logits matched the independent integer reference on every primary swap. Scalar dot-product checks also passed. The hook used a26M inference allowance and2M callback reserve under a32M transaction/block ceiling. It passed post-inference, low-gas, malformed/stale input, modified-model and unauthorized-callback rejection tests, plus pool isolation. State persisted across every generated punctuation mark.

The random output `smith! room. rebel! accidental?` is only evidence that word and punctuation decoding executed. It demonstrates no language quality.

## Why the earlier attempts differ

The H512 full model's direct call consumed its32M gas limit and reverted. Its failed report is preserved as `simd-h512-feasibility-local.json`. A2.36M-term dot-product microbenchmark fitting below32M does not imply that the complete model fits after gates, feature processing, multiple input-vector preparations, output heads and return encoding.

The first H384 hook attempt used an unnecessarily high28.5M inference allowance plus2M reserve. The hook's EIP150 preflight rejected it before inference. The final passing run lowered the allowance to26M; it did not increase the32M transaction limit. Both reports are retained.

## SIMD arithmetic

Eight hidden values offset by1024 are packed into32-bit lanes. Corresponding weights offset by32768 are packed in reverse lane order. The top32-bit coefficient of one256-bit multiplication contains the eight-term unsigned dot product. The maximum coefficient is1,073,725,440, below2^32, so carries cannot corrupt adjacent lanes. The signed result is recovered by subtracting `32768*sum(hidden+1024) +1024*sum(weights)`. Truncation to Q10 happens only after the entire row and applicable bias are accumulated.

The model prepackages each hidden vector once and reuses a single weight-row memory buffer. Weights use approximately twice the bytes of plain int16 weights, plus a32-byte row sum; they are not eight-times-smaller model parameters. Input word/previous-punctuation projections are still precomputed exactly from the source tensors.

Paged immutable code catalogs allow the larger data set:1024 shard addresses per leaf page, with a small root catalog. The passing H384 fixture used2766 data shards. Data and catalog code was injected locally. The reported constructor gas excludes deploying those shards; no mainnet action occurred.

`export_checkpoint.py` accepts the same17 tensor keys as V7, with dimension384 or512. `reference.py` evaluates the original quantized matrices rather than the SIMD rows or precomputed input rows. Raw reports, template sources, exported source hashes and independent parity are bound by `feasibility-evidence.json`.
