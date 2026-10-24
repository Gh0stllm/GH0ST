# SimpleStories V2 under 32 million gas: local results

The full **1,235,968-parameter** SimpleStories V2 model completed real local Uniswap v4 swaps below a **32,000,000 gas transaction limit**, with one input token processed per swap and persistent attention memory between swaps. The longest tested context, 16 tokens, used **26,599,994 gas**. No public-chain RPC, signing, deployment, or mainnet transaction was used for this optimization experiment.

This establishes a local **one-token-per-swap** implementation. It does not establish that a whole question and answer, or a complete sentence, can run in one swap. A ten-token question requires ten separately paid swaps to produce its first completion token. Language quality is unchanged.

## Measured results

All figures below are transaction receipt gas, including the local router, actual v4 PoolManager, hook, model execution, settlement, and emitted validation data. The streaming measurements also include persistent cache writes. They exclude model deployment costs and any target network's additional data fees.

| Test | Gas per transaction | Result |
| --- | ---: | --- |
| Original stateless model, one input and one output | 179,978,646 | Baseline exceeds 32M |
| Optimized stateless model, one input and one output | **19,725,577** | Pass; **89.04% less gas** |
| Streaming, first four generation steps | **21,651,823–22,574,982** | All four swaps pass |
| Streaming, ten-token question reaches first completion | **24,574,092** on swap 10 | All ten individual swaps pass |
| Streaming, same question through four completion tokens | Maximum **25,576,676** across 13 swaps | All 13 individual swaps pass; total 306,550,395 gas |
| Streaming, full 16-token context | **26,599,994** on swap 16 | All 16 individual swaps pass |
| Next swap after the 16-token limit | **20,321,097** | Automatic reset passes |
| Optimized stateless model, ten-token question and one output | 110,660,388 | Still exceeds 32M |
| Optimized stateless model, one input and four outputs | 141,259,613 | Still exceeds 32M |

The stateless cases above 32M were diagnostic measurements with explicitly increased limits on an isolated local node. Every successful streaming swap used a 32M transaction ceiling, a 32M block ceiling, and a 29M model-call budget; no elevated limit was used in the streaming run. A separate in-memory cache variant lowers the one-input/four-output batch to 78,339,885 gas, which also remains above 32M.

## What changed

1. **Exact packed multiplication:** up to eight losslessly packed weights share a 256-bit multiplication. A runtime input-range check selects the fast path, with exact scalar arithmetic as the fallback.
2. **Less memory and call overhead:** tiled vocabulary projection, unrolled dot products, assembly RMS normalization, and assembly attention preserve the existing integer equations.
3. **Exact stateless pruning:** the last transformer layer skips work for earlier positions that cannot affect the final prediction; its required keys and values are retained.
4. **Persistent attention memory:** the streaming variant computes each new token through all four layers and all 4,019 output logits, while reusing previously computed causal keys and values. Each input writes 64 packed storage words, preserving every signed int32 component.

The original checkpoint, all trained parameters, Q12 weight values, and full vocabulary remain unchanged. There is no retraining, distillation, vocabulary reduction, cached answer list, or external inference service. Q12 remains an approximation of the original FP32 checkpoint; exactness claims here compare against the independent Q12 reference.

## Verification

- **37 successful v4 swap steps** matched all 128 final hidden values and the complete 4,019-logit hash against an independent reference: 4,736 hidden-value comparisons and 37 full-vocabulary hash comparisons.
- Prompt prefill, four-token continuations, 16-token context, and automatic reset were exercised.
- Forced low-gas failures, including a failure partway through inference, rolled back pool state, balances, hook state, model metadata, and all **1,024 possible cache words**.
- Caller namespaces and pool sessions remained isolated; direct unauthorized hook calls were rejected.
- Source and data hashes matched the measured artifacts. Thirteen original artifacts were checked before and after the runner; nine critical originals were independently rechecked afterward.
- Model runtime is 13,815 bytes; hook runtime is 4,493 bytes. Both satisfy EIP-170's 24,576-byte runtime bound. Weight data uses separate bounded runtime shards.
- Tests used unforked Anvil, chain 31337, Cancun execution rules. This is a local EVM result, not a Robinhood deployment result.

## Output quality and limits

With prompt `The`, four swaps produced `boy had lost his`. With `Question: What color is the sky? Answer:`, ten prompt-processing swaps plus three additional swaps produced `" i am not`. Both outputs hit the configured four-token output cap; neither is a completed sentence or useful factual answer. Gas optimization does not make this story model a question-answering model.

The prototype uses a fixed prompt configured in the hook and a pool-shared stream. It automatically restarts after EOS, its output cap, or the 16-position context limit. Repeated deterministic cycles can repeat the same output. User-specific questions, longer contexts, and production interface integration are outside this experiment.

The measured prefixes all fit below 32M; this finite sample does not prove the same bound for every possible prefix. The exact scalar fallback can be slower for other activation ranges. Required inference reverts the whole swap if its budget is exceeded.

The packed representation trades storage for cheaper execution: weight data grows from **2,471,936 to 6,258,016 bytes**, plus 3,080 bytes of unchanged tables. The runner injects verified data shards locally; their deployment cost was not measured. The 32M comparison concerns execution gas, not a dollar-price guarantee or full target-chain fee estimate.

## Files and reproduction

- Selected [streaming model](kernel8streaming/SimpleStoriesV2ModelOptimized.sol), [cache protocol](kernel8streaming/STREAMING_PROTOCOL.md), and [v4 streaming hook](benchmark/SimpleStoriesV2StreamingHook.sol).
- [Complete streaming receipts and assertions](benchmark/streaming-benchmark.json), [streaming summary](benchmark/streaming-result-summary.json), and [independent reference](benchmark/streaming-reference.json).
- [Stateless comparison](benchmark/result-summary-pruned.json), [complete stateless run](benchmark/gas-benchmark-final.json), and [memory-cache batch run](benchmark/gas-benchmark-swar8cached.json).
- [Machine-readable combined result](result-summary.json).

From the `research/v4-hook-1m` directory, with existing local dependencies installed:

```sh
node experiments/simplestories-v2/optimization/benchmark/run-streaming-benchmark.mjs --anvil
```

The runner starts its own loopback-only Anvil node, verifies chain 31337, uses no fork, and stops the node when finished. It refuses to replace a service already listening on its reserved port. Re-running overwrites its local benchmark report; it does not broadcast to a public network.
