# Voice v6 independent evaluation

This directory holds evaluation data and reports only. Its reference paragraphs
and continuations must never be included in training, vocabulary fitting, or
training-data generation. They are not a response bank and are not used by the
on-chain model.

The previous model's correct arithmetic and low gas did not establish language
quality. The main failure was broken syntax and loss of meaning over a paragraph,
even when first-person words appeared frequently. Evaluation must therefore
inspect complete unedited streams, not select attractive short fragments.

Use a small fixed checkpoint gate first: two unprompted streams of 128 words,
then four fixed narrative prefixes continued for 96 words with one fixed seed.
For a candidate that passes that gate, evaluate all twelve prefixes, two seeds,
and at least two uninterrupted 256-word streams. Keep temperature, sampling,
features and source hashes explicit. Read all outputs. Do not stop generation at
punctuation or silently reset state.

The human rubric separately scores grammar, continuity, voice and repetition.
Absurdity and personification are allowed when a reader can understand the
sentence and follow its implications. Word salad is not treated as comedy.
Automatic scores report exact overlap and repetition without declaring a quality
pass on their own. Numerical conditioning on old state is necessary but does not
prove that a story retains its meaning.

Before training begins, freeze the evaluation manifest. When the new corpus is
ready, scan all splits for exact copies of prompts/references and their longer
spans, report source-family overlaps, and manually read a deterministic sample.
Training and validation text can share everyday words and broad subjects with
these tests; they must not contain the held-out paragraphs or their continuations.

The binary-tree decoder has a distinct limitation: temperature is applied to
each branch probability, not to complete word probabilities. At temperature one
it is a valid hierarchical word distribution. At lower temperatures, greedy
local branches need not select the globally most likely word. A bounded beam is
a separate decoder experiment with separate gas and parity checks; it must not
be credited to the current on-chain sampler.
