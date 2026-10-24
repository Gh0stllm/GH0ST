# Static grammar replay comparison

This corpus preserves the existing V7 encoded curriculum and appends the full
previously frozen SimpleStories grammar replay plus24 assistant-authored long
continuity episodes. It is a separate preparation for the two-layer H384 trial,
not new GPT-2/Qwen-generated training data and not evidence of model quality.
The grammar replay was already used in earlier one-layer experiments.

All25,000 frozen replay stories are retained:20,045 train,2,427 validation,
and2,528 test. The pinned source manifest and declared MIT license provenance
are copied under `provenance/`. The upstream stories are model-generated; they
are not human-authored GH0ST voice examples. Their source splits and generation
groups remain intact, with namespaced IDs to prevent accidental collisions.

Replay uses the trainer's generic `kind="teacher"` field and runtime domain0.
The name denotes a data source here, not a newly run teacher or semantic quality
approval. The24 new continuity episodes use `kind="original"`, domain0, and
their original18/3/3 family split. Their explicit source kind remains
`assistant_authored_continuity`.

The exact8,192-word vocabulary is unchanged. Its SHA-256 is
`940734e6971ecba0960a5b11b4dc5f8604c0a00e4078340c7f002abbec886e9a`.
Training replay contains3,252,200 parsed word positions, including209,524 unknown
words (6.4425%). All19,967 replay training documents containing unknown words
are retained. Unknown input positions and every punctuation target remain;
only their unavailable lexical targets use the established loss mask. No
sentence or document is discarded to improve vocabulary coverage.

Base JSONL files remain unchanged byte prefixes of the new split files. All
other base source kinds and domains are untouched. Training counts add replay
only to `teacher` and new authored training words only to `original`.
Validation/test words never contribute to training counts. The preparation
checks source hashes, exact IDs, family splits, and normalized cross-split text
overlap. All checks passed with zero cross-split group or exact-text collisions.

Reproduce into a new directory from the V8 training directory:

```sh
python3 -B prepare_replay.py \
  --base ../../voice-v7/training/encoded-curriculum \
  --replay ../../large-v3/recovery-v5/grammar-replay \
  --authored ../data/authored-continuity/style \
  --out NEW_OUTPUT_DIRECTORY
```

`manifest.json` binds source and encoded split hashes, vocabulary, parser,
per-source OOV counts, and unchanged base prefixes. `preparation-report.json`
provides the compact result; `loader-check.json` records CPU loading and stream
checks. No GPU, training, network, or chain action was performed in preparation.
