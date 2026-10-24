# Independent GRU language review and technical selection

**No tested GRU checkpoint passes the coherent-language requirement.** The early
voice checkpoint is retained only for the local arithmetic and gas benchmark:

`gru-h224/training/runs/voice-v3-1m/checkpoint-08253456`

Its weight SHA-256 is
`1444fac961a8228b87c111920869d51ec09cd7a5a16786a35e07bda983765347`.
The benchmark decoder uses the existing hierarchical sampler at temperature
256 Q10. It does not use the optional offline retry control.

The selected snapshot follows 8,253,456 cumulative supervised words, including
251,328 words of the new voice mixture after the 8M checkpoint. On the same v3
validation batches, balanced cross entropy moves from 5.2986 at the initial
8M checkpoint to 5.2868 at selection, then worsens to 5.3314 at the end of the
voice phase. Authored loss improves from 5.4426 to 5.3343, while grammar and
teacher loss worsen slightly. Those are validation tradeoffs, not evidence
that the model has acquired a coherent personality. Scores on v2 and v3 batches
should not be compared as if they were identical evaluations.

All compared models use the same 8,192-word vocabulary. The cell is a signed
H224 reset-after GRU with no recurrent bias. Independent finite differences
confirm the float formula's gradients for the checked inputs, and the convex
update preserves the [-1,1] state bound. Arithmetic correctness is separate
from language quality and the later Q10/EVM checks.

The fixed free-run diagnostic used two seeds, 96 words and temperatures
128/256/384 Q10 for the 8M baseline, final 20M model and final voice model.
The selected checkpoint additionally received a two-seed T256 screen. Matching
held-out prefixes were continued for 64 words at T256. Every raw output is
retained in the adjacent `gru-*` folders.

- The 8M model produces occasional grammatical clauses but broken agreement,
  incomplete predicates and generic children-story drift.
- The final 20M model improves grammar replay loss to 4.2945, but authored and
  teacher losses regress. Low-temperature output still contains statements such
  as `i have a very idea that all wrong` and loses a stable subject.
- The final voice model more often starts with `i` and uses room, market and
  machine vocabulary. It still produces `i became care about a new words` and
  fails to maintain an intelligible paragraph.
- The selected early voice model is not visibly a language-quality winner. Its
  T256 output briefly resembles a monologue, then turns into an unrelated story
  about a boy and a map. It is a conservative technical checkpoint chosen before
  the longer voice update worsened the measured balance.
- None of the compared held-out continuations preserves the joke or attention
  premise as a coherent ongoing account. Different prefixes affect the outputs,
  but numerical dependence alone is not semantic continuity.

Lowering temperature suppresses some lexical noise but can add repeated phrases.
The bounded offline four-gram retry test on the final 20M model does not fix
meaning: one seed reaches all eight retries at word 79, and its last candidate
still repeats. No global-beam experiment was warranted because the low-temperature
screens did not show a clear coherent paragraph to preserve. Neither decoding
change was added to the EVM model.

Normalized twelve-word and complete-sentence copy checks are recorded per output
against the retained v3 training data. They measure exact overlap only; absence
of a match does not prove originality or understanding. This is a small fixed-seed
screen, not a population-level success-rate estimate. No mainnet action is part
of this review.
