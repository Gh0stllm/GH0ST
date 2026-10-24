# Frozen language replay data

This is a local training dataset, not a trained-model result. `prepare_language.py`
preserves source text and uses the existing N0VA vocabulary and parser to make
word/punctuation targets. It retains the full frozen SimpleStories training,
validation and test partitions and their original generation-group identities.
The pinned upstream card declares MIT licensing; `SOURCES.json` and `licenses/`
preserve that source attribution. The stories were model-generated. The local
holdouts are separate for this replay stage; they are not claimed unseen by the
original SimpleStories pretraining.

Known training targets are 70% grammar, 25% authored voice and 5% prior causal
curriculum, within rounding of one whole source document. Voice oversampling
is explicit: 140 original authored training episodes become15,009 training rows.
Those repetitions are not independent new stories. The curriculum contributes
4,317 selected combinations from288 authored clauses; it is not represented as
4,317 independently authored narratives.

All20,045 grammar-training stories remain. About6.44% of their lexical tokens
are outside the fixed vocabulary. Unknown lexical losses are masked, but their
context positions and punctuation targets remain. Authored training OOV is
about1.84%. Source text is not rewritten to reduce those rates.

Grammar uses domain1; voice/curriculum use domain0. The exported conversational
voice remains domain0. Authored validation/test sets contain20 episodes each;
grammar validation/test retain2,427/2,528 stories. Both kinds appear in combined
files and also have separate holdout files for honest per-domain reporting.
`manifest.json` records hashes, source splits, exact counts and word fractions.
No model training, network access or chain operation was performed to prepare
these files.
