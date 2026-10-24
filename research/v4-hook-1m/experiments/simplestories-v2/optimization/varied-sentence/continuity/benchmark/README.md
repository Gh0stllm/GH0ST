# Continuous-story v4 hook: local result

Historical absolute-position Rolling64 control. The selected continuous-story implementation is [Relative64](../README.md), which removes the fixed position-table cutoff. The frozen measurements below describe this earlier control.

The rolling64 hook passed **140 consecutive swaps through the real Uniswap v4 PoolManager on isolated Anvil chain31337**. Every swap's token IDs, terminal flags, and hash of all4,019 vocabulary logits matched the independent Python reference. No public-chain transaction was submitted.

| Measurement | Result |
| --- | --- |
| Successful consecutive story swaps |140/140|
| Generated tokens |154|
| Independent reference matches |140/140|
| Whole-swap gas |10,914,116–26,512,705|
| Gas once the64-position window is full |25,144,343–25,387,643|
| Model call budget |29,250,000|
| Whole transaction limit |32,000,000|
| Last absolute position |154|
| Prompt resets or position rebases |0|

The hook requests two tokens while the processed position is at most30, then one token per swap. Native punctuation or EOS can end a two-token chunk early. The model retains the pending token for the next swap. The hook accepts fragments honestly; it does not claim that each swap produces a complete sentence.

The model carries authenticated per-layer keys and values across swaps. At each position it attends to the latest64 positions, including the current position. Previous keys and values keep the computations made at their original positions. RoPE uses absolute positions; it is not restarted at a new swap. The seed in this run was deliberately constant,42, so the changed outputs are caused by changing story state rather than a new seed alone.

The reference trace crossed these absolute positions through actual swaps:

| Position reached | Swap | Whole-swap gas |
| --- | --- | --- |
|17, crossing16|9|21,775,463|
|32|18|16,284,566|
|64|50|25,144,343|
|128|114|25,351,396|

The first emitted text was `it's okay to jump and jump.` The continuing trace then introduced a sky, Kim and Mia, and a garden. The full unedited tokenizer-decoded trace is in `rolling64-continuity-local.json`. This single fixed-seed trace is continuity/parity evidence; it is not a broad quality or uniqueness score.

## State and failure checks

`hookData` is exactly96 bytes: ABI-encoded `uint64 revision, bytes32 expectedContextHash, bytes32 seed`. The frontend must read the pool's latest revision/hash and preview with those values before constructing a swap. Another successful swap invalidates that quote; the caller must preview again.

Passed checks:

- Every view preview matches its actual swap, including the next context hash.
- Stale revision, stale/forged context hash, and malformed data are rejected without changing model state, pool state, or token balances.
- The PoolManager is the only authorized callback caller.
- Low transaction gas does not advance the story.
- A router revert **after inference and settlement** rolls back the model's newly created KV chunk, context metadata, hook revision, swap state, and balances. The same initial request then succeeds normally.
- Changing model runtime code makes preview fail. Changing an active KV chunk makes the model reject the context.
- An external caller using the same story ID can advance only its own model namespace, not the hook's namespace.
- A second pool starts from an independent empty context and does not change the first pool's story.

## Reproduce

From the research repository root, run:

```sh
node experiments/simplestories-v2/optimization/varied-sentence/continuity/benchmark/run-local.mjs
```

The runner has no public RPC option. It starts a fresh loopback Anvil instance, verifies chain31337 before every mutation, enforces32M transaction/block gas, and shuts down its own instance. It validates and injects549 immutable weight/table/tile runtimes to save setup time. This excludes their deployment cost from the gas measurements. Story context is created through genuine model executions after successful swaps, not through injected KV state.

Compilation uses Solidity0.8.30 with optimizer200, viaIR, Cancun for model/hook/harness; the canonical PoolManager uses0.8.26. Cached compilations are reused only after checking compiler version, settings, entrypoints, and the hashes of every imported source. The fresh model bytecode matches the separately compiled model artifact byte-for-byte.

## Limits before deployment

- This hook intentionally refuses deployment outside chain31337. It is a local research adapter, not a production deployment artifact.
- The current table supports absolute positions0–2047. At2,048 processed positions the hook deliberately rejects further swaps. A long-lived pool needs an explicit, reviewed lifecycle policy before deployment.
- The direct attention window is64 positions. This does not promise exact recollection of the whole preceding story.
- Callers choose seeds freely, and front-running can make a pending preview stale. This seed is not randomness for security decisions.
- The result is one140-turn trajectory with test ERC-20s on an unforked chain. It does not claim live Robinhood gas, live liquidity, broad prose quality, or10,000 unique outputs.

## Frozen evidence

| File | SHA-256 |
| --- | --- |
|`../kernel/SimpleStoriesV2Rolling64Model.sol`|`d9f6cdc02acf6fff54a5ca8524b23a5c13f924f71bc0f8a27c174e56e65ccebb`|
|`ContinuityHook.sol`|`78630707918a97768bffabfab136f86dcdb82fe2cb78c2bdf1f3217014d29453`|
|`rolling64-continuity-local.json`|`71ad27cda8f1ec4de48cbf9aa05b27fe527135ef10aa03e4cdda458ad35d522f`|
|`../quality/rolling64/rolling64-140turn-reference.json`|`b5895ebd07e11edd9ad5f64ab5780a175362a85510828e15539b25294a497cdd`|

