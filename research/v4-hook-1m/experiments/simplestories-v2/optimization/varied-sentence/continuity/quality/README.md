# Continuous story reference

Early absolute-position continuity controls. The selected [Relative64 reference](relative64/README.md) removes the fixed position-table cutoff. The results below preserve earlier experiments and their limitations.

This directory tests whether later model output depends on the actual tokens produced in earlier swap-sized turns. Everything is offline. It uses the unchanged SimpleStories Q12 weights and the exact integer sampling rules from the sampled model.

The original checkpoint supports 2,048 positions. The earlier EVM port limited its tables and inputs to 16. `continuous_stream.py` extends only the deterministic Q12 RoPE tables and reference input bound to 128; it does not train or change learned parameters. `extended-rope-proof.json` checks that the original positions and nonlinear tables remain exact, including all 4,019 logits and 128 hidden values on the tested original-length prefixes.

## Twenty turns with retained history

`continuous-stream-reference.json` records three 20-turn stories. Each turn samples at most **two new tokens**, so a sentence normally spans several turns. A constant seed is combined with the global generated-token index. Punctuation and EOS are fed back as actual context; they are not replaced with a fresh prompt.

Each full-context run retains its entire history for all 20 turns, without a refresh. The three runs produced 37, 38 and 38 tokens. None emitted EOS. Twelve controls used the same next sampling seed and index with either the actual history or a reset prompt: all twelve changed the next sampled tokens and the full vocabulary logits. This establishes contextual dependence, not perfect narrative reasoning.

For example, with the initial input **“Mia found a key”**, the first five turns were:

1. `in a`
2. `bottle.`
3. `she could`
4. `take the`
5. `key.`

Across 20 turns, the generated continuation was:

> in a bottle. she could take the key. " this is it! " she shouted. the treasure was buried in her pocket. but as she searched, she felt something was missing.

The key and character carry into later turns. The phrase about treasure being buried in a pocket also shows the model's limited language quality and logic. The full raw per-turn transcripts are in `continuous-stream-transcripts.txt`; text is not silently repaired for presentation.

## Bounded history and refresh

The comparison in `continuity-screen.json` shows the difference between stopping at the old 16-token limit, recomputing a 16-token sliding window, retaining a three-token tail at refresh, and keeping the full tested history. Small-tail refreshes can lose characters and plot details even though they preserve recent words.

`continuity80-boundary-reference.json` follows the proposed 128-position state machine for 80 turns. It produces 151 tokens and refreshes once, **before turn 69**, when the processed KV count is 128. It recomputes the actual last three tokens, `what if we`, as the new context and keeps the global sampling index. It emits no EOS in this run. Older context is discarded at that boundary, so this is bounded continuing context, not unlimited long-term memory.

`continuity20-fixtures.json` is the compact quote-prompt, seed-42 fixture set for matching the EVM prototype. It includes exact output token IDs, final full-vocabulary logit hashes, pending-token state and processed-KV counts for each turn. Gas, transaction behavior and storage rollback require separate EVM tests; these offline results do not establish a 32-million-gas bound.
