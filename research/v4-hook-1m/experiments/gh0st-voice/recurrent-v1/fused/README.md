# Exact recurrent input fusion

The local prototype emits the **same word on every tested swap** as the unfused
H265 model while reducing mean whole-swap gas from19,974,107 to10,773,835.
This is a computation/storage tradeoff, not a new model or language-quality gain.

| Same 30-swap sequence | Unfused | Fused |
|---|---:|---:|
| Successful swaps, one generated word each | 30 | 30 |
| Mean whole-swap gas | 19,974,107 | 10,773,835 |
| Maximum whole-swap gas | 20,293,147 | 11,092,705 |
| Natural terminal words | 2 | 2 |

Actual features, every output token, all265 hidden values and all13 visited
decoder scores are identical across both local runs. Both preserve state
through natural punctuation. Rollback, stale/malformed input, model-tamper,
authorization and pool-isolation tests pass. A separate integer reference also
matches every fused step.

## Computation

The original Q10 step computes, before division and activation:

`wx @ embedding[previous] + wh @ hidden + wf @ features + bh * 1024`.

The first and last terms depend only on the previous token. The exporter saves
their exact integer sum for each of8193 possible input IDs. The runtime reads
that row and computes only `wh @ hidden + wf @ features`, then performs the same
single truncating division by1024 and ReLU clamp. No rounding order changes.

Each derived value occupies five signed big-endian bytes. Even the worst
265-product signed-int16 dot plus bias fits signed40. The exporter checks all
2,171,145 values for representability and roundtrip equality;67 rows also match
explicit scalar Python sums. No clipping is applied.

## Honest storage accounting

The checkpoint still has **4,492,256 learned parameters**. This equivalence
prototype retains all original parameter blobs and adds **10,855,725 bytes** of
derived input values. The derived2,171,145 scalars are not independent learned
parameters. The runtime does not read the original input matrix or embedding
table during inference; retaining those blobs here only supports the first
equivalence experiment and should not be treated as a model-capacity benefit.

The prototype installs839 data shards locally. Its model constructor used
23,926,257gas, below the32M cap, and its runtime is8116bytes. All data-shard
deployment costs remain excluded from swap gas. A future compact export can
omit unused original runtime blobs while preserving source weights and hashes
in the repository; that compact deployment has not been tested here.

`exports/baseline` contains derived data and links to the frozen original
parameter files. `evm/fused-prototype-local.json` records actual local swaps;
`evm/fused-prototype-reference.json` records independent numerical checks.
`evm/fused-prototype-summary.json` binds these reports and the unfused report.

This prototype uses the earlier100-update capacity weights, whose language
quality is not approved. It is not a mainnet deployment or a gas result for a
newly trained checkpoint.
