# Explicitly approved teacher-data preparation

`prepare_distillation.py` is a data converter, not a quality gate. It must only
be invoked on real candidates after an external semantic/continuity/copying
review has passed. No real candidate conversion or student training was run
while this converter was prepared.

The inputs are the immutable encoded curriculum directory, a candidate JSONL,
the canonical prompt-ancestry JSONL, and a JSON list of approved candidate IDs
(or an object containing `approved_ids`). The approved set must be nonempty,
unique, and completely present in the candidate file. Only those IDs are added;
every other candidate is omitted. Approval is never inferred from automatic
candidate filtering or file presence.

The exact frozen8,192-word vocabulary is required, with SHA-256
`940734e6971ecba0960a5b11b4dc5f8604c0a00e4078340c7f002abbec886e9a`.
It is copied without refitting or reordering. Each teacher paragraph is parsed
using V8 `prepare.parse`, marked `kind="teacher"` and `domain=0`, and given its
canonical prompt's split and group ID. Conflicting ancestry, duplicate IDs,
cross-split groups, and teacher text duplicating any existing normalized text
are rejected. Validation/test descendants remain in their inherited splits.

Original encoded JSONL files are copied byte for byte before the selected
teacher rows are appended. Original vocabulary counts retain their values;
the new `teacher` counts use training rows only. Unknown teacher words remain
input-unknown positions with their punctuation intact. The manifest records
input hashes, exact approved IDs, omitted candidate count, source statistics,
OOV rates, unchanged base-prefix hashes, parser hash, and output hashes.

After quality approval, example invocation from the training directory:

```sh
python3 -B prepare_distillation.py \
  --base ../../voice-v7/training/encoded-curriculum \
  --candidates /absolute/path/to/candidate-paragraphs.jsonl \
  --prompts ../teacher-notes/prompts.jsonl \
  --approved /absolute/path/to/approved-ids.json \
  --out /absolute/path/to/NEW-encoded-teacher-directory
```

The output must not exist or be inside the base directory. Grammar pairs are a
separate step after approval: run the existing `build_grammar_pairs.py` against
the new `train.jsonl`. The old sidecar cannot be reused because its source hash
will differ. The builder already treats `teacher` as a separate source kind.

Four toy-fixture tests cover exact approved selection, base byte preservation,
inherited splits/groups, unknown retention, absent IDs, conflicting ancestry,
duplicate text, wrong vocabulary, and cross-split prompt groups. Fixtures reuse
only the public frozen vocabulary; they do not read generated teacher candidates
or held-out evaluation prompts.
