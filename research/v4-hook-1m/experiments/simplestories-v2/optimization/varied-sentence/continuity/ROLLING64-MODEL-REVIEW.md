# Local rolling continuity model

This is a local research candidate. No public transaction was submitted. The fixed-prompt, stateless deployment plan does not deploy this model and must not be reused for it.

## Result

`SimpleStoriesV2Rolling64Model.sol` preserved one evolving token stream across 136 real local transactions and 150 processed positions. Every emitted token and every turn's complete 4,019-logit hash matched an independently implemented rolling-attention reference. No refresh or initial-prompt restart occurred.

- Source SHA-256: `d9f6cdc02acf6fff54a5ca8524b23a5c13f924f71bc0f8a27c174e56e65ccebb`
- Runtime: 15,740 bytes. Full constructor transaction input: 35,034 bytes.
- Constructor gas: 18,079,351.
- Highest measured model advancement: 26,398,488 gas.
- Measured advancements after the attention window filled: 25,031,032–25,268,431 gas.
- Tests used an isolated Anvil chain 31337 with the normal 24,576-byte runtime and 32,000,000 transaction gas limits.

The model-only test injected the unchanged published weight/tile runtimes and the six numeric table shards into local state, then deployed the model normally. These are execution measurements, not an all-in cost quote for uploading all weights. The separate PoolManager integration report must establish complete swap gas.

## State and continuity

The full 1,235,968-parameter model, four layers, hidden dimension 128, vocabulary 4,019, and original Q12 learned weights remain present. Each emitted token becomes the next pending input. Its exact per-layer keys and values are computed on the next advancement and saved to an immutable data child. Terminal punctuation and EOS are retained as tokens; neither automatically restarts the story.

Each pool's hook owns a separate model namespace. Callers cannot provide arbitrary caches. Advancing derives a new cache only from that namespace's authenticated prior cache. State updates and new data-child creation occur atomically. The expected context hash rejects stale attempts.

At each absolute position `p`, attention sees positions `max(0,p-63)..p`. Cached older representations preserve the historical contexts under which they were computed. Dropping old attention entries is a sliding-attention model variant; it is not identical to full, unlimited-context inference, and it does not guarantee that an old subject is remembered forever. Absolute RoPE positions are never rebased.

All 2,048 native positions are covered by deterministic Q12 sine/cosine tables. The 133,128-byte table blob has SHA-256 `97a56ba07d3587fe4cfdd1c482e530398754d4d43b5421d67be3bc96251b5741`; its first 128 positions and nonlinear tables match the earlier exact implementation. Six STOP-prefixed table shards have aggregate commitment `0x98abdff6f8a246254201a803fe8a6c8d07e1b3e3064e5869c64e80a23bd45ce7`.

## Scope and limits

The measured policy requests two output tokens while `processed <= 30`, then one output token per advancement. These are incremental fragments. A complete sentence usually spans several swaps. Tests used initial quote token 3, top-k 8, temperature 800, and caller seed 42 with a global sampling counter. They do not prove all-seed language quality or all possible activation paths have the same gas cost.

The model stops with `ContextLimit` when a request would cross 2,048 processed positions. It has no automatic reset, administrator escape, or position extrapolation. A hook that requires successful inference would eventually prevent swaps in that story namespace. A lifecycle policy must be designed and tested before mainnet deployment.

Security checks passed for stale context rejection, caller namespace isolation, modified active-cache rejection, and ignoring an expired cache outside the window. No arbitrary cache setter exists. Old cache contracts remain on chain even after attention stops loading them; storage grows by one data contract per advancement.

## Evidence

- `model-rolling64-local.json`: real advancement receipts, gas, tokens, state and cache hashes.
- `model-rolling64-parity.json`: all-turn comparison with the independent exact reference.
- `quality/rolling64/rolling64-140turn-reference.json`: independent numerical reference and causality controls.
- `model-two-token-limit-control.json`: preserved failed unbounded-context two-token control.
- `model-adaptive-local.json`: preserved one-token unbounded-context control that reached 88 positions before the 32M gas limit.
