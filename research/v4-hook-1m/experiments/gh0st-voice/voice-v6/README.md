# Voice V6: local training and one-word v4 hook experiment

**Execution passes; language quality fails. This is an experimental checkpoint, not an approved replacement for the live model. No mainnet transactions or deployment changes were made.**

The selected model appends one generated word on every successful local swap while preserving its recurrent state. It meets the 32M complete-swap gas limit in these tests. It still produces malformed clauses, generic repetition and topic drift, so it does not meet the requested coherent first-person voice.

## Completed results

| Check | Result |
|---|---|
| Corpus | 1,001,411 normalized word positions, 4,182 documents |
| Original voice data | 50,226 words in 919 original passages, including 120 new 92–105-word monologues |
| Training | Apple GPU; 26,597,917 known-target word presentations across the compared runs |
| Selected model | 4,014,560 learned parameters; 12,008,587 foundation + 1,006,452 style-phase word presentations |
| Local complete swaps | 256 primary + 4 secondary, two callers, one word per successful swap |
| Complete swap gas | 27,901,073 maximum; 27,629,976 primary mean; 32,000,000 limit |
| Exact runtime checks | All 224 hidden values and 192 evaluated logits match on every swap; guards, rollback and pool isolation pass |
| Exhaustive export checks | Every source weight, 5,505,696 fused values, 8,192 vocabulary rows and both lookup tables pass |
| Additional generation stress | 34 uninterrupted streams, 10,240 words, including two 1,024-word streams |
| Held-out language challenge | 0 of 24 generated streams meet the chosen quality standard; 2 additional prompts are not fully representable |
| Semantic retention | 0 of 3 representable counterfactual pairs retain the changed fact reliably |

The small exact-repeat rate does not establish good language. The longest exact training-text match in the 10,240-word stress test is seven words, but meaning still drifts. Distinct outputs also do not guarantee originality or 10,000 distinct coherent sentences.

## What changed and what was learned

The earlier tiny examples were replaced by a larger adult first-person corpus, with separate original-voice and adult-prose conditioning. A new 128-by-64 adaptive word head replaces the earlier binary decisions. Training keeps complete paragraphs and input-only unknown words; it masks only their target loss. The runtime folds the selected voice-domain bias into exact Q20 input projections and performs recurrence and word selection in Q10. It reads learned weights, not a sentence bank or off-chain language API. Each swap advances one word; it does not promise a full sentence per swap.

The foundation run was planned for 40M word presentations, but full validation regressed twice after the 12M checkpoint. It was deliberately interrupted after the saved 20M checkpoint. `training/runs/foundation-40m/controlled-stop.json` explains the retained raw interruption status. The 50% voice adaptation was tested through 4M new words; the voice-only control used 2M. The earliest 1M mixed-style checkpoint had the lowest full-validation macro loss. All reviewed settings still failed open-loop grammar and continuity. More training on this setup did not solve the requested writing quality.

The final test split was used only after checkpoint selection: 323 full documents, 70,236 known targets and 7,366 masked unknowns. Macro known-target NLL is 5.085652. This teacher-forced score is not a coherence pass.

## Reports and exact artifacts

- [Machine-readable result](RESULTS.json)
- [Independent language review](evaluation/FINAL-QUALITY-REVIEW.md)
- [Full-validation comparison](evaluation/foundation-style-validation-comparison.json)
- [Final local swap evidence](evm/adaptive/FINAL-SELECTED-RESULTS.md)
- [Final gas and state summary](evm/adaptive/style-selected-final-256-summary.json)
- [Independent complete export audit](exports/style-selected-1m/exhaustive-export-audit.json)
- [10,240-word stress summary](exports/style-selected-1m/stress-t512/summary.json)
- [New original monologues](data/expansion-v1/README.md)
- [Raw generated samples](SAMPLES.txt)

Selected float SHA-256: `703be567704c8c899c3fe4d7cb5e3ab206c8f6ed83dde65dfd4208e4adbeec76`.

Published weights are aliased under `training/selected/` and `exports/selected/`. Other checkpoints retain reports and samples without duplicating all weight files. Run `python3 restore-compressed.py` after checkout to restore the compressed JSONL datasets. The local source-acquisition directory is intentionally excluded; licensed frozen text, source URLs and attribution are published. The parent corpus milestone is commit `12ebe1165ec09ba54ada85a0ede661621010981e`.

The gas measurements use actual local Uniswap v4 swaps on chain 31337. Model-data code is injected into that isolated test chain; the swap figures exclude deploying the data shards and are not a mainnet gas guarantee. Runtime state remains continuous, including across natural sentence endings. Repeated words are possible. There is no claim that this finite test covers every possible future state.

## Frozen base-corpus card

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

The frozen splits, expanded encoding, training and local gas tests have now been independently reviewed. The data scripts themselves perform no training or chain transactions; the completed training/evaluation results appear above. No mainnet action was performed.
