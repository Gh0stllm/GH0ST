# N0VA original continuity corpus v10

This corpus provides compact, grammatical first-person stories for a new local
voice experiment. It contains **100 original episodes, 609 sentences, and 9,178
words**. Each episode has six or seven sentences and keeps one event, observation, and
consequence connected. The narrator is a fictional machine with a curious,
reflective, occasionally irreverent voice.

The source was authored directly for this experiment. It is not scraped text,
Truth Terminal text, a quotation collection, a paraphrase collection, or a
bank of sentences expanded by changing nouns. The requested broad qualities
are an odd machine perspective, thoughts about shared belief and internet
culture, an identifiable first-person speaker, and coherent ordinary grammar.

The episodes are deliberately grounded in a small shared world: friends,
screens, public conversations, markets, gardens, making things, and promises.
They avoid the procedural cache/caption/register language that dominated the
previous generated samples. They use complete natural sentences rather than
approved sentence templates. Many stories admit a mistaken first impression
before following the consequence of correcting it.

## Splits

| Split | Episodes | Words | Held topic families |
| --- | ---: | ---: | --- |
| Train | 80 | 7,295 | attention, markets, memes, identity, memory, patience, belief, art, forest, future |
| Validation | 10 | 930 | boundaries, care |
| Test | 10 | 953 | silence, cooperation |

All episodes from a labeled family belong to one split. General concepts,
settings, and first-person language recur across splits intentionally; this is
not a claim of semantic isolation. No episode or sentence is repeated exactly.
The immutable IDs make it possible to report held-out failures precisely.

## Files and reproduction

- `authored-episodes.txt`: literally authored source paragraphs and explicit
  split labels. This is the source of truth; no slot expansion occurs.
- `build.py`: deterministic parsing, minimum integrity checks, JSONL outputs,
  counts, and provenance manifest.
- `train.jsonl`, `validation.jsonl`, `test.jsonl`: one object per complete episode
  with the exact schema `{"id": ..., "family": ..., "text": ...}`.
- `manifest.json`: provenance, file hashes, word and sentence counts, limitations.
- `audit.py`, `audit.json`: independent JSONL audit, family separation, duplicate
  checks, and cross-split five-word-phrase overlap measurements.

From this directory:

```sh
python3 build.py
python3 audit.py
```

Training should preserve whole-episode order and respect the existing split;
randomly splitting sentences would put the same story on both sides of the
evaluation. With a fixed token vocabulary, measure coverage before encoding
and report any dropped or replaced words. Do not silently discard incomplete
words or join unrelated sentence fragments.

## Limits

This is a focused **9K-word** corpus, not a web-scale corpus. An integrity PASS
does not prove that a model trained on it will be fluent. The text is synthetic,
single-author prose; short episode shape and reflective conclusions recur. The
actual model must be sampled for grammar, repetitive openings, excessive moral
summaries, first-person identity, event continuity, and memorization. Model
output is acceptable evidence only when shown without editing.

The corpus does not change inference logic, enforce a sentence through a
grammar engine, provide canned runtime responses, or claim anything about gas.
The neural model must still generate every word. All work here is local data
preparation; there are no chain calls or deployment operations.
