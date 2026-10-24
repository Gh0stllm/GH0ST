# V6 data and training-path audit

The final V2 corpus is suitable for a bounded new training experiment. This is
not a language-quality approval for the eventual model.

The independent scan found no shared source groups across train, validation and
test, no duplicated normalized paragraphs, and no exact overlap with the frozen
evaluation prefixes or twelve-word spans from their reference continuations.
Twelve deterministic complete records were read. They contain coherent adult
prose and original short monologues. The revision excludes the identified
lowercase-start fragments and obvious historical dialect examples. Much of the
foundation is still historical essay or memoir prose; it is not a million-word
corpus of original contemporary GH0ST monologues.

Encoding preserves every source record, original text and normalized token
position. The tokenizer's Unicode dash/space joining defect was corrected and
checked with em-dash, narrow-space, curly-apostrophe and accented-word examples.
Unknown words remain in context through input-only ID8193. They are not removed
with their sentences and cannot be generated as output words.

| Split | Normalized words | Unknown targets | Known-target coverage |
| --- | ---: | ---: | ---: |
| Train | 822,297 | 67,376 | 91.81% |
| Validation | 89,597 | 8,032 | 91.04% |
| Test | 77,602 | 7,366 | 90.51% |

Original-voice target coverage is 96.62%/95.02%/95.49% for those splits. Training
loss is therefore a **known-target** loss. Checkpoint comparisons use identical
coverage; this loss does not score every raw word.

Eleven of the twelve frozen prefixes are fully represented. Bare `phone` in
case h01 is unknown. That case must be reported as coverage-limited, not quietly
rewritten or used to change vocabulary selection after inspecting the tests.
The deployed model omits the input-only unknown embedding, so an offline prefix
using it is not an exact on-chain prompt reproduction.

The adaptive output objective was compared with a direct implementation on a
small batch containing masked unknowns and a masked warmup target. Total losses
matched exactly; the maximum parameter-gradient difference was 1.42e-7. Known
targets following an unknown input propagated nonzero gradients into its
embedding. The check used dropout-disabled evaluation for deterministic algebra
and pins the audited source hashes in `packed-objective-audit.json`.

The previous selected model fails all six fixed quick-gate cases under the new
rubric. Future candidates must improve complete unedited paragraphs, not merely
the frequency of first-person words. Gas, numerical parity and language quality
remain independent acceptance tests. No mainnet transactions are part of this
work.
