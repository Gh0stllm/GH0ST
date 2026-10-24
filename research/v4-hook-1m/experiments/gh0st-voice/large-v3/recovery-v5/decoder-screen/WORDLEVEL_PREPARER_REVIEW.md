# Independent preparer review

Reviewed `../training/prepare_wordlevel.py` read-only before the root's final corpus/patch freeze. The following are findings about that version; later edits require rechecking.

Confirmed by inspection and a local tokenizer probe:

- Vocabulary frequency counts use only rows whose split is `train`, including newly supplied training data. Validation/test words are not used to fill the vocabulary.
- IDs0–31 retain the original token strings, including UNK0, EOS1 and quote3. The saved tokenizer has4,019 entries, and the tied embedding/output matrix retains1,235,968 total parameters.
- Embeddings for new whole words are derived from original WordPiece vectors, rescaled and explicitly clamped to the signed12 Q12 interval. This is a heuristic initialization, not preservation of original model logits or grammar.
- The tested pre-tokenizer handles `I don't have a wallet.` as the expected word/contraction/punctuation tokens. The regex's inversion did not break this example. Digits are separate tokens, so `123.45` decodes as spaced digits. Accented and underscore-containing forms can produce UNK and are rejected by corpus filtering.

Before a long run:

1. Assert unique row IDs, source conversations and compositional family membership across splits. Exact normalized text deduplication alone does not detect related examples crossing splits. The downstream cache may reject some groups, but the preparation report should prove this directly.
2. Report input, retained and rejected document/token counts **by source and split**, plus OOV word rates. Dropping an entire held-out sentence containing one unavailable whole word can create a much easier surviving validation set. A4k whole-word vocabulary may require a character/subword fallback if whole-sentence retention is low.
3. Align saved-tokenizer normalization with corpus normalization. The corpus replaces curly quotes/dashes and strips an outer quote; the saved tokenizer currently applies only NFKC/lowercase. This matters for future arbitrary user prompts even when fixed quote-only inference is unaffected.
4. Fit vocabulary counters to the actual retained/capped training distribution, or explicitly weight the source counts. Counting every compositional variant before the128-per-family cap overstates that source when assigning the limited general vocabulary slots.
5. Keep the remap and coverage report with the checkpoint. Optional: copy reserved embedding rows directly instead of renormalizing a one-row mean, if bitwise preservation of those vectors is desired.

The planned64-token blocks,16-token context warmup and batch32 are compatible with the current training helper. New whole-word embeddings warrant a substantially larger learning rate than the earlier low-rate style tuning, but there is no evidence yet for a particular rate. A bounded early screen should compare short/full generated continuations, not just loss. Separate rates for the remapped embedding/head and the existing transformer are a reasonable controlled alternative if high-rate full-model updates damage grammar.

This review did not train or modify the word-level model, and makes no new EVM gas claim. New weights and vocabulary must be exported, committed and tested through the actual local hook.
