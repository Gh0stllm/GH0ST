# Relative64 continuity: scoped implementation review

Reviewed candidate sources:

- Model: `e11808d3b4ebb1828ec2bd09be84738f688ee30081bb1e62ce6fe548d68143df`.
- Hook: `e55e95a4cc29e0f393c45f179e2ad1924c2f8e649cbdeb9ea843ec065edaa828`.

This is a local implementation review, supported by the accompanying PoolManager report. It is not an external audit or a production deployment approval.

## Context ownership

The model namespaces a story by `keccak256(abi.encode(msg.sender, storyId))`. During a pool callback, the owner is the hook contract and the story ID is the canonical PoolId. No method accepts arbitrary replacement KV state or allows an EOA to update a different owner's story. `previewFor` is read-only. A second pool and an EOA using the same story ID are independent namespaces.

The hook accepts callbacks only from its immutable PoolManager and checks that the PoolKey points to itself. There is no reset, administrative execution, or direct model-advance entrypoint. Runtime code for the selected model is pinned at hook construction and checked during both preview and execution.

## Authenticated numerical history

Each successful model advance creates a STOP-prefixed child contract containing a version 2 header and numerical raw keys/values. The header has an eight-byte starting position, one-byte count, and one-byte format. The model checks runtime hash, exact length, format, contiguous position coverage, and count when loading history.

Only the newest suffix needed for a 64-position window is read. Older raw keys are not rewritten or repeatedly rotated; a scratch array receives the relative rotation for the current query. This avoids cumulative rounding from repeatedly modifying stored keys. The source applies `R(-age)` to keys using ages 0–63 and leaves the query unrotated. This is a separate Q12 formulation, validated against its own independent reference.

The model's table contains 64 relative ages and does not index an absolute position table. Position and generation counters are uint64, and the child header carries the complete uint64 start. The practical numeric endpoint is 2^64, not the previous 2,048-position table boundary. Checked arithmetic still applies at that endpoint.

## Preview and atomicity

Hook data is exactly 96 bytes: `uint64 revision, bytes32 expectedContextHash, bytes32 seed`. Both the hook revision and model context hash must match before inference. The seed is forwarded unchanged, and the token policy is identical in preview and execution: two tokens while processed is at most 26, one thereafter.

Each returned token must be a valid vocabulary ID, terminal markers may appear only at the end of a returned chunk, and termination flags must match the last token. The model's resulting stored context must equal the returned next hash. The hook then advances its own revision/hash in the same transaction. A revert from the hook, PoolManager, settlement, or router rolls back child creation and all context changes.

Because another successful swap advances the shared pool story, a queued quote may become stale. The client must obtain the current revision/hash and preview again. Caller-selected seeds are not secure randomness and can be intentionally selected; this is acceptable for a public generative stream, not for lotteries or security decisions.

## Gas and lifetime

The model call is capped at 29.25M gas and the tested transaction limit is 32M. An EIP150 reserve is checked before entering inference. The two-token cutoff was lowered to 26 after a separate model-only control ending at position 32 consumed 29.94M gas; that control exceeds this hook's model budget. The final gas evidence is in `relative64-continuity-local.json` and its verified summary.

Active computation and the loaded KV suffix are bounded to 64 positions. Total historical storage is not bounded: each successful advance adds a numerical child and an index entry. Long-term storage growth is therefore linear in swaps even though inference does not scan the full history.

The hook remains intentionally restricted to chain 31337. Production requires a separately reviewed deployment variant, exact network contract checks, and integration of the revision/hash/seed protocol. A 2,060-swap trajectory is strong continuity evidence, but does not prove a worst-case gas bound or language quality across every reachable model state and seed.
