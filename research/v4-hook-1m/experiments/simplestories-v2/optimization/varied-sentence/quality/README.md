# Varied sentence quality research

Historical independent-sentence quality research. The selected continuous-story implementation is [Relative64](../continuity/README.md); the catalogs below are separate capacity evidence, not runtime story responses.

All work in this directory is offline. It uses the unchanged 1,235,968-parameter Q12 SimpleStories model, original 4,019-token vocabulary and original integer reference equations. No checkpoint is trained, distilled or altered. No public transaction is sent.

The initial four-token screen compares greedy decoding, seeded top-k sampling and an explicitly labeled forced-final-punctuation experiment. Forced punctuation produces many fragments and is not the selected approach. The subsequent five-token experiments use only the model's naturally sampled punctuation or EOS.

`exact_sampling.py` implements the experimental Solidity sampler independently: stable top-k ordering, exclusion of UNK token zero, the original integer exponential table, temperature in thousandths and a Keccak draw from `abi.encode("GH0ST_SAMPLE_STEP_V1", seed, step)`. `seed-draws.mjs` builds reproducible local draw buffers through ethers. Their binary buffers and Python caches are local accelerators, not runtime sentence tables or publishable model weights.

`exact-reference.json` contains 32 complete and incomplete cases for direct EVM parity checks. `cached-v4-independent-reference.json` and `cached-five-extended-gas-reference.json` provide independent expected tokens and full-vocabulary logit hashes for local cached-model tests. The extended set balances 256 cases across 40 first-token branches and 225 first/second-token combinations observed among valid five-token samples.

The quote-prompt runs generate the entire visible sentence after a one-token quotation-mark input. Subject-prompt experiments are reported separately: a visible word such as `We` is an input, while the model generates its continuation. Those experiments must not be described as entirely generated text.

## Grammar and uniqueness

Natural termination only proves that the model produced punctuation or EOS. It does not establish good grammar. `grammar_screen.py` is a conservative, explicit post-generation heuristic that rejects obvious fragments, broken wordpieces, dangling function words, repeated adjacent words, missing predicates and several common agreement errors. It never inserts, rewrites or generates text. It can still accept bad language and reject good language; manual sample reviews are saved separately with their source hashes.

For the 10,000-output target, deduplication compares lowercase word sequences after whitespace normalization and removal of final `.`, `!` or `?`. Changing only punctuation cannot increase that count. `assemble_catalog.py` merges disjoint seed runs, applies the exact recorded grammar-filter version, and exports a catalog only when at least 10,000 different word sequences pass it. Every catalog entry retains the original seed, token IDs, prompt and decoding settings. It is a measurement artifact, not a phrase bank used by the inference contract.

The resulting catalog demonstrates finite sampled capacity. It does not guarantee that every arbitrary seed yields good grammar, that a new swap always produces unseen text, or that the text was absent from pretraining. Exact EVM agreement and transaction gas are measured separately in the sibling `benchmark` directory.

## Measured catalog

The final offline screen tested **331,776 distinct seeds**, using 1,511,004 sampled token draws. It observed 123,181 naturally terminated outputs and 25,777 distinct exact strings. The refined conservative grammar screen and punctuation-independent deduplication retained **11,708 distinct word sequences**. `catalog-v2-10000.json` contains the first **10,000** accepted sequences in seed order, retaining their exact seeds, token IDs and decoding settings.

The preferred v2 catalog SHA-256 is `21b07947a975e96a48cc5053e87a189fc2fdc1293173afedc1b3b474db1fa653`. `catalog-v2-10000.metadata.json` records source hashes, source seed ranges, the grammar-screen hash, counts and qualifications. `catalog-v2-10000-review.json` is a fresh deterministic 150-item sample for independent language review. A grammar-screened catalog is not a claim that every retained sentence is flawless English.

The earlier `catalog-10000.json` remains frozen as v1, with hash `455243bbadfba92f65c52168ce8fdd71a082c88855cef44ebbee9a15a73f3819`, so its reviews and EVM checks remain reproducible. V2 replaces 32 entries after general checks for speech modifiers, malformed question tails and subject/reflexive disagreement. The 9,968 shared entries are byte-for-byte identical.

The alternative subject experiment tested 89 visible one-token subject prompts with 4,096 seeds each. It produced 16,535 distinct naturally terminated prompt-plus-continuation strings, but only 5,762 canonical sequences passed the conservative grammar screen. The quote-prompt catalog therefore supplies the 10,000-output result without counting supplied subject words as generated words.

## Reproduction

From the research project directory, use the existing Python environment and Node runtime:

```sh
node experiments/simplestories-v2/optimization/varied-sentence/quality/seed-draws.mjs 262144 5
experiments/gpt2/.venv/bin/python experiments/simplestories-v2/optimization/varied-sentence/quality/exact_diversity.py --prompt '"' --seeds 262144 --top-k 64 --temperature-milli 1000 --max-new 5 --label exact-k64-t1000-cap5-quote-262k
```

The integer reference caches repeated prefix calculations only to speed up this offline screen. Separate seed ranges can be merged without repeating earlier samples. Local cache pickles are trusted outputs of these scripts and must never be loaded from untrusted sources.
