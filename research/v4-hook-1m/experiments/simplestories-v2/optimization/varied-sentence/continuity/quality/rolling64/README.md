# Rolling 64-token continuity reference

Historical absolute-position Rolling64 reference. The selected [Relative64 reference](../relative64/README.md) uses only relative ages and has no 2,048-position table cutoff. This directory remains the frozen comparison baseline.

This is an offline, independent numerical reference for the experimental
SimpleStories V2 rolling-attention model. It does not deploy anything or establish
that a swap fits the network gas limit. The separate EVM and v4 reports measure
those properties.

`rolling64-140turn-reference.json` is the current fixture. It follows one ongoing
stream for 140 turns, producing 154 tokens from initial input token `[3]`. It uses
seed 42, top-k 8, and temperature 800/1000. A turn asks for two tokens while at
most 30 tokens have been processed, then one token. Native EOS or sentence-ending
punctuation stops that turn early. The last generated token remains pending input
for the next turn; neither punctuation nor a fresh prompt is inserted.

The sampler's draw index counts all tokens generated so far. Consequently, chunks
are deterministic portions of one continuing sequence. They are usually not full
sentences by themselves. The decoded aggregate and per-turn pieces are both saved.

## Attention and positions

At every layer and absolute position `p`, attention reads K/V positions
`max(0,p-63)..p`, including the current token. Historical K/V values retain their
original computation. They are not recomputed from a newly cropped text window.
RoPE uses absolute positions 0 through 2047. No positional rebasing, tail refresh,
or reset occurs in this fixture.

This deliberately changes the original full-attention semantics after position
63. It also permits older information to influence a retained K/V indirectly;
64 is the directly attended window, not a promise that all earlier information
has vanished. Behavior at the 2048-position limit needs an explicit policy.

The checkpoint weights remain unchanged. `tables-2048.bin` extends deterministic
position tables and preserves the nonlinear lookup data. Its size is 133,128 bytes
and SHA256 is
`97a56ba07d3587fe4cfdd1c482e530398754d4d43b5421d67be3bc96251b5741`.

## Independent checks

`build_reference.py` computes the stream with an incremental K/V implementation.
It separately evaluates a full-prefix implementation with a causal rolling mask
at positions 0, 1, 15, 31, 63, 64, 65, 95, 127, 128, and 149. All 4,019 logits
and all 128 final hidden values match exactly at each checkpoint. Every turn
includes its full-vocabulary ABI logit hash for EVM comparison.

Changing only the initial token, while holding all subsequent processed inputs
fixed, changes the full logits at position 95. `history_controls.py` also checks
the same random draw against explicitly changed recent context. These establish
that history affects computation; they do not establish reliable storytelling.

`rolling64-reference.json` is an earlier 150-position diagnostic using the slightly
different threshold `processed < 32`; use the 140-turn fixture for the current hook.

## Actual generated examples and limits

These complete sentences occur in the saved aggregate stream:

- “the sky turned orange and pink.”
- “they ran through the grass, laughing and splashing.”
- “alex pointed to a flower that shimmered.”

The stream carries adventure and garden themes over many turns, but it introduces
Kim, Mia, and Alex without robust identity tracking and repeats enthusiasm. One
stream is a functional continuity demonstration, not a language-quality benchmark.

The earlier 10,000-entry catalog concerns independent sentences with top-k 64,
temperature 1000/1000, and a fresh quoted prompt. It does **not** demonstrate
10,000 unique grammatical continuations for each state of this top-k 8,
temperature 800/1000 ongoing stream. Neither experiment proves novelty relative
to training text or guarantees unique outputs on every swap.

Run from the research root:

```sh
experiments/gpt2/.venv/bin/python experiments/simplestories-v2/optimization/varied-sentence/continuity/quality/rolling64/build_reference.py
experiments/gpt2/.venv/bin/python experiments/simplestories-v2/optimization/varied-sentence/continuity/quality/rolling64/history_controls.py
```
