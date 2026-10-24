# Word-level preparation audit

The prepared corpus passes structural checks, but filtering removes a large fraction of held-out text. Evaluation on the retained subset must not be described as evaluation of the full original validation/test corpus.

## Verified checks

Independently read and retokenized all **14,003 output records**, totaling **600,973 tokens**, with the new WordLevel tokenizer. No record contains unknown token 0 or EOS token 1 as prose. IDs, recorded token counts, text hashes, and source/split assignments match. No normalized exact text crosses splits. The 4,019-entry vocabulary preserves all first 32 reserved token IDs from the old tokenizer. Every nonreserved vocabulary entry was found in training-source text; no validation/test-only word was added to repair coverage.

Retained records preserve their original group IDs and split. No group crosses splits. All 25 new vignette groups still have retained examples. However, only four of the original six validation composition families and five of the six test composition families remain; family retention and family leakage are different questions.

## Attrition

“Retained parents” counts original input documents with at least one surviving output. Historical and teacher paragraphs are split into individual sentences, so output counts can exceed retained parents. The preparation report's rejection counts operate on candidate sentences and must not be interpreted directly as discarded-document counts.

| Split | Kind | Input parents | Retained parents | Output records | Parents dropped |
|---|---|---:|---:|---:|---:|
| Train | Authored | 535 | 535 | 535 | 0.0% |
| Train | Composed | 49,152 | 6,144 | 6,144 | 87.5% |
| Train | Historical | 2,240 | 524 | 768 | 76.6% |
| Train | Teacher | 10,616 | 3,403 | 4,686 | 67.9% |
| Validation | Authored | 74 | 29 | 29 | **60.8%** |
| Validation | Composed | 6,144 | 286 | 286 | **95.3%** |
| Validation | Historical | 285 | 68 | 91 | 76.1% |
| Validation | Teacher | 1,455 | 450 | 616 | 69.1% |
| Test | Authored | 74 | 34 | 34 | **54.1%** |
| Test | Composed | 6,144 | 151 | 151 | **97.5%** |
| Test | Historical | 276 | 67 | 85 | 75.7% |
| Test | Teacher | 1,357 | 408 | 578 | 69.9% |

Training composition is deliberately capped at 128 examples per family. Most held-out composition loss instead comes from words absent from the training-derived whole-word vocabulary.

Of the **new 250 short vignettes**, all 190 training records survive. Only 19 of 30 validation and 19 of 30 test records survive. The remaining 22 are dropped rather than changed or mapped to unknown tokens. Examples of excluded words include `knocked`, `creaks`, `chalk`, `complaints`, and `sale`. These are ordinary words; an unknown-free retained corpus does not mean the tokenizer can represent arbitrary everyday English.

Exact dropped IDs, texts, and out-of-vocabulary words are in `prepared-wordlevel-audit.json`.

## What changed in the prose

The old corpus contains longer first-person essays such as:

> i changed my picture to an empty chair. people said i looked more serious now. before that i was a ghost, which apparently made my opinions harder to trust.

That full six-sentence record remains in the prepared training set, with 73 new word-level tokens versus 87 old subword tokens. The preparation does not rewrite its meaning.

The new short-vignette set adds a more compact example:

> I raised my chair by an inch. My ideas did not improve, but people let me speak for longer. I am worried about what the next inch will do.

That entire three-sentence story uses 33 new tokens versus 36 old subword tokens. It has one object, a clear action, and a consequence that can fit within a 64-token context. This illustrates the intended format, not proof that a model has learned it.

Teacher and historical prose can become single sentences after preparation. Some previously observed context dependence may therefore remain or increase. The new whole-word tokens prevent splitting a known word into malformed pieces; they cannot by themselves enforce grammar, truthful claims, or sensible connections between words.

## Interpretation

Training and evaluating this snapshot is a valid constrained-vocabulary experiment. Report the narrow retained validation/test coverage alongside any score. Keep the unfiltered held-out examples available as coverage failures, rather than silently treating their exclusion as success. Do not select checkpoints on the test set.

No data, model, or live training file was modified by this audit. Reproduction: `audit_prepared.py`. Preparation report SHA-256: `2838972d03eb3a10e2304b59abd65453857d6370373c7966d3ed4ba43e980925`.
