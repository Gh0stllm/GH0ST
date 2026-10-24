# Complete sentences in one local v4 swap

**Short complete sentences now fit below 32,000,000 gas in one real local Uniswap v4 swap.** The full 1,235,968-parameter SimpleStories V2 model, its Q12 weights, four transformer layers, and all 4,019 output vocabulary entries are retained.

| Configured input | Fully generated output | Generated tokens | First successful v4 swap gas |
| --- | --- | ---: | ---: |
| `:` | `some are good.` | 4 | **28,368,333** |
| `Because` | `everyone was happy.` | 4 | **28,374,622** |
| `"` | `he said.` | 3 | **21,388,483** |

The input is a separate prompt; none of its words are included in the output column. Every output word and the final punctuation are predicted by the model inside the same swap. Sentence casing is not applied to these quoted, native tokenizer outputs.

Every reported pass uses a **32M transaction and block gas limit** and a **29M model-call budget** on an unforked local Anvil chain, ID 31337. The totals include the router, actual v4 PoolManager, hook, fresh model inference, token settlement and emitted result. No prompt processing, intermediate state or sentence output is taken from an earlier transaction. No public-chain RPC, mainnet transaction, signing, deployment or GitHub publishing was performed for this experiment.

## What made this fit

The previous memory-cached model still needed 78,339,885 gas to emit four tokens from a one-token prompt. Additional ordinary kernel changes helped, but an initial complete three-token sentence still cost 37,447,637 gas and a four-token sentence cost 49,442,743 gas.

The selected implementation compiles the unchanged matrix weights into **282 small executable EVM contracts**. Each holds exact packed weight constants and straight-line multiplication instructions. The model calls these contracts for matrix products, reducing the repeated loading, indexing and loop work. These are numerical weight kernels, not stored sentences or a lookup table of answers.

Other exact changes reuse packed inputs across Q/K/V and gate/up projections, retain causal keys and values only in memory during the call, reuse the vocabulary output buffer, simplify mathematically redundant first-position attention, and use a 256-byte scratch buffer on the fast path. The full scratch buffer is allocated only if the exact slower fallback is needed.

The successful hook configurations cap generation at four new tokens, while still requiring the model to predict native `.`, `!`, `?` or EOS. The cap does not add punctuation or turn a fragment into a sentence. If the model has not naturally terminated by the cap, the required-sentence hook reverts the whole swap.

## Correctness and limits

- The original checkpoint and every Q12 learned weight are unchanged. No retraining, distillation, reduced vocabulary or lower-precision replacement was used.
- An independent Python interpreter executed all 282 numerical bytecode tiles against the original signed-int16 matrices: **8,795 rows, 43,975 output comparisons**, including signed extremes, zero and random inputs. All matched; malformed calldata was rejected for every tile.
- Actual local EVM kernel tests separately cover both matrix widths, signed values and truncated signed division. The full swap runner compares generated tokens and complete vocabulary hashes to the independent Q12 reference.
- The optimized result remains an approximation of the original FP32 checkpoint because the existing Q12 port already is. Exact parity refers to that Q12 reference.
- These examples establish **short-sentence feasibility**, not that arbitrary-length sentences or question answering fit within 32M gas. The model's language quality is unchanged, and fixed prompts generate repeatable greedy outputs.
- The tested context limit is 16 tokens. The fast multiplication path checks its supported activation range; the exact fallback may cost more. A successful result for these prompts is not a universal gas guarantee.

The longer controls did **not** fit. With the same final model, `the boy felt a spark of hope.` required **58,288,496 gas** for eight generated tokens, and `a bright sun shone over the city of green hills.` required **81,696,751 gas** for eleven. Both failed the normal 32M transaction test; those costs come from explicitly elevated local diagnostic transactions. They are not 32M successes.

Across the short and long runs, **30 independent prefix states** matched all 128 hidden values and the complete 4,019-logit hash. The short sentences also passed repeat swaps. Incomplete output at a two-token cap and forced inference failures reverted with pool state, balances and hook state restored. Original-file integrity and per-contract runtime-size checks passed, and all benchmark nodes were stopped.

The compiler produces 6,413,507 bytes of executable weight tiles, each at most 24,000 bytes. The selected model also retains 6,258,016 bytes of packed weight data for embeddings, norms and exact fallback, plus 3,080 bytes of tables. **Deployment cost is not included.** The benchmark installs and verifies these runtimes on the local node before measuring inference; this is not a claim of free or cheap deployment.

## Evidence and implementation

- [Selected model](codeweights-v2/SimpleStoriesV2ModelOptimized.sol)
- [Required-sentence v4 hook](benchmark/SimpleStoriesV2SentenceHook.sol)
- [Full successful short-sentence benchmark](benchmark/gas-benchmark-codeweights-v2-short.json)
- [Longer-sentence limits](benchmark/gas-benchmark-codeweights-v2-long.json)
- [Independent sentence references](quality/reference.json) and [additional references](quality/additional-reference.json)
- [Executable-weight format and arithmetic](codeweights/KERNEL_NOTES.md)
- [All-tile verification](codeweights/all-tiles-proof.json) and [local EVM tile tests](codeweights/tile-kernel-tests.json)
- [Earlier unsuccessful complete-sentence tests](benchmark/gas-benchmark-sentences-initial.json)
- [Machine-readable final summary](result-summary.json)

To reproduce the successful cases from the research project directory, with its installed Node dependencies and the Anvil binary configured in the runner:

```sh
node experiments/simplestories-v2/optimization/full-sentence/benchmark/run-sentence-benchmark.mjs --anvil --kernel=codeweights-v2 --label=codeweights-v2-short --cases=quote,colon,because --max-new=4 --port=18564
```

The runners and source remain in this `full-sentence` directory. They use loopback-only local Anvil nodes. The command overwrites its local report; it does not publish or deploy to a public network. All 123 files from the preceding GitHub publication were independently checked and remain unchanged.
