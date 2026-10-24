# Local recurrent grammar and voice experiment

This isolated trainer keeps the existing 4,492,256-parameter architecture: 8,192 output words, a separate start input at 8,192, 265 hidden values, six swap features and a learned 13-level binary decoder. Matrix order, hidden clamp `[0,8]` and Q10 export match the earlier 4.5M experiment. No public network, wallet or deployment code is used here.

## Data

`prepare_data.py` fits the word vocabulary on training text only. All entries contain 1–32 ASCII bytes: lowercase letters, interior apostrophes and optional final `.`, `!` or `?`. Unsupported quotes and commas are removed; end punctuation is preserved when present and never invented. There are no padding, silent or unknown output tokens. The start token is only an input embedding.

Data-v1 exposed excessive whole-paragraph OOV attrition and 60 leaves without surviving targets. It was not used for training. Data-v2 instead keeps contiguous complete-sentence spans, never joins across a discarded sentence, and replaces unusable vocabulary entries with words completing real training sentences. It contains 8,192 active training leaves, no synthetic vocabulary fillers and no old compositional expansion. Maximum token length is 15 bytes.

Data-v2 retained training text has 2,721,227 grammar-replay words, 63,452 filtered licensed-teacher words and 17,605 distinct authored words. These are source words, not claims of novel model outputs. The replay uses the pinned SimpleStories source and licenses recorded under `large-v3/recovery-v5/grammar-replay`; prior teacher provenance remains under `large-v3/data/teacher-v4`. The 250 new vignettes and the separate 36 longer originals retain their original group splits. The manifest reports OOV attrition. Held-out scores apply only to retained spans, not every original paragraph.

## Training and evaluation

The initial source mix is 10% authored, 75% grammar replay and 15% teacher prose. These are sampling weights; reports record actual supervised words. Every parameter is trained from random initialization. Input and feature projections are batched before the sequential recurrence; this preserves the architecture while making MPS efficient. Features are independent bounded nuisance values per word, so the experiment does not claim meaningful price-to-prose conditioning.

State persists across punctuation. It resets only when the sampler begins an independent source document. A training window starting inside a long paragraph receives an unsupervised warmup prefix. Validation starts from full document boundaries, uses plain hierarchical cross-entropy, and reports every source separately plus an equal-source mean. Test data is not used for selection. Each checkpoint includes optimizer and NumPy sampling state for continuation.

The first million-word gate and the resumed four-million phase are separate output directories so the first snapshot remains immutable. The cosine learning-rate schedule uses cumulative words; continuing the same target preserves the schedule. A larger target changes that schedule and must be explicitly documented.

`sample.py` emits complete raw streams at fixed word counts. It uses float inference and a local PyTorch sampler; `evaluation/screen_checkpoint.py` and the independent Q10/EVM reference supply separate checks. No sentence terminator is appended when a word limit is reached. The training probes include temperatures 512, 768 and 1024, plus extreme feature inputs, and report dead/saturated hidden fractions. Better teacher-forced validation does not establish coherent free generation.

`export_model.py` uses nearest-even Q10 quantization and rejects overflow. It writes the exact existing core/embedding/node byte layouts, verifies every vocabulary row and emits source/artifact hashes. It does not claim EVM parity or gas; those belong to the local contract benchmark.

No model in this folder is approved for release based on the training objective alone.
