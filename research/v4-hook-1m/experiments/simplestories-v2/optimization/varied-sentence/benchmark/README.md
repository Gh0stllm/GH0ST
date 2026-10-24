# Sampled sentence hook: local research

Historical independent-sentence benchmark. The selected continuous-story implementation and its final local swap evidence are in [Relative64 continuity](../continuity/README.md). The measurements below remain evidence for this earlier decoder.

These experiments use an unforked local Anvil chain (31337), the actual Uniswap v4 PoolManager, and the test settlement router. There is no public RPC, mainnet transaction, or liquidity change.

## Ready-hook extended baseline

The final `ReadyCachedSampledSentenceHook.sol` adds constructor checks for the model architecture, five-token capability, root cache and every nonterminal branch among the64 root candidates. It pins a readiness commitment and checks the model runtime for both preview and swap execution. See `SECURITY_REVIEW.md`.

The extended run passed256 distinct, preselected, naturally terminated five-token outputs plus a repeated seed. All3 incomplete controls reverted atomically. Every one of the260 cases matched independent Q12 tokens, end flags and the full-vocabulary logit hash. The selected successful outputs span40 first-token branches and225 first/second-token groups.

Whole-swap gas: **27,588,702–28,134,414**, median **27,867,681**. The model-call budget was29,250,000 and every transaction was capped at32,000,000. Artificial zero-fee local blocks prevent test-account depletion; these results measure execution gas, not public-network fees.

The suite also passed missing/tampered-cache constructor rejection, model-code-change preview rejection, malformed seed rejection, exact preview/execution matching, and replay after sequence advancement. Fresh model compilation matches the existing verifier artifact's executable creation/runtime code; only Solidity's IPFS metadata digest differs.

Artifacts:

- `gas-ready-two-prefix-extended.json`, SHA256 `d13c29c3ab561702f4bbba1c393f639bbf533a7468147d74e9b0c4afa7a12884`
- `ready-extended-fixtures.json`, SHA256 `ca8367d13ef309fb60b6502a0ffca1538214083d0e3ee47b14b5d7086eb6b0e5`
- `ready-extended-summary.json`
- `compiled-ready-model.json`, `compiled-ready-hook.json`

Run the final suite and verify its saved results with:

```
node experiments/simplestories-v2/optimization/varied-sentence/benchmark/run-ready-extended-local.mjs
node experiments/simplestories-v2/optimization/varied-sentence/benchmark/finalize-ready-report.mjs
```

The fixtures are selected passing examples, not a random-seed completion-rate sample. They do not establish10,000 unique high-quality sentences. This baseline resets to its fixed quote prompt each time and does not implement story continuity between swaps.

## Two-prefix cached prototype

`CachedSampledSentenceHook.sol` uses an exact caller-chosen 32-byte seed in hook data. Its read-only `preview(seed)` and the swap both call the same pinned on-chain model with the same sampler settings. Pool sequence and block data are deliberately absent from the inference seed, so a preview remains reproducible. The model recomputes the output; neither the frontend nor the hook stores an output phrase list. The experimental hook refuses deployment outside local chain31337.

The two-prefix model computes its fixed prompt cache and 64 possible first-token numerical caches on chain during local setup. These contain attention keys/values and vocabulary logits, not sentences. Every subsequent generation follows the exact sampler and computes the remaining model steps.

The local v4 test used prompt token3 (a quotation mark), top-k64, temperature1.0, at most5 new tokens, a29.25M model budget, and a32M whole-transaction cap:

- All32 selected, distinct, naturally terminated five-token outputs succeeded. A repeated seed also succeeded and reproduced identical output.
- Whole-swap gas ranged from27,597,352 to28,115,033.
- All3 deliberately incomplete outputs reverted atomically. Empty,31-byte and33-byte seed payloads also reverted without changing pool state.
- All36 cases matched the independent Q12 reference's tokens, termination flags and full-vocabulary logit hash, including the3 incomplete cases and1 repeat.
- Previews matched successful execution and remained unchanged after the pool sequence advanced.
- The64 local cache-preparation transactions used865,610,539 gas in total; their maximum was13,529,285. These are setup costs, not swap costs.

The32 complete cases were selected from an offline completion dataset;33 successes out of36 tests is **not** a random-seed completion rate. Punctuation termination does not certify grammar. This test demonstrates the sampled gas path; it does not establish10,000 unique high-quality sentences or mainnet readiness.

Artifacts: `gas-two-prefix-top64-t1000.json`, `cached-v4-fixtures.json`, `seeds-two-prefix-top64-t1000.json`, and the independent `../quality/cached-v4-independent-reference.json`. Run locally with:

```
node experiments/simplestories-v2/optimization/varied-sentence/benchmark/run-two-prefix-local.mjs
```

`SampledSentenceHook.sol` derives a reproducible seed from the pool, next successful sequence, router sender, swap parameters and a caller nonce in hook data. It requires a real model-produced punctuation/EOS token and some content. A capped fragment or model failure reverts the whole swap. The inputs are manipulable; this is language variation, not secure randomness. Native termination does not prove grammatical quality or unique text.

## Initial prototype results

Prompt: `[1703]` (Because). Four new tokens maximum; 29,000,000 model-call gas; 32,000,000 whole-transaction limit.

| Configuration | Attempts | Raw model calls succeeded | Naturally terminated raw outputs | Successful sentence swaps | Unique accepted texts |
| --- | ---: | ---: | ---: | ---: | ---: |
| top-k 32, temperature 0.8 | 16 | 0 | 0 | 0 | 0 |
| top-k 8, temperature 0.7 | 16 | 16 | 3 | 1 | 1 |

Every failed swap rolled back balances, pool state and hook sequence. The single accepted top-k 8 output was `everyone loved.` at 22,937,000 gas. Two four-token raw outputs ended naturally but exceeded the hook's 29M inference budget. Thirteen raw outputs were capped fragments. This prototype does not meet the requested 10,000 unique complete sentences or reliable per-swap sentence generation.

Reports: `gas-top32-t800.json`, `gas-top8-t700.json`. Exact seeds and raw outputs: `seeds-top32-t800.json`, `seeds-top8-t700.json`.

## Independent reference and diagnostic costs

All 32 fixtures in `../quality/exact-reference.json` matched Solidity token IDs, EOS/punctuation flags and the hash of all 4,019 logits. Sixteen have a natural terminal; sixteen are incomplete. Several terminated strings are still fragments in ordinary language. See `fixture-parity.json`.

The following separate local diagnostic transactions used an elevated 128M block/transaction allowance. They are not 32M swap passes:

| Diagnostic | Gas |
| --- | ---: |
| Greedy generation through the sampled source, Because | 28,253,454 |
| top-k 8, temperature 0.7, colon, seed 0 | 30,314,133 |
| top-k 8, temperature 0.7, Because, seed 0 | 30,324,750 |

The original greedy standalone benchmark was 28,252,192 gas. The sampled source's greedy route remains close to that figure; sampling adds material cost.

## Reproduction

From the research project root, use the local Node runtime with:

```
node experiments/simplestories-v2/optimization/varied-sentence/benchmark/run-local.mjs --cases=16 --top-k=32 --temperature=800 --prompt=1703 --label=top32-t800
node experiments/simplestories-v2/optimization/varied-sentence/benchmark/run-local.mjs --cases=16 --top-k=8 --temperature=700 --prompt=1703 --label=top8-t700 --port=18578
node experiments/simplestories-v2/optimization/varied-sentence/benchmark/verify-fixtures.mjs
```

The tools launch and stop their own local nodes. Every mutation asserts the local chain identity. Weight and executable tiles are injected after hash verification; model/hook deployment and swap transactions execute locally. Their data-shard deployment costs are outside these measurements.
