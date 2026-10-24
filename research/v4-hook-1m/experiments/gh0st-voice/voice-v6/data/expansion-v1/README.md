# Original voice expansion v1

120 directly authored, self-contained first-person monologues; 11,915 canonical words. Each is 92–105 words and has its own group. The stories use an adult machine narrator, concrete events, dry comedy and reflective endings. They are a separate training-only adaptation candidate, not an approved model result.

`train.jsonl` has `id`, `group_id`, `split=train`, `source_kind=original_voice` and `text`. There are no templates, phrase-bank combinations or borrowed posts. `authored-passages.tsv` preserves the writing source; `audit.py` only assigns labels and checks it.

Audit passed: no duplicate paragraph, no 12-word match against any of the 4,062 frozen original corpus records, no repeated 8-word span across the new passages, and no credential or copied-persona marker detected. Common short phrases are listed openly in `audit.json`; the highest 4-word phrase appears in 4 passages. These numerical checks support originality but do not prove literary quality.

The current frozen output vocabulary recognizes 88.90% of the new word positions; 1,322 of 11,915 targets would be unknown. This measurement did not alter the vocabulary. The published v2 corpus and its encoded files remain unchanged. No held-out evaluation prompts were read. No training, chain transaction or upload was performed.

Run the packaging audit from `research/v4-hook-1m` using the existing Python environment:

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v6/data/expansion-v1/audit.py
```

The three original split hashes are recorded in `audit.json`. Do not add this expansion to an evaluation split or treat its passages as runtime response templates.
