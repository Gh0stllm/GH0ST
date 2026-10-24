# Voice-v6 local runtime validation

No new architecture has been implemented. Preserve earlier experiments and
perform all new export/runner changes in this directory after model selection.

- **Trajectory:** at least256 real, settled v4 swaps on one pool, with a generated
  nonempty word on every successful swap. Use a fixed predeclared seed. Preserve
  the previous token and every signed hidden value across all natural terminals.
  Retain raw output; repeated or incoherent words remain visible.
- **Reference:** compare each selected token, every224-value next state, and all
  evaluated output logits. For the current head this means13 path scores; for a
  two-level head it means all128 cluster scores and all64 selected-cluster scores,
  plus integer probabilities and draws. Recompute original input projections in
  the independent reference instead of trusting precomputed rows.
- **Callers/pools:** alternate two funded local EOAs through the same pool and
  confirm one deliberately shared pool story. Drive a second pool independently
  and confirm it cannot change the first pool's hidden state or sequence. Direct
  calls to hook callbacks must fail; public stateless model reads must not change
  hook state.
- **Atomicity:** separately reject stale sequence, correct-sequence/forged hash,
  malformed ABI, low gas and changed model runtime. Force failure after inference
  and settlement and compare state, counter, balances and pool price to the
  pre-transaction snapshot. No skipped-word success path is allowed.
- **Arithmetic boundaries:** exercise signed hidden extremes±1024, feature
  extremes±4096, LUT half-step ties and saturation, temperature limits, first/last
  vocabulary IDs and start token8192. Check original-weight and derived signed40
  bounds. Test sequence-overflow rejection separately rather than waiting for it.
- **Data boundaries:** verify every catalog and shard hash, cross-shard reads of
  fused input rows and decoder records, final partial shards and32-byte word
  records. Reject mismatched tokenizer/leaf maps at export. All output words are
  actual vocabulary strings, with no forced punctuation.
- **Gas:** cap local block and every transaction at32M; do not raise the cap for
  a passing result. Record maximum, mean and complete per-swap gas with the exact
  checkpoint, compiler, source, table and mapping hashes. Report data-shard
  installation/deployment costs separately. Avoid claiming runtime gas from MAC
  estimates or small probes.

Record language quality, novelty/copying and multi-sentence coherence separately
from exact arithmetic and gas. These tests do not authorize mainnet deployment
or GitHub publication.
