from pathlib import Path
from collections import Counter
import json,hashlib
B=Path(__file__).resolve().parents[1];D=B/'data';r=json.loads((D/'corpus-report.json').read_text());m=json.loads((D/'source-manifest.json').read_text());rows=[json.loads(x)for x in(D/'all-records.jsonl').read_text().splitlines()]
by_sub={k:sum(x['word_count']for x in rows if x['source_subkind']==k)for k in set(x['source_subkind']for x in rows)}
r['selection']='General adult seed paragraphs contain I/me/my/mine/myself/we/us/our/ourselves; retain immediate neighboring paragraphs for authentic context. Every general-adult chunk contains a marker. Original anchors are included unchanged whether or not each has an explicit first-person pronoun. No overlapping chunks; no concatenation over unselected paragraph gaps.'
r['excluded_acquired_sources']={'gwern-fiction-clippy':'fiction/model-role ambiguity; not needed for authored essay corpus','gwern-ai-daydreaming':'contains model-generated examples and prompts','gwern-review-book':'review collection mixes author commentary with third-party material'}
r['source_subkind_words']=by_sub
r['quote_threshold_words']=15
r['paragraph_boundary_policy']='Excluded paragraphs and non-prose blocks create explicit breaks; no chunk crosses an excluded block.'
(D/'corpus-report.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
orig=[x for x in rows if x['source_kind']=='original_voice'];(D/'original-anchor-snapshot.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n'for x in orig))
chosen=[]
for sid in sorted(set(x['source_id']for x in rows)):
 a=[x for x in rows if x['source_id']==sid];chosen.append(min(a,key=lambda x:hashlib.sha256(('v6qa:'+x['id']).encode()).hexdigest()))
chosen+=sorted([x for x in rows if x not in chosen],key=lambda x:hashlib.sha256(('v6qa:'+x['id']).encode()).hexdigest())[:max(0,40-len(chosen))]
(D/'author-qa-sample.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n'for x in chosen))
words={x['source_id']:x['retained_words_before_dedup']for x in r['source_stats']}
lines=['# Source attribution and permission evidence','','Downloaded24 October2026 from primary publication endpoints. Text was acquired only for this local research corpus. Raw files, publisher metadata, source hashes and license evidence are retained. No Truth Terminal transcript, post, or fan imitation dataset is included.','','## Project Gutenberg','','Each book metadata page explicitly labels the selected edition “Public domain in the USA.” The full accompanying Project Gutenberg terms are retained in `licenses/pg-ID-license.txt`; original text and metadata files remain in `raw/`. That publisher statement is recorded precisely rather than represented as a worldwide legal opinion. Original publication years below identify the works, not necessarily the translation/edition year.','','|Work|Original year|Retained words|Primary metadata|','|---|---:|---:|---|']
for x in m['sources']:
 if x['status']=='downloaded' and x['source_id'].startswith('pg-') and words.get(x['source_id'],0):lines.append(f"|{x['title']}|{x['publication_year']}|{words[x['source_id']]:,}|[Publisher page]({x['metadata_url']})|")
lines+=['','## Gwern','','The author explicitly grants a[Creative Commons public-domain CC-0 license](https://gwern.net/about#license). The exact grant paragraph and full-source hash are saved in `licenses/gwern-cc0-license-excerpt.txt`. The corpus keeps selected author paragraphs after excluding blockquotes, inline quoted runs longer than 15 words, code, lists and footnote material. Short quotations inside otherwise authored discussion may remain. These are contemporary essays, not independent verification of their claims.','','|Essay|Created year|Retained words|Primary source|','|---|---:|---:|---|']
for x in m['sources']:
 if x['status']=='downloaded' and x['source_id'].startswith('gwern-') and words.get(x['source_id'],0):lines.append(f"|{x['title']}|{x['publication_year']}|{words[x['source_id']]:,}|[Author page]({x['metadata_url']})|")
lines+=['','## Original GH0ST anchors','','799 distinct prior project-authored passages,38,311 words. The source snapshot is `original-anchor-snapshot.jsonl`. Inputs are the36 long original monologues,80 later long originals,250 recovery vignettes and433 earlier original paragraphs selected strictly by `source_kind=authored` from the archived mixed corpus. Compositional expansions, teacher replies and children-story replay are excluded. Full original parents replace996 old clipped training spans covering706 parent IDs. Original split/group assignments are preserved.','','## Acquisition exclusions','','The downloader records failed URLs and title mismatches; they do not enter training. Three acquired Gwern collections are explicitly excluded: fiction/clippy, AI daydreaming, and book reviews. The incorrect preliminary PG305 lookup was rejected on title mismatch; PG308 is the verified Three Men in a Boat edition.']
(D/'ATTRIBUTION.md').write_text('\n'.join(lines).replace('Downloaded24','Downloaded 24').replace('October2026','October 2026').replace('a[Creative','a [Creative').replace('passages,38','passages, 38').replace('the36','the 36').replace('monologues,80','monologues, 80').replace('originals,250','originals, 250').replace('and433','and 433').replace('replace996','replace 996').replace('covering706','covering 706').replace('PG305','PG 305').replace('PG308','PG 308')+'\n')
readme=f'''# Voice v6: adult first-person continuity corpus

**Training status: RUNNING at this publication snapshot.** No trained language-quality result is claimed. Only the completed random-head local feasibility smoke test is available.

Frozen split files contain **{r['total_words']:,} words in {r['total_records']:,} records**. This is revision v2 of a new local-only dataset, not a trained-model result or an on-chain deployment.

|Source type|Words|Purpose|
|---|---:|---|
|{sum(x['source_id'].startswith('pg-') and x['retained_words_before_dedup']>0 for x in r['source_stats'])} public-domain adult memoir, travel and essay books|{by_sub['public_domain_adult_first_person']:,}|Broad connected prose and first-person narrative grammar|
|{sum(x['source_id'].startswith('gwern-') and x['retained_words_before_dedup']>0 for x in r['source_stats'])} selected contemporary CC0 essays|{by_sub['cc0_modern_first_person']:,}|Contemporary reflection, software, culture and personal experiments|
|799 distinct original GH0ST passages|{by_sub['original_gh0st_voice_anchor']:,}|Machine voice anchors, separately labelled|

|Split|Records|Words|
|---|---:|---:|
|Train|{r['counts']['train_records']:,}|{r['counts']['train_words']:,}|
|Validation|{r['counts']['validation_records']:,}|{r['counts']['validation_words']:,}|
|Test|{r['counts']['test_records']:,}|{r['counts']['test_words']:,}|

The adult-prose portion is {sum(x['word_count'] for x in rows if x['source_kind']=='general_adult'):,} words. {sum(x['direct_first_person_paragraph_words'] for x in r['source_stats']):,} words occur directly in eligible paragraphs containing first-person markers; adjoining paragraphs supply genuine local context. The label is a lexical selection rule, not a claim that every sentence is autobiographical. Many adult passages contain dialogue or discuss other people.

## What is preserved

Complete prose paragraphs retain original case, punctuation and Unicode after whitespace/markup cleanup. Source and chapter are assigned to splits **before** nonoverlapping chunks are formed. A first-person paragraph may retain its immediate neighbors; gaps break the sequence. Tables of contents, page furniture, verse-like layouts, incomplete list introductions, code, bibliographies, footnotes and third-party block quotations are excluded. Gwern paragraphs with inline quoted runs longer than 15 words are rejected after Markdown rendering, including wrapped lines. Public-domain paragraphs that start mid-sentence in lowercase or contain the specific dialect forms `knowed`/`drawed` are rejected. Exclusions leave explicit breaks; neighboring surviving paragraphs are never joined across them. Short quotations inside authored prose can remain. No sentence is deleted because of an out-of-vocabulary word, and no sentence-ending punctuation is inserted.

All799 original anchors are copied as full parent text. The old996 clipped spans are not copied as additional examples. This restores all706 parent IDs from the earlier authored training set and includes the additional80 long originals. The two source kinds are `general_adult` and `original_voice`; use them for separate sampling or conditioning rather than teaching the model to claim the human writers' identities.

## Vocabulary tradeoff

The actual 8K vocabulary uses the canonical `training/prepare.py` normalizer and reserves up to 2,000 repeated **training** voice types before filling by overall training frequency. Larger and plain-lexical rows are comparisons under the same policy. Held-out words never choose vocabulary entries. Percentages are unknown-word occurrence rates; the actual encoder can preserve them as input-only UNK and mask those output targets.

|Vocabulary|Train OOV|Validation OOV|Test OOV|
|---|---:|---:|---:|
'''
for k in ['8192','16384','32768']:
 c=r['vocabulary_coverage'][k]['splits'];readme+=f"|{int(k):,} word-plus-ending forms|{c['train']['oov_fraction']:.2%}|{c['validation']['oov_fraction']:.2%}|{c['test']['oov_fraction']:.2%}|\n"
c=r['lexical_vocabulary_coverage']['8192']['splits'];readme+=f"|8,192 plain lexical words|{c['train']['oov_fraction']:.2%}|{c['validation']['oov_fraction']:.2%}|{c['test']['oov_fraction']:.2%}|\n"
readme+='''
Canonical normalization applies NFKD, lowercases, normalizes curly apostrophes, strips combining accents and turns other non-ASCII symbols into word separators before matching alphabetic words with interior apostrophes and optional final `.!?`. Plain lexical counts show the cost of treating punctuation as part of the leaf. The 8K word-plus-ending row exactly matches the frozen encoded vocabulary. Other rows are hypothetical vocabulary comparisons. See `data/canonical-tokenizer-coverage.json`. Long/rare/Unicode words remain in the source records.

## Files and reproduction

- `data/train.jsonl`, `validation.jsonl`, `test.jsonl`: frozen model inputs with source and chapter provenance.
- `data/corpus-report.json`: counts, source/domain distribution, split rule, parent restoration audit, vocabulary coverage and split SHA-256 hashes.
- `data/source-manifest.json`, `ATTRIBUTION.md`, `licenses/`, `raw/`: source URLs, publisher permission evidence and original bytes.
- `data/train-lexical-counts.json` and `train-runtime-surface-counts.json`: train-only counts.
- `data/original-anchor-snapshot.jsonl`: all799 full original passages with their original groups/splits.
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

Historical English dominates: most words come from19th/early20th-century human memoir and essays; some passages contain archaic vocabulary, obsolete attitudes, religion, violence or dated drug/medical claims. This material offers grammar and continuity, not the desired final persona. The modern CC0 essays and original machine passages are much smaller. The original machine texts are authored examples rather than a claim of human experience or access to Truth Terminal's training data. The first frozen revision is preserved in `data/revisions/v1/`. Revision v2 rejected 69 quoted Gwern paragraphs containing 7,541 words and applied the fragment/dialect fixes before encoding. No promise is made that a tiny recurrent model will learn the intended voice from this corpus.

The independent reviewer is evaluating the frozen splits separately. Training and local gas testing belong to separate artifacts. No training, mainnet transaction or GitHub mutation was performed by these data scripts.
'''
for a,b in [('in3,','in 3,'),('is959','is 959'),('words.881','words. 881'),('All799','All 799'),('old996','old 996'),('all706','all 706'),('additional80','additional 80'),('all799','all 799'),('from19th/early20th','from 19th/early 20th')]:readme=readme.replace(a,b)
(B/'README.md').write_text(readme)
# Retain only the correctly identified edition metadata in active raw corpus.
wrong=D/'raw/pg-305-metadata.html'
if wrong.exists():wrong.unlink()
print('docs written',len(chosen),'fixed sample records')
