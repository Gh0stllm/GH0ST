# Recurrent voice results

24 October 2026. **The execution target is feasible; the requested coherent voice is not yet achieved.** All training and chain experiments were local. No mainnet transactions, live pool changes or website updates were made.

## New text on every swap

The new adapters require one nonempty generated word on every successful swap. They carry the previous token and the complete recurrent state forward. Punctuation does not reset memory, and the adapter never adds a full stop to disguise an unfinished sentence. Inference failure reverts the swap rather than silently skipping text.

Persisting numerical state is not proof that a model remembers the meaning of a story. The independent language tests found that both recurrent variants still lose subjects and narrative direction.

## Measured local prototypes

| Variant | Source parameters | Actual swaps | Maximum whole-swap gas | Meaning of the result |
|---|---:|---:|---:|---|
| H265 recurrent adapter | 4,492,256 | 30 | 20,293,147 | Old capacity weights; persistent-state protocol and arithmetic check |
| H265 with fixed input math precomputed | 4,492,256 | 30 | 11,092,705 | Exact same words, hidden values and decoder scores as the row above |
| H224 gated recurrent model | 3,983,967 | 4 | 22,283,959 | Two-update smoke checkpoint; architecture feasibility only |
| H224 selected voice checkpoint | 3,983,967 | 128 | **22,280,162** | All 128 generated words, hidden states and decoder scores independently verified |

The final selected-checkpoint benchmark passed all 128 actual local v4 swaps. Each swap produced one word, leaving at least 9,719,838 gas below the 32M cap in this run. State and the previous token were preserved across all 12 natural sentence endings. Rollback, insufficient gas, malformed/stale input, changed model runtime, unauthorized callbacks, token settlement and pool isolation checks passed. The independent reference matched all 224 hidden values and all 13 visited decoder scores at every step, including separate scalar checks of the unfused arithmetic.

The complete raw transcript, receipts, export audit, independent arithmetic report and the summary binding their hashes are under `gru-h224/evm/selected-voice-128-*` and `gru-h224/evm/SELECTED-VOICE-RESULTS.md`. The raw runner status records completion of its EVM stage; the separate reference report records the subsequent independent pass. The selected checkpoint's output remains malformed and drifts into unrelated stories.

Precomputing the input projection preserves the integer calculation exactly. Derived input rows are not additional learned parameters. The H224 artifact stores the compiled projection, recurrent/feature weights, decoder and vocabulary on the local EVM; original input weights remain reference files. Address catalogs avoid thousands of constructor storage writes. Data-shard runtimes are injected into the isolated local node, so these tests exclude the cost of publishing all model data.

## Training and selection

The H265 experiment completed 20,003,520 supervised words plus a separate 1,006,720-word voice adaptation from its earlier best checkpoint. It improved grammar loss but failed the free-generation tests. The extra voice adaptation worsened all three held-out source scores. This recipe was stopped.

The H224 gated experiment completed 20,003,520 supervised words plus a separate 1,006,592-word voice adaptation from its 8M checkpoint. The GPU was used for all full runs. Its original training pass took about 81 seconds through 4M words; the 16M-word continuation took about 215 seconds, including validation, checkpointing and probes. These are workload-specific observed timings.

The retained experimental checkpoint is `gru-h224/training/runs/voice-v3-1m/checkpoint-08253456`: **8,253,456 cumulative supervised words**, not the final 20M checkpoint. SHA256:

```text
1444fac961a8228b87c111920869d51ec09cd7a5a16786a35e07bda983765347
```

It had the lowest equal-source validation loss within the dedicated voice phase before that phase regressed. This is a numerical selection rule for preserving a reproducible experiment, **not approval of its prose**. Comparing scores across different validation revisions is not a controlled model ranking.

## Data and quality limits

- Frozen vocabulary: 8,192 real training words, with no padding or silent output tokens. Every entry occurs in retained training data; actual targets visited by a particular training run are separately recorded.
- Training data retains approximately 2.72M grammar words and smaller authored/teacher subsets. Unknown sentences are excluded as whole sentences; text is never joined across an omitted sentence.
- This round added 116 original longer monologues with 6,897 words. The second set contributes 80 paragraphs and has zero vocabulary misses. Whole theme groups stay within a single split.
- No runtime sentence catalog, remote inference or external grammar repair was added. No actual Truth Terminal posts were copied into the new original corpora.
- Full raw outputs, held-out prefixes, source losses and repetition/copy screens are retained in `evaluation/`. The tested prose still contains malformed predicates, subject changes, generic story drift and repetition. A zero exact-copy score does not establish novelty against every possible source.

**Not approved as a coherent-voice release.** These artifacts establish a stronger local engineering path while preserving the failures needed to assess the next experiment honestly. They do not establish 10,000 coherent unique sentences, reliable question answering or Truth Terminal-level language.
