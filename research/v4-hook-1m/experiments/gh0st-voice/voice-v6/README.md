# Voice v6: adult first-person continuity corpus

**Training status: RUNNING at this publication snapshot.** No trained language-quality result is claimed. Only the completed random-head local feasibility smoke test is available.

Frozen split files contain **989,666 words in 4,062 records**. This is revision v2 of a new local-only dataset, not a trained-model result or an on-chain deployment.

|Source type|Words|Purpose|
|---|---:|---|
|15 public-domain adult memoir, travel and essay books|911,974|Broad connected prose and first-person narrative grammar|
|20 selected contemporary CC0 essays|39,381|Contemporary reflection, software, culture and personal experiments|
|799 distinct original GH0ST passages|38,311|Machine voice anchors, separately labelled|

|Split|Records|Words|
|---|---:|---:|
|Train|3,377|822,435|
|Validation|362|89,610|
|Test|323|77,621|

The adult-prose portion is 951,355 words. 886,510 words occur directly in eligible paragraphs containing first-person markers; adjoining paragraphs supply genuine local context. The label is a lexical selection rule, not a claim that every sentence is autobiographical. Many adult passages contain dialogue or discuss other people.

## What is preserved

Complete prose paragraphs retain original case, punctuation and Unicode after whitespace/markup cleanup. Source and chapter are assigned to splits **before** nonoverlapping chunks are formed. A first-person paragraph may retain its immediate neighbors; gaps break the sequence. Tables of contents, page furniture, verse-like layouts, incomplete list introductions, code, bibliographies, footnotes and third-party block quotations are excluded. Gwern paragraphs with inline quoted runs longer than 15 words are rejected after Markdown rendering, including wrapped lines. Public-domain paragraphs that start mid-sentence in lowercase or contain the specific dialect forms `knowed`/`drawed` are rejected. Exclusions leave explicit breaks; neighboring surviving paragraphs are never joined across them. Short quotations inside authored prose can remain. No sentence is deleted because of an out-of-vocabulary word, and no sentence-ending punctuation is inserted.

All 799 original anchors are copied as full parent text. The old 996 clipped spans are not copied as additional examples. This restores all 706 parent IDs from the earlier authored training set and includes the additional 80 long originals. The two source kinds are `general_adult` and `original_voice`; use them for separate sampling or conditioning rather than teaching the model to claim the human writers' identities.

## Vocabulary tradeoff

The actual 8K vocabulary uses the canonical `training/prepare.py` normalizer and reserves up to 2,000 repeated **training** voice types before filling by overall training frequency. Larger and plain-lexical rows are comparisons under the same policy. Held-out words never choose vocabulary entries. Percentages are unknown-word occurrence rates; the actual encoder can preserve them as input-only UNK and mask those output targets.

|Vocabulary|Train OOV|Validation OOV|Test OOV|
|---|---:|---:|---:|
|8,192 word-plus-ending forms|8.19%|8.96%|9.49%|
|16,384 word-plus-ending forms|3.83%|5.18%|5.65%|
|32,768 word-plus-ending forms|0.97%|3.07%|3.49%|
|8,192 plain lexical words|5.87%|6.45%|6.97%|

Canonical normalization applies NFKD, lowercases, normalizes curly apostrophes, strips combining accents and turns other non-ASCII symbols into word separators before matching alphabetic words with interior apostrophes and optional final `.!?`. Plain lexical counts show the cost of treating punctuation as part of the leaf. The 8K word-plus-ending row exactly matches the frozen encoded vocabulary. Other rows are hypothetical vocabulary comparisons. See `data/canonical-tokenizer-coverage.json`. Long/rare/Unicode words remain in the source records.

## Files and reproduction

- `data/train.jsonl`, `validation.jsonl`, `test.jsonl`: frozen model inputs with source and chapter provenance.
- `data/corpus-report.json`: counts, source/domain distribution, split rule, parent restoration audit, vocabulary coverage and split SHA-256 hashes.
- `data/source-manifest.json`, `ATTRIBUTION.md`, `licenses/`, `raw/`: source URLs, publisher permission evidence and original bytes.
- `data/train-lexical-counts.json` and `train-runtime-surface-counts.json`: train-only counts.
- `data/original-anchor-snapshot.jsonl`: all 799 full original passages with their original groups/splits.
- `data/verification.json`: structural checks; `author-qa-sample.jsonl`: fixed hash-ranked source-spread sample for review.

From `research/v4-hook-1m`, run the existing Python environment:

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v6/scripts/build_corpus.py
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v6/scripts/canonical_coverage.py
python3 experiments/gh0st-voice/voice-v6/scripts/write_data_card.py
python3 experiments/gh0st-voice/voice-v6/scripts/verify_corpus.py
```

The builder requires `markdown-it-py` and the named prior raw anchor files in this repository; their hashes are recorded. Acquisition is a separate explicit step in `scripts/acquire_sources.py`. Publisher files can change, so reproducing frozen bytes should use the saved raw files and manifest rather than silently refreshing downloads.

## Limits and review status

Structural checks pass: no cross-split group, normalized exact duplicate chunk, overlapping paragraph interval, HTML/list/footnote fragment pattern, or scanned credential pattern. These checks do not prove semantic quality or factual accuracy.

Historical English dominates: most words come from 19th/early 20th-century human memoir and essays; some passages contain archaic vocabulary, obsolete attitudes, religion, violence or dated drug/medical claims. This material offers grammar and continuity, not the desired final persona. The modern CC0 essays and original machine passages are much smaller. The original machine texts are authored examples rather than a claim of human experience or access to Truth Terminal's training data. The first frozen revision is preserved in `data/revisions/v1/`. Revision v2 rejected 69 quoted Gwern paragraphs containing 7,541 words and applied the fragment/dialect fixes before encoding. No promise is made that a tiny recurrent model will learn the intended voice from this corpus.

The independent reviewer is evaluating the frozen splits separately. Training and local gas testing belong to separate artifacts. No training, mainnet transaction or GitHub mutation was performed by these data scripts.
