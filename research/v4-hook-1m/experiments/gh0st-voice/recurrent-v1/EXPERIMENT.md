# Recurrent voice experiment

The user requires new generated text on every successful swap, persistent story context, and less than 32,000,000 gas for each complete swap. Silent inference-only swaps are excluded. All training and blockchain tests in this experiment are local; no deployment is authorized here.

## Candidate

Reuse the existing H265 recurrent architecture with a learned binary word decoder. It stores 4,492,256 parameters but reads only the selected word embedding and thirteen decoder nodes for each generated word. This is a new training experiment, not a pretrained general-purpose instruction model.

The hook must preserve the previous token and all 265 hidden coordinates across swaps, including sentence boundaries. A monotonically increasing sample index supplies fresh deterministic sampling draws. Punctuation comes from a predicted vocabulary entry: no full stop is appended to make an unfinished phrase appear complete. Failure to obtain a valid word must revert rather than silently skip text.

## Quality gates

- Review full raw generations, including poor runs, from several fixed seeds.
- Evaluate grammar, clause meaning, repetition, first-person voice and continuity separately. A low repeated-n-gram count or validation loss alone does not establish coherent writing.
- Keep training, validation and test source groups separate. Fit vocabulary only on training data and report rejected material and vocabulary coverage.
- Preserve complete sentence spans when an out-of-vocabulary word prevents using a longer document. Never join across a deleted sentence as though it were original prose.
- Inspect recurrent saturation and compare floating-point and exported Q10 behavior. Score quantized output, not only floating-point samples.
- Verify actual Uniswap v4 swaps on a fresh local chain with complete hidden-state and decoder-score parity, rollback, stale-context, malformed-output and pool-isolation checks.

## Interpretation

One generated word per swap satisfies the latest throughput constraint. It does not guarantee a full sentence on each swap, nor that every sentence will be distinct. The earlier H265 prototype's roughly 20M gas result established a possible execution budget; it did not establish language quality. This experiment must earn a separate quality judgment.

The additional long voice corpus is original prose prepared for this experiment. It supplies training examples and never serves as a runtime phrase catalog. Corpus membership is not evidence that generated sentences are original relative to every source ever seen by any previous model.
