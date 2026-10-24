# V7 typed grammar curriculum

This is synthetic **training data**, written to teach a neural model grammatical
sentences and short causal continuity. There is no inference-time template,
sentence bank, lexical mask, or grammar engine in this dataset. Its existence
does not demonstrate that a trained model will generate good language.

## What is authored and what is expanded

`frames.py` contains 40 original semantic families, each with seven compatible
objects and four ordered stages. Each stage has two authored two-sentence
alternatives. These are 320 authored paired-stage patterns, or 640 sentence
patterns. Ten compatible locations or document contexts are provided per family.

`build_curriculum.py` chooses ten of the sixteen possible stage paths for each
object/context binding. Each resulting episode has eight connected sentences in
four paragraphs: an observed problem, a matching adjustment, verification of
the expected effect, and reflection on that same event. Episodes contain
100–118 words. A binding is introduced at the start; subsequent stages continue
the same event rather than restarting an unrelated scene.

The 28,000 instantiated episodes are **not 28,000 independently authored plots**.
They contain 112,000 two-sentence stages and 2,995,138 word occurrences. The
repetition is intentional for a grammar curriculum, but this data should be
mixed with independent prose rather than treated as a broad adult-language
corpus or a substitute for voice training.

## Splits

| File | Episodes | Words | Split rule |
|---|---:|---:|---|
| `train.jsonl` | 20,160 | 2,159,760 | 32 semantic families, reserved bindings excluded |
| `validation.jsonl` | 2,800 | 299,632 | Four entire semantic families |
| `test.jsonl` | 2,800 | 295,917 | Four different entire semantic families |
| `test_combinations.jsonl` | 2,240 | 239,829 | Unseen object/context bindings from the training families |

Families are hash-ranked and split before expansion. The first three files have
disjoint family sets and no exact normalized episode duplicates. The combination
diagnostic deliberately shares sentence constructions and individual objects and
contexts with training, but its object/context pairs are absent from training.
Keep it separate; it is not an independent-topic generalization test.

Each row records `id`, `group_id`, `split`, `source_kind`, semantic frame and
binding, action, expected result, stage order and path, word count, and `text`.
The source kind is `original_typed_curriculum`, so this expanded material can be
distinguished from independently authored voice paragraphs.

## Vocabulary coverage

The existing 8,192-word V7 baseline vocabulary was read without modification.
Its SHA-256 is
`665fd7b242c6ab1fca998782df32a76e3884f3fafd6b0feeef1886d4767f27b0`.

| Split | Known word occurrences | Unknown occurrences |
|---|---:|---:|
| Train | 95.9547% | 87,368 |
| Validation | 96.3562% | 10,918 |
| Test | 96.5024% | 10,350 |
| Combination diagnostic | 95.9479% | 9,718 |

This is below the desired 98% training coverage. Frequent missing training
forms include `matched`, `confirming`, `expired`, `duplicate`, `cache`,
`identifiers`, and `readings`. Do not interpret a missing word as a reason to
delete the surrounding sentence. The trainer's explicit input-unknown and
target-loss policy must handle these occurrences and report any loss masking.
No validation/test vocabulary was added to the model.

## Review and limitations

Structural checks verify exact episode uniqueness, split separation, complete
stage structure, word limits, and exclusive held-out combinations. A manual
read of the fixed full episode in `review-samples.json` for each of the 40
families found the intended problem → action → check → reflection progression
and readable grammar. This is author review of samples, not an independent
review of every expansion. Some object/location bindings are redundant, such
as a desk lamp at a desk; some phrasing is deliberately instructional rather
than natural conversation. The subjects favor repairs, records, simple market
interfaces, and online communication. Voice breadth remains limited.

The source patterns are original work for this experiment. No model-generated
teacher outputs, external text, V7 held-out evaluation prompts, or runtime
response rules were used. Existing V6 inputs were not changed. No network or
chain calls are part of generation.

## Reproduce

Run `python3 build_curriculum.py` from this directory. The generator is
deterministic and writes the four JSONL splits, training word counts, semantic
frames, review samples, and `report.json`. The report records source and output
SHA-256 hashes. Reproduction reads the baseline vocabulary only to report
coverage; it does not fit or change that vocabulary.
