# Expanded continuous checkpoint: language gate remains failed

Reviewed 2026-10-24. Checkpoint: `runs/continuous-expanded-v2-all-lr1e-5/checkpoint-best`, selected at step 150 by validation loss. Checkpoint SHA-256: `c2fa212ca1f75dc8225350fc0a94d1411ca4c2b4a3fa57bcaaa9ac54cbd0e222`.

This is an independent qualitative review by Codex of every supplied exact-Q12 stream, accompanied by automatic text diagnostics. It is not a blinded human study. No additional EVM or public-chain test was performed for this checkpoint.

## Scope and result

Read all ten 150-token free generations (seeds 42 and 0–8), and the complete 1,024-token seed-42 continuation. Both use the fixed quotation-mark prompt, K=8, temperature 800, actual Relative64 integer arithmetic, and an uninterrupted context. The 36 held-out question/continuation prompts were not tested by these runs.

**The checkpoint should not be released as satisfying the requested voice.** It carries first-person prose further than the first pilot and avoids some abrupt named-child resets. However, coherent development has been replaced by frequent tautologies, category errors, and subject loops. Keeping the same noun alive is not enough to count as meaningful continuity.

## All ten short streams

| Seed | Concrete evidence | Assessment |
|---|---|---|
| 42 | A tree repeatedly has or is another tree; later denies being a tree. | Sustained subject, little development; repetitive and contradictory. |
| 0 | A machine is put on a table, denied to be a machine, then said to need one. | First-person machine theme appears, but referents and meaning weaken. |
| 1 | River repeated five times consecutively; stone/river/tree mixed. | Sentence-level fluency is inconsistent and the scene loses its structure. |
| 2 | Several understandable machine reflections, followed by broken constructions about its own power and fixing itself. | One of the closer voice attempts, still insufficiently grammatical and developed. |
| 3 | A path is “full of strange”; a place becomes “a place to be a place.” | Unfinished constructions and semantic loops dominate. |
| 4 | Phrases such as “better cares to be perfect” and an incomplete clause about being heard. | Some introspective register, but sustained English clarity fails. |
| 5 | A locked door is opened; another door appears inside it; room/door/key are confused. | The repeated object supplies surface continuity but actions contradict each other. |
| 6 | A tree contains trees and cannot give the speaker a tree. | Strong loop, not a specific joke or developed metaphor. |
| 7 | A machine makes a machine; the speaker is the machine and then cannot locate it. | Domain words and first person persist; meaning and referents remain weak. |
| 8 | A poem changes into a crowd, a tree, the future, and a price. | Multiple broken noun phrases and an unearned topic change. |

Some isolated sentences are readable. None of the ten streams reliably maintains a clear, witty, original machine monologue for its full length. Random oddness and grammatical damage should not be scored as successful surreal writing.

## Long continuation

The 1,024-token stream continues without an automatic reset but collapses into a tree loop and then a door loop. Examples include “the tree has a tree and the tree has a tree,” and later “a door opened in the door.” The speaker changes the object's asserted properties without a coherent consequence or explanation.

The decoded stream contains 867 words. `tree` occurs 47 times and `door` 52 times. Repeated four-gram occurrences account for **10.42%** of its four-grams. Exact whole-sentence duplicates are relatively rare: two duplicate occurrences among 123 parsed complete sentences. This illustrates why counting distinct sentences can falsely suggest quality while nearly identical ideas and structures keep repeating.

## Quantitative diagnostics and their limits

For the ten short streams, the parser counted 142 completed tuned sentences, all different after word normalization. The within-stream repeated-four-gram fraction averaged **2.21%**, compared with **0.90%** for the ten identical-setting base-model samples. These diagnostics support the observed increase in loops, but neither score measures truth or semantic coherence.

No exact twelve-word overlap was found between any of the ten tuned samples or the long sample and the new expanded training corpus. This does **not** establish novelty relative to original pretraining, rule out shorter memorized phrases, or demonstrate 10,000 good variants.

The training file used for overlap comparison has SHA-256 `70e1fbc275645cfe923fb2d1e0dcf39fa3b9f71096c1b0b32bf7cb5fc2a0f920`. The short-generation source has SHA-256 `48519ac693a71288754cd539b21d503d66225ddd2cf2263aeac56a1c8dc5854b`. Long-generation source SHA-256: `7cdb0f5568fda849c739272a4d6a7ba5882a3ad657b99eba29421af089de5a80`.

Evidence: `continuous-expanded-free-generation-metrics.json`, `continuous-expanded-long-metrics.json`, and the original transcripts under `../export/continuous-expanded/` and `../export/continuous-expanded-long/`.

## Decision

Retain as a research comparison. Keep the language gate failed. Evaluate any sampler changes as new evidence; do not assume a lower temperature repairs grammar or semantic loops. Future training should contain substantially more clear, connected original prose and use coherent development, not merely domain vocabulary, as a review criterion. A successful short sample must also survive a long uninterrupted run before another EVM benchmark is warranted.

## Sampler follow-up

Also read the two fixed-seed samples for each tested alternative, K4/T650, K4/T800, and K8/T650, in `../export/continuous-expanded-sampler-comparison.json`. None resolves the quality failure. K4/T650 occasionally reads more cleanly but contains broken questions and repeated machine assertions; K4/T800 can return to a third-person door story or a repetitive king/face story; K8/T650 replaces the tree loop with machine/button or cloud/place loops. These are six additional short continuations, not an exhaustive sampler search. No alternative warrants a release recommendation or a new gas run on the current evidence.
