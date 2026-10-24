# Individually assistant-authored continuity episodes

This corpus contains24 original episodes written by the assistant for this
experiment. It is **not human-authored** and was not produced by combining
templates, sampled teacher output, or borrowed posts. Each episode follows a
first-person machine narrator through a particular event and its consequences.

There are7,147 words:18 training episodes with5,211 words,3 validation episodes
with916 words, and3 test episodes with1,020 words. Episodes are249–341 words long
and contain23–24 complete sentences. Of575 sentences,562 (97.7%) have8–16 words;
the remaining13 have17–18 words. The sentence-length mean is12.43 words.

Theme families were assigned before drafting. The six training families concern
digital boundaries, consent, memory, attention, rituals/status, and traces/repair.
Validation reserves collective decisions. Test reserves ownership/departure.
There are three episodes per family and no group shared across splits. Each row
contains `id`, `group_id`, `text`, `split`, and
`source_kind="assistant_authored_continuity"`. A later encoder should explicitly
map this source kind to the original-style/domain0 track rather than accidentally
treating it as general adult prose.

All24 episodes received author self-review for a stable central object or goal,
causal progression, grammar, and a specific ending. `self-review.json` records
that review per episode. It is not independent human annotation and does not
demonstrate that a trained model will reproduce the same quality. The narratives
are fictional creative examples, not factual assertions about a deployed project.

The audit found no exact duplicate episode, no shared12-word sequence between
episodes, and no use of the excluded story entities. No held-out evaluation
prompts were read or reused. No GPU, network, model sampling, or training call
was used to produce this corpus. Validation and test text must remain out of
training and vocabulary fitting.

Run `python3 -B audit.py` in this directory to reproduce structural checks,
file hashes, and optional coverage against the existing frozen vocabulary.
`manifest.json` binds the three source files, preassigned family plan,
self-review, and audit source. No runtime template, grammar rule, or manual
sentence substitution is part of this data.
