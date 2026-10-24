# Teacher corpus: provenance and language review

The final teacher snapshot passes the structural checks below. It supplies more natural explanatory and conversational English, but it is not uniformly complete prose and should not be described as a ready-made GH0ST or Truth Terminal voice corpus.

## Snapshot identity and the corrected merge

The current `data/teacher-v4` has **13,428 paragraphs**, **604,806 words**, and **1,085,338 tokens**. Its manifest SHA-256 is `4c930fc4de66f443572686f04d4cef0e8b29bc22436b298bd78ae516a4904248`.

The first `data/mixed-teacher-v4` captured an earlier 13,456-paragraph teacher version. Its source hashes no longer match the current teacher files. It remains a historical artifact, not the final merge.

The corrected, immutable `data/mixed-teacher-v4-final` has **78,102 documents**. Independent comparison confirms that every split is the exact union of the corresponding original large-v3 split and the current teacher split. Parent hashes, records, and counts match. Final merged manifest SHA-256: `7a462fdb8dcfc06d3c81babf3dc4d99597ae23d47e8ecece194b02644151c963`.

| Teacher split | Paragraphs | Tokens |
|---|---:|---:|
| Train | 10,616 | 864,954 |
| Validation | 1,455 | 117,211 |
| Test | 1,357 | 103,173 |

## Independent checks

All teacher rows were retokenized: zero unknown tokens and no stored token-count discrepancies. No duplicate IDs or normalized exact text were found. The 4,147 conversation groups are disjoint across the three splits, and every row's split matches the stated deterministic hash assignment.

Every output paragraph was traced back to its exact source record, assistant turn, and paragraph index. Applying the documented punctuation, emphasis, accent, and whitespace normalization reconstructs the stored text exactly. Raw-download hashes, pinned revisions, and retained source-card hashes match their provenance records. This checks extraction and attribution; it does not independently prove which model generated the upstream text.

The sources are a bounded prefix of [NousResearch/Hermes-3-Dataset](https://huggingface.co/datasets/NousResearch/Hermes-3-Dataset) and the V3 file of [Verdugie/opus-candid-training-data](https://huggingface.co/datasets/Verdugie/opus-candid-training-data). Their current public cards and retained pinned metadata declare Apache-2.0. The Opus-Candid publisher attributes its data to Claude Opus 4.6; that is a publisher report, not an independently verified generation record. Retained cards, license text, and NOTICE support attribution, not an exhaustive audit of upstream rights.

## Deterministic language sample

Twenty paragraphs were selected using a fixed hash ranking: ten from each dataset, across train, validation, and test. Every selected paragraph was read in full. This is an independent Codex review, not a human blind study or a factuality evaluation.

The sample contains fluent conversational advice and complete explanations, but also material poorly suited to the requested uninterrupted machine monologue:

- Two fantasy passages introduce a named sorcerer or an enchanted forest. These could reinforce the story genre the project is trying to move away from.
- One paragraph introduces a JavaScript function without including the function. The code filter removes code-shaped content but does not remove every dangling introduction to code.
- Two Opus-Candid samples are strongly compressed fragments. One begins “Hm. her fear as guidance.” Another omits subjects or objects in an explanation of codependency. These are weak examples for teaching a tiny model reliable grammar.
- Several samples depend on a preceding question: rounding boxes of marbles, an unspecified equation, a job change, nutrition, or an earlier family conflict. Conversation-level split isolation prevents leakage; it does not restore missing context to an extracted standalone paragraph.
- Promotional shoe text makes performance and injury-prevention claims. Other samples make medical, interpersonal, technical, or financial assertions. Their grammatical fluency is not evidence that the assertions are accurate.
- Some direct, candid paragraphs have useful rhythm and clear reasoning. This supports trying the material as a limited English/conversation component, while preserving the separate original GH0ST writing.

Topic and priority tags are keyword heuristics. A shoe paragraph tagged `focus` does not thereby become an example of the desired AI persona. The broader corpus includes only 2,089 paragraphs with an explicit first-person singular marker; most of the teacher data teaches other registers.

The sample is too small to estimate defect rates for the full corpus. It does establish that automatic prose filtering and a good source-model name are insufficient quality guarantees. No claims in these paragraphs were independently fact-checked, and this report must not be used as validation of their advice.

## Evidence and use

Machine checks: `teacher-corpus-independent-audit.json`. Complete sampled text: `teacher-corpus-review-sample.txt` and `.json`. Per-paragraph findings: `teacher-corpus-qualitative-review.json`.

Keep using the final merged snapshot and its matching cache. Judge the trained model by full generated continuations, grammar, meaningful continuity, repetition, and source copying. Teacher provenance and corpus size do not establish that a 1.24M model has acquired the source models' abilities. No model training or chain call was performed by this audit.
