# Large-v3 corpus review

The independent structural audit passes. The sampled prose is substantially clearer than the failed generated model outputs, but several combinations need transition edits. The corpus is valid input for an experiment; its size does not establish that the resulting model can maintain this quality.

## Independently verified structure

Every row was read, retokenized with the fixed 4,019-token tokenizer, checked against its stored text hash, and counted independently of the builder. Counts match the manifest:

| Split | Documents | Tokens | Authored | Composed | Historical prose |
|---|---:|---:|---:|---:|---:|
| Train | 51,737 | 5,048,836 | 345 | 49,152 | 2,240 |
| Validation | 6,473 | 667,772 | 44 | 6,144 | 285 |
| Test | 6,464 | 716,520 | 44 | 6,144 | 276 |
| Total | 64,674 | 6,433,128 | 433 | 61,440 | 2,801 |

- No unknown tokens, duplicate IDs, text hash errors, token count errors, or row/split mismatches.
- No exact normalized text duplicates anywhere, including cross-split duplicates after removing punctuation.
- No family appears in more than one split. This covers composition families, individual authored records, and the grouped historical-prose chunks.
- Each of the 60 composition families supplies exactly 1,024 records. Every composed row reconstructs exactly from its source family's stored sentence choices.
- No shared 12-word sequence between the authored portions of train, validation, and test.
- Historical prose retains source metadata and has 233 source groups. This audit checked structure and separation; it does not certify historical factual claims or independently reassess source licensing.

Family separation means **family IDs**, not disjoint subject matter. Related themes such as receipts, filters, doors, and queues can appear in different authored sources or differently named families across splits. The validation set therefore tests unseen sentence families in a shared topic domain, not completely unfamiliar concepts. Twelve-word separation for authored text is also narrower than a semantic contamination guarantee.

The 61,440 composed documents come from 60 short families, not 61,440 independently authored essays. Most records and tokens reuse sentence structures within a family. Sampling weights used by the trainer are a separate matter from these raw corpus proportions.

## Deterministic prose sample

The sample contains one paragraph from each of 30 distinct composition families, 15 from each author's family pack. Both family and row were selected using the fixed hash rule documented in `corpus-audit-independent.json`. All 30 paragraphs were read in full. This is a Codex review, not a blinded human benchmark.

No severe syntactic failure was observed. Six combinations contain a weaker transition or a concrete detail that was not properly introduced:

| Sample | Record ending | Exact issue |
|---|---|---|
| 3 | `a-seed-0156` | “the seed ignored the arrow” appears without an earlier arrow. |
| 9 | `a-receipt-0472` | “a good afternoon” imports a contrast not established in the preceding sentences. |
| 16 | `voice-b-family-20-0806` | “the connection” and the working tool arrive after an unspecified repairable problem. |
| 26 | `voice-b-family-10-0833` | “the question” is not introduced as the boat's cargo; the opening describes curiosity instead. |
| 28 | `voice-b-family-04-0387` | A step is prioritized but never explicitly repaired before the conclusion implies it can bear weight. |
| 30 | `voice-b-family-23-0730` | “the microphone” enters late without being established alongside the wealthy speaker. |

These are repairable local issues rather than the repeated malformed loops seen in the earlier checkpoints. They nonetheless show that independently grammatical alternatives do not guarantee perfectly connected combinations. The 24 other sampled paragraphs kept their central object and reasoning traceable in the particular combinations reviewed; that is not a pass claim for every variant of those families.

Full sample and individual assessments: `corpus-review-sample.txt`, `corpus-review-sample.json`, and `corpus-qualitative-review.json`.

## Training implication

Use the present snapshot as a documented experiment. Avoid describing it as 64,674 unique ideas or as proof of Truth Terminal-level writing. When revising a family, establish the central prop in every first-sentence alternative, keep subsequent definite references valid for every path, and show an action before asserting its successful consequence. Changes belong in a new corpus version and cache; this review has not mutated the current training data.

The next decision should rely on complete generated streams from actual checkpoints, including long continuations, exact Q12 export, and eventual local gas/parity testing if language quality improves. A good training paragraph is not evidence that the small model will reproduce its reasoning.

Corpus manifest SHA-256: `2b1ef202eed4eced35ed9b34ee19f912341735501bcb7b9c4359be4bf561117d`.
