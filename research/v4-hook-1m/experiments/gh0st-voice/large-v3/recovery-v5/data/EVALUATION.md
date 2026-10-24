# Recovery-v5 original prose and evaluation

The main dataset contains 250 separately authored vignettes, grouped by 25 central objects or themes. There are no sentence-choice templates or generated combinations. Each story uses 2–4 sentences and 20–33 words, with a concrete setup, a small absurd turn, and a readable consequence.

Load **only** `train.jsonl`, `validation.jsonl`, and `test.jsonl`: 190 training stories, 30 validation stories, and 30 test stories. All stories from a group belong to one split. `original-vignettes.jsonl` is an archival copy containing the same records, so loading it too would duplicate the data. `optional-prior-sharp.jsonl` preserves the previous 100 stories separately, with `split: excluded`. It is not part of the recovery dataset.

Use validation records for checkpoint choice; reserve test records for final evaluation. Do not train on `heldout-prompts.json`, which contains eight fixed continuation checks. All words in those prompts already occur in the training split; the prompts do not introduce deliberately impossible vocabulary. Evaluate every prompt under fixed seeds and equal output lengths across candidates. Also include an unprompted or minimal-prompt long continuation of at least 256 tokens to reveal loops that a good opening may hide.

## Review rubric

Score full continuations on a 0–4 scale, not just the first sentence:

- **English:** 0 unreadable; 2 frequent fragments or wrong word relations; 4 natural, clear clauses.
- **Referents and sequence:** 0 unrelated or self-contradictory; 2 the same nouns recur without clear development; 4 objects, actions, and consequences remain traceable.
- **Comic turn:** 0 random words; 2 a recognizable but weak image; 4 a surprising consequence that follows from the setup.
- **Variety:** 0 fixed loop or copied passage; 2 repeated stock patterns; 4 varied structures without losing the voice.

Report every failure. A clever fragment does not excuse an unreadable paragraph. A low repeated-four-gram count does not establish meaningful continuity. Compare generated text against the full training corpus for exact longer phrase reuse, and distinguish copied text, ordinary short phrases, and new composition. No novelty claim can be established against unknown original pretraining.

The 25-story QA sample has one story per group, selected by a fixed hash. It was reread by the authoring assistant and checked for grammatical completion, stable referents, and a connected turn. This is a second-pass editorial check, not independent blind human scoring. `qa.json` records structure and input hashes.

Corpus simplicity is a development choice, not evidence of learning. Only model output can establish language improvement. Local quantized parity and whole-swap gas must be measured separately; these files contain no on-chain test result.
