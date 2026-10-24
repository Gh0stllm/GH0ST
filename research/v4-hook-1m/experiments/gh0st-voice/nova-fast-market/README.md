# N0VA fast-market research: complete sentence per swap

**Target: 10 swaps per second, each producing a complete new neural sentence, with the same 8,175,493-parameter model. The target is not demonstrated. Nothing was deployed or submitted to a public chain.**

All learned Q10 weights, vocabulary, sampling rules and recurrent calculations remain unchanged. Every word and terminal punctuation comes from the neural model. A sentence is complete only when the model emits terminal punctuation; a word cap never inserts punctuation or commits a partial sentence.

## Measured EVM results

| Measurement | Result |
| --- | ---: |
| Optimized direct inference, 23 exact comparison cases | 9.127–9.431M gas per word |
| Optimized complete one-word swap, 32 swaps | 10.432M mean; 11.084M maximum |
| Complete 20-word sentence, original sentence loop | 213,637,355 gas |
| Same complete sentence, bounded reusable buffers | 184,768,539 gas |
| Same sentence, aggregate sentence event instead of per-word score logs | 183,624,960 gas |
| Complete sentence attempted with a 32M transaction/block limit | Reverted; all trade and neural state rolled back |

The 184.77M sentence measurement deliberately raised only the isolated local diagnostic block limit to 512M, with a 500M transaction allowance. **It is not a valid 32M swap, a deployment configuration or a demonstration of ten swaps per second.** The actual 32M test reverted at 19,147,772 gas because the remaining gas could not satisfy the next word's original reserve requirement. It committed no sentence, word logs, pool movement or balance changes.

The compact event variant also fails safely within 32M. It retains every per-word output check and state hash, but publishes only the completed `SentenceSpoken` event; it avoids logging 197 diagnostic scores for each word. The final text, state and sentence hash match independent scalar replay. This is an output-size optimization, not skipped neural work or validation.

The saved Robinhood snapshot from October 24, 2026 at 09:23 UTC has a 7M gas/second pricing/congestion target. Ten complete swaps per second would need about 700,000 gas per whole swap merely to fit that entire target. The best measured EVM 20-word example would demand approximately 1.84 billion gas/second at that rate. The snapshot was not refreshed during this work, and a pricing target is not a measured hard transaction-admission limit.

## Exact execution optimizations

- Nine wider-lane layouts were tested. The selected representation uses ten 25-bit lanes and accumulates five packed products before extraction. All 4,523,904 repacked dynamic weights were independently compared with the original values; no values were clipped, pruned or requantized.
- The two GRU layers use assembly loops, bounded caches for six matrix streams, exact pre-rounded activation tables, and an equivalent integer sampler. Feature and vector packing loops were unrolled. The final model matched every returned byte across 23 boundary/random cases; 65,545 activation cases and 200 sampler cases also passed.
- Hidden state uses 37 storage words instead of 48, with an exact 12-bit encoding of the original allowed range. The public state remains 768 signed values.
- The sentence hook reuses fixed buffers for model input, model output, validation input, state hashes, events and sentence text. This eliminates growing allocations while keeping the original bounded decoder and every validation it performs. No memory allocator rewinds are used.

`selected/GRU2SIMDModel.sol` is the tested model; `selected/NovaPoolHook.sol` is the one-word integration control; `selected/NovaSentencePoolHook.sol` is the diagnostic complete-sentence prototype; `selected/NovaSentenceCompactHook.sol` is the aggregate-event variant. All retain the local-chain restriction. Neither sentence prototype meets the requested throughput target.

## Security and correctness evidence

- 64 full PoolManager integration checks passed for the optimized word kernel and packed-state hook, including buys, sells, pool binding, fixed supply, locked LP, malformed models, low gas, slippage, deadlines and reentrancy.
- An independent scalar replay matched every word, all 768 state values and all 197 scores across the 32 primary word trades.
- The real 20-word sentence was independently replayed word by word. Every score, final state, intermediate state hash, previous-state link and neural punctuation matched.
- 35 full PoolManager checks passed with the compact sentence hook and an inexpensive adversarial model. Second-word failures, invalid state/text, gas exhaustion and missing terminal punctuation rolled back completely. Natural completion exactly at the 32-word boundary succeeded. Two queued swaps each committed a whole sentence without interleaving neural state. This fixture used a 1M per-word allowance appropriate to the mock; real-model tests used 10M. The earlier buffered variant passed 34 checks.
- Separate callback and ABI tests checked maximum 33-byte words, a maximum 1,087-byte sentence, negative values, all event bytes and all state hashes. The original 2M reserve, 1.5M decoder limit, model/code hashes, canonical ABI, numeric bounds and vocabulary checks remain.

The mock's 32-word gas result must not be used as real neural inference performance. This is local engineering evidence, not an external security audit.

## Reproduce the EVM tests

Use the repository's Node dependencies and Python/NumPy environment. `prepare-selected.py` restores the earlier published model if necessary, derives the new packing, checks artifact hashes, and copies the reviewed model and hooks. The committed selected sources and manifest record the final hashes; generated large data files are reconstructed locally.

From `research/v4-hook-1m`:

```sh
python experiments/gh0st-voice/nova-fast-market/prepare-selected.py
node experiments/gh0st-voice/nova-fast-market/test-local.mjs --source=selected/GRU2SIMDModel.sol --export=selected --hook=selected/NovaPoolHook.sol --out=word-full-test --budget=10000000 --tx-gas=14500000
node experiments/gh0st-voice/nova-fast-market/test-local.mjs --source=selected/GRU2SIMDModel.sol --export=selected --hook=selected/NovaSentencePoolHook.sol --out=sentence-buffered-test --budget=10000000 --tx-gas=32000000 --sentence-only
node experiments/gh0st-voice/nova-fast-market/test-local.mjs --source=selected/GRU2SIMDModel.sol --export=selected --hook=selected/NovaSentencePoolHook.sol --out=sentence-buffered-security-1m-mock --budget=1000000 --tx-gas=32000000 --sentence-security
node experiments/gh0st-voice/nova-fast-market/test-local.mjs --source=selected/GRU2SIMDModel.sol --export=selected --hook=selected/NovaSentenceCompactHook.sol --out=sentence-compact-test --budget=10000000 --tx-gas=32000000 --sentence-only --compact-sentence
node experiments/gh0st-voice/nova-fast-market/test-local.mjs --source=selected/GRU2SIMDModel.sol --export=selected --hook=selected/NovaSentenceCompactHook.sol --out=sentence-compact-security --budget=1000000 --tx-gas=32000000 --sentence-security --compact-sentence
python experiments/gh0st-voice/nova-fast-market/verify-sentence.py --report experiments/gh0st-voice/nova-fast-market/sentence-buffered-test/sentence-results.json --out experiments/gh0st-voice/nova-fast-market/sentence-buffered-test/independent-neural-reference.json
```

Large receipt reports may be stored as `.json.gz`; decompress with `gzip -dk` before replay. `RESULTS.json` records the uncompressed hashes. Re-running tests replaces only their local output files.

## WebAssembly follow-up

The `stylus/` directory explores the same integer model in WebAssembly. The local prototype is separate from the EVM-tested deployment code. Its exact numerical outputs were compared with the original model, and the official Nitro runtime was then used offline to meter execution and charged code reads. This is stronger evidence than CPU timing, but still excludes the production hook, stored state and pool settlement. On-chain ABI, model identity, immutable data, activation lifecycle and transaction atomicity must be integrated and tested before treating this route as a deployable candidate. See `audit/official-stylus-meter.json` and `stylus/README.md` for the exact measurement assumptions.

The fastest valid candidate uses three exact integer lanes per multiplication and unrolls 32 iterations of the inner dot-product loop. This reduces repeated instruction-metering overhead without changing any model weights, precision, hidden-state arithmetic or sampling. Eight-, sixteen-, thirty-two- and sixty-four-iteration candidates were measured; the sixty-four candidate was slower. Full unrolling exceeded the official validator's local-variable limit and was rejected.

| Official offline WASM measurement | Gas |
| --- | ---: |
| Same 20-word sentence, raw integer kernel | 10,001,077 execution |
| Same sentence, packed kernel | 4,968,343 execution |
| Same sentence, selected unrolled kernel | 3,189,326 execution |
| Selected kernel plus initial memory and cached call overhead | 3,283,871 |
| 16 independent sentences, 11–21 words, known components | 2,098,619–3,419,412 |
| Mean across those 16 sentences, known components | 2,712,043 |

These figures use pinned Nitro v3.12.1, Stylus version 3, an ArbOS 61 scenario, 10,000 ink per gas and 24KB code-data shards. The code-read adapter charges the pinned upstream EVM access formula. The reported known components **exclude the Solidity hook, persistent story state, transaction intrinsic cost and v4 pool settlement**. Chain-specific configuration was not queried. These are not full swap receipts.

At ten sentences per second, the mean known components alone would consume about 27.12M gas/second, 3.87 times the saved 7M pricing target. Even the shortest tested case exceeds the 700k whole-swap budget. The test therefore does not establish the requested sustained throughput. A pricing target is not an impossibility proof or a hard TPS limit.

Every one of the 502 generated words across the numerical suite matched the independent reference, including all 768 hidden values and all 197 logits after each word. The official runtime also matched the complete token and punctuation output of all 16 metered sentences. Those 16 sentences start from zero hidden state with different seeds; they are not a continuous-story workload or a full-pool stress test. Edge and invalid-input probes are recorded separately. This work preserves the model's existing language quality; it does not retrain it or promise that every sentence is different.
