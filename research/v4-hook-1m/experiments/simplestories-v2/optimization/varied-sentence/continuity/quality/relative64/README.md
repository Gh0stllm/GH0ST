# Relative-key continuity reference

This is a distinct Q12 numerical variant of SimpleStories V2. It uses the same
trained weights and carries the actual model state across turns. It is evaluated
offline here; EVM parity, swap gas, and transaction rollback belong to the separate
model and hook benchmark reports.

## Removing the position-table cutoff

Each layer stores raw projected keys and values for its recent history. The query
also remains unrotated. For the current token at position `i` and a historical key
at position `j`, let `a = i-j`. Attention includes only ages 0 through 63. With
Q12 cosine and sine for age `a`, each 32-dimensional key is rotated as:

```text
rotated_first  = trunc((key_first*cos[a] + key_second*sin[a]) / 4096)
rotated_second = trunc((key_second*cos[a] - key_first*sin[a]) / 4096)
score = trunc(dot(raw_query, rotated_key) / 23170)
```

The model then uses the existing Q20 exponential lookup and weighted value sum.
No absolute position indexes a rotary table. The small table covers only 64
relative ages; its size is 6,152 bytes. This removes the old 2,048-position table
cutoff. Counters are still finite `uint64` integers, so overflow requires explicit
safe handling. There is no claim of mathematically infinite storage or lifetime.

In exact real arithmetic, rotating both query and key by their absolute positions
equals rotating only the key by their relative position. In Q12 arithmetic the
rounding order changes, so this variant is **not bit-identical** to the earlier
absolute-position model. New reference outputs and EVM parity checks are required.

## Measured reference run

`relative64-policy26-2060turn-reference.json` is the final hook fixture. It contains
2,060 turns and 2,073 generated tokens.
It starts with input `[3]`, uses seed 42, top-k 8, and temperature 800/1000. A turn
requests two new tokens when `processed <= 26`, then one. Native EOS or `. ! ?`
ends that turn early; the final token remains pending input for the next turn.
No prompt, punctuation, or fresh story is inserted between turns.

The previous cutoff-30 fixture is preserved separately. The final fixture groups
the same verified per-token stream under cutoff 26, selected after gas measurement.
Global sampling steps mean grouping cannot alter tokens or logits. The regrouping
script records the original fixture hash and checks the flattened output exactly.

Every step has a hash of all 4,019 logits. Every turn records its output IDs,
pending token, counters, and end flags. Independent full-prefix evaluation with
the same explicit relative attention equations agrees on all logits and all 128
final hidden values at 15 checkpoints, including positions 2,047, 2,048, 2,049,
and 2,050. The incremental calculation retains historical K/V as originally
computed; it never recomputes a fresh 64-token text window.

Replaying the same 150 input tokens with starting counters shifted by 2,048,
65,536, 2^32, and 2^64-512 produces identical logits and hidden values, with the
sampling counter held fixed. This checks the numerical operation's independence
from absolute position; it is not by itself a test of Solidity chunk headers.

`variant-comparison.json` records nine same-input prefixes against the local FP32
checkpoint with an explicit causal 64-token attention mask. All nine greedy next
tokens agree between relative Q12, absolute Q12, and FP32. Their logits differ.
This small comparison supports numerical plausibility, not a broad quality claim.
The separate floating-point rotation-identity check passes 10,000 random cases.

## Actual language quality

The early sequence sustains a story about Mia and an owl flying together. Actual
complete sentences include:

- “the owl nodded, and together they flew through the sky.”
- “they laughed and played, feeling happy.”
- “they waved goodbye as they flew back home.”

The longer stream drifts through new characters and loosely related stories. It
contains six native EOS tokens, all fed into the next step instead of triggering
a software reset. It also repeats itself and makes semantic errors, including
“magic magic stone” and “i am the cloud of a cloud”. Stored continuity is not a
guarantee of an indefinitely coherent plot. Only 64 recent positions are directly
attended, although their cached states can carry indirect older influence.

The earlier 10,000-entry independent-sentence catalog uses top-k 64, temperature
1000/1000, and a fresh prompt. It does not establish 10,000 unique grammatical
continuations at every state of this top-k 8 ongoing stream. No training-set
novelty or per-swap uniqueness is asserted.

Run from the research root:

```sh
experiments/gpt2/.venv/bin/python experiments/simplestories-v2/optimization/varied-sentence/continuity/quality/relative64/build_reference.py
experiments/gpt2/.venv/bin/python experiments/simplestories-v2/optimization/varied-sentence/continuity/quality/relative64/regroup_policy26.py
experiments/gpt2/.venv/bin/python experiments/simplestories-v2/optimization/varied-sentence/continuity/quality/relative64/compare_variants.py
```
