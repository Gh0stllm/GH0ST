# Local grammar and repetition recovery

This experiment targets the earlier voice models' broken words, grammar and semantic loops. It is local-only research. It does not change a public deployment or the website. Training data, model inference and measured gas are separate claims.

## Implemented changes

- Replace the 4,019-entry WordPiece vocabulary with an equally sized WordLevel vocabulary. Preserve all reserved IDs 0–31, the 1,235,968-parameter architecture, tied input/output embeddings, Q12 format and 64-token attention window.
- Initialize each new word from the original word's subtoken embeddings, with explicit norm adjustment and range auditing. This is a warm start, not equivalent inference.
- Bind the tokenizer and complete vocabulary into the exported model identity. The local runner checks both, reads the new token strings and compares its output with the independent integer reference.
- Add 250 independently authored, short original vignettes, with whole-theme train/validation/test splits. These are offline training examples, not a runtime phrase list.
- Add a pinned MIT-declared SimpleStories grammar-replay sample of 25,000 stories, preserving source-completion groups across splits. The upstream source probably overlaps the base model's pretraining; this is replay for grammar, not unseen-pretraining evaluation.
- Compare ordinary next-token training with a training-only unlikelihood term. The latter penalizes repeated content words, excluding the correct next word, reserved IDs and an explicit function-word list. Validation remains ordinary cross-entropy. The extra loss adds no work to swap-time inference.

## Data limitations

Whole-word vocabulary cannot represent arbitrary words. The preparers reject examples with unknown tokens and report that loss by split. In the first vocabulary, only 19 of 30 new validation and test vignettes remained. The second vocabulary favors the new original training words and broader common English. No test or validation text is used to fit the vocabulary. Coverage audits, rather than a filtered validation score alone, describe this limitation.

Grammar replay is lowercased, normalized and split into consecutive sentence groups. The current punctuation filter can drop dialogue-heavy groups ending in quotation marks. Original source IDs, license cards and raw hashes are preserved; no claim that every downloaded story entered training is made.

## Early outcomes

The first 4M-token word-level run completed. It removed malformed WordPiece concatenations and reduced exact repeated n-grams, but still produced broken clause connections and increasingly overfit the limited first corpus. Its best saved validation checkpoint was step 500; it is not a release candidate. The prior WordPiece decoding screen also failed to recover dependable grammar.

The broader grammar runs and the final local v4 result are recorded separately under `runs/`, `evaluation/`, `export/` and `evm/`. File presence is not a pass. A candidate must pass full text review, source-copy checks, exact Q12 parity and actual whole-swap gas measurement below 32,000,000. No mainnet transactions are part of this experiment.

## Reproduction

The training interpreter is the existing research ML environment. Run commands from `research/v4-hook-1m`. `training/prepare_grammar.py` constructs the frozen word-level model and corpus; the existing `../training-teacher/prepare_cache.py` builds the token cache using its explicit `--tokenizer` argument. `unlikelihood/train_teacher.py` accepts `--unlikelihood-alpha 0` or `0.2` for the matched comparison. Configuration, token exposure, hashes, snapshots and clipping counts are in each run report. The export adapter and local-only runner have their own READMEs.
