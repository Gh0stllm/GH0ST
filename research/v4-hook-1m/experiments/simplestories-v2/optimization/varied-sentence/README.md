# Varied SimpleStories sentences: local experiment

Selected continuous-story implementation: [Relative64](continuity/README.md). This directory also preserves the earlier independent-sentence baseline and its 10,000-output catalog; those results describe a separate decoder.

Status: **the selected Relative64 continuous-story hook passed 2,060 consecutive local PoolManager swaps**, producing 2,073 tokens. Every swap matched the independent reference's token IDs, ending flags, and full-vocabulary logit hash. Maximum whole-swap execution gas was **28,423,709**, below the 32,000,000 transaction limit. Nothing in this directory has been deployed to a public chain.

The current selection prioritizes continuing the story across swaps. It uses the full 1,235,968-parameter Q12 SimpleStories V2 model and preserves the actual generated context. The earlier target of 10,000 distinct independent sentences has separate evidence below; it is not a claim of 10,000 grammatical continuations for every evolving story state.

The published model weights and executable weight tiles are reused unchanged. The experimental decoder samples from logits instead of always taking the highest score. It excludes the unknown token, applies stable top-k selection and an integer temperature/softmax lookup, and uses a reproducible seed. A seed can repeat an output; it does not establish uniqueness by itself.

## Selected continuous-story result

The hook requests two tokens while the processed count is at most 26, then one token per swap. A sentence can span several swaps. Native punctuation or EOS ends the current chunk without resetting the prompt, pending token, or sampling counter.

The model directly attends to the latest 64 positions. Raw cached keys are rotated by their relative age, so there is no 2,048-position rotary-table cutoff; the verified stream crossed positions 2,047–2,050 without resetting. Relative Q12 rotation has a different rounding path from the earlier absolute-position implementation and is checked against its own independent reference. Counters are finite `uint64` values. Historical numerical data contracts and references keep accumulating even though the active attention window is bounded.

| Local measurement | Result |
| --- | --- |
| Successful consecutive PoolManager swaps | 2,060 |
| Generated and processed tokens | 2,073 |
| Exact reference matches | 2,060 / 2,060 |
| Whole-swap execution gas | 10,126,707–28,423,709 |
| Saturated-window whole-swap gas | 28,205,062–28,423,709 |
| Model-call / whole-transaction limit | 29,250,000 / 32,000,000 |
| Automatic context resets | 0 |

Stale revisions and context hashes, forged context, malformed hook data, unauthorized callbacks, changed model code, and tampered active history were rejected. A forced revert after inference rolled back the trade and story state. Other callers and pools remained isolated. Full evidence, source hashes, and limitations are in [the final local report](continuity/relative-benchmark/README.md).

This is one fixed-seed trajectory on an unforked local chain with test tokens. It is not a worst-case gas bound, a live fee estimate, or a broad quality evaluation. The generated story can repeat itself, change characters, and drift into new vignettes. Persistent numerical context does not guarantee a permanently coherent plot or permanent memory.

## Earlier independent-sentence baselines

- The first large four-token screen produced 8,185 distinct naturally terminated texts across five prompts, but included fragments. This is not 8,185 verified sentences.
- The raw sampled decoder matched 32 of 32 independent Q12 token sequences, termination flags and vocabulary-logit hashes. Those parity checks used an elevated local diagnostic call limit and do not establish 32M feasibility.
- Top-k 32 raw sampled generation failed the first 16 normal-gas cases. Smaller top-k 8 completed direct model calls, but four-token sentences exceeded the existing 29M hook inference allowance.
- A five-token, quote-prompt offline screen found 7,759 distinct natural endings from 65,536 seeds. A conservative manual review accepted 120 of 150 distinct-output examples. This sample is not an exhaustive grammar guarantee.

## Cache experiment

The cached variant computes a fixed starting prompt on-chain during construction and stores only numerical attention state and vocabulary scores in a data contract. No finished sentences or selected answer seeds are stored. Later calls sample from those scores and calculate subsequent tokens with the model. This reuses prompt computation; it must not be described as recomputing every inference step from scratch during each swap.

The independent-sentence candidate also computes numerical states for each of the 64 possible first-token branches. Each swap samples its first two tokens from those on-chain states, then runs fresh model steps to finish up to five tokens. The immutable caches contain signed numerical attention values and logits, not complete sentences or chosen answer seeds. This remains a separate decoder from the selected continuous-story implementation.

All 64 branch payloads matched independent Q12 calculations byte for byte. The model constructor used 28,806,038 gas; every branch preparation fit under 32M, with a maximum of 13,529,285 gas. This preparation is separate from swap inference and is not free.

That decoder's final local v4 run completed 256 distinct five-token fixtures plus a repeat at 27,588,702–28,134,414 gas (median 27,867,681). All transactions were capped at 32M gas, with a 29.25M model-call allowance. Three incomplete controls reverted atomically. The 260 attempts matched the independent integer reference's tokens, ending flags, and full-vocabulary logit hash. Missing/tampered cache, model runtime, malformed seed, and rollback controls also passed. These are gas and numerical-correctness checks; punctuation alone does not prove grammatical quality.

## 10,000 distinct outputs

An exact offline run tested 331,776 seeds: 123,181 naturally terminated outputs, 25,777 distinct exact strings, and 11,708 word-distinct outputs passing the revised grammar heuristic. `quality/catalog-v2-10000.json` selects 10,000 of those outputs. Deduplication ignores case, whitespace differences, and final punctuation. The fixed starting prompt is a quotation mark; the displayed words are generated by the model.

All 10,000 selected outputs were reproduced as real local EVM calls bounded at 29.25M gas. `benchmark/catalog-v2-10000-evm.json` combines 9,968 unchanged rows from the full 10,000-row baseline with 32 replacements verified on the same model in a fresh isolated EVM. Source, artifact, catalog, and execution-evidence hashes are recorded. This is 10,000 model-call proofs, not 10,000 swap transactions.

This is an evaluation catalog, not a runtime answer table. The model contains no list of these sentences or their selected seeds. Arbitrary seeds may repeat, produce fragments, or yield awkward English. An independent review of the earlier 150-row catalog sample found 136 clearly acceptable, ten questionable/context-dependent, and four rejected; the subsequent filter addresses general grammatical flaws, but is not a guarantee of perfect English. The catalog does not prove absence from the training corpus.

This baseline resets its prompt on every call and does **not** carry a story from one swap to the next. The selected Relative64 implementation above has now demonstrated retained context, state persistence, swap gas, and stale-preview protection locally. The independent-sentence catalog remains separate evidence. The earlier fixed-sentence mainnet plan remains explicitly on hold.

## Evidence

- `kernel/`: experimental model variants.
- `benchmark/`: isolated local EVM hooks, runners and gas/parity reports.
- `quality/`: independent integer reference, seed provenance, diversity measurements and review samples.
- `continuity/`: selected Relative64 continuous-story implementation and earlier comparison variants; baseline sources and evidence remain frozen.
- `portable/`: compact published-file runtime reconstruction and isolated reproduction tests.

All public-chain deployment, token approvals, pool initialization and liquidity changes remain outside this experiment.
