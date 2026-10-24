# Bounded repetition controls: proposal only

No hook or production decoder is changed by these notes. The earlier WordPiece
probe reduced repetition without repairing grammar, so a new WordLevel model
should first be tested with the unchanged decoder.

If repetition remains a distinct problem, two controls can be evaluated exactly:

- **Recent64 repetition penalty1.10:** before selecting top-k, visit each unique
  token ID among the last64 consumed inputs once. Positive Q12 logits become
  `trunc(logit*10/11)`; negative logits become `trunc(logit*11/10)`. This is a
  deterministic score change, with no phrase replacement or hand-written text.
- **Recent64 no-repeat trigram:** compare the current last two consumed tokens
  with each earlier adjacent pair in the same64-token ring. Exclude the observed
  following token from top-k. This prevents only trigrams visible in the bounded
  window; it does not guarantee global non-repetition or good meaning.

Both need the actual last64 **consumed** input IDs, including the token whose
forward pass just produced the logits. The newly sampled pending token is not
inserted until it is consumed on the next step. Keeping this ordering avoids
off-by-one divergence between preview, reference, and execution.

The existing state stores K/V plus a short three-token tail, not64 token IDs.
A64-ID ring would require128 bytes (four storage words), a cursor/count, and
bounded updates inside the same atomic model state transition. Penalizing at
most64 unique IDs or scanning at most62 triples is small compared with the
transformer matrix work, but the extra storage and memory operations are
**unmeasured**. Existing roughly28.4M worst-case gas does not prove a modified
decoder remains below32M.

Use the same fixed seed set and complete transcripts for the control comparison.
Define behavior for reserved IDs explicitly; do not silently exempt punctuation
or ban names/topics. Bind chosen decoder settings to the hook configuration or
model identity, then retest full-logit/sampling parity, full-window gas, stale
previews, and forced rollback before considering deployment.
