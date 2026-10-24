# Independent ReLU H265 language review

The recurrent prototype does not yet meet the requested coherent first-person
voice. This is a local language assessment, separate from any gas result.

All tested checkpoints used the same 8,192-word vocabulary. The fixed free-run
screen uses seeds 0, 42, 7 and 123, 128 emitted words, branch temperatures
512/768/1024 Q10, and nominal six-feature inputs. It carries state and never
adds punctuation or resets at a sentence end. Two held-out eight-word authored
prefixes are also continued for 64 words at two seeds and temperatures.

| Checkpoint | Observed language outcome |
| --- | --- |
| 1.006M words | Short recognizable fragments, frequent agreement and predicate errors. All 12 free streams fail usable voice. Monotonic loss improvement justifies continuing the early training experiment. |
| 4.002M words | Slightly better local ordering; all 12 free and 8 held-out streams still fail coherent paragraphs. One pair of different prefixes produces the same last 61 of 64 words at seed 42 / T768. This is weak output-level retention, not proof of identical hidden states. |
| 12.003M words | More correct short clauses but still broken syntax, changing subjects and generic forest stories. All 8 screened free streams fail voice. |
| 20.004M words | Better grammar replay loss, but authored/teacher losses regress relative to earlier checkpoints. All 12 free and 8 held-out streams still fail coherent first-person continuity. |
| Additional 1.007M voice exposure from the best-balanced 8M checkpoint | More `i` openings, but all 12 free and 8 held-out streams fail. All three held-out source losses worsen. Further training with this same voice-finish recipe is unsupported. |

No screened output has an exact normalized twelve-word match to the retained
training split. One 12M output contains the common six-word sentence “she felt a
spark of hope,” which occurs in four training records. These checks do not prove
semantic novelty. Zero repeated four-grams does not imply meaningful prose: an
incoherent stream can have no repeated phrases.

There is no production decoder winner among these ReLU checkpoints. The files
retain every raw output and manual review, including failures. A separately
trained gated recurrent model is a comparison, not a claim that gating alone
will solve language quality.
