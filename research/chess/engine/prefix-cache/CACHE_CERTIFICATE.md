# Proposal v3: certified prefixes with native auto-replies

**Proposal only.** No existing contract, canister, token balance or active game is changed. This preserves full Stockfish19, unchanged NNUE,24m nodes,Hash128 and retained state. Cache reuse is disclosed separately from fresh inference. The objective is a100ICP total operating cap, not a guarantee that twenty unrelated full games fit it.

## Native cache record and first application

A new contract maintains `lastCheckpointHash` for the active game. Its initial value is the reviewed canonical new-game state commitment for the exact engine module, serializer schema, NNUE and strength policy. White moves change the board/transcript but do not change this retained-state commitment.

Each first computed Black reply is authorized by one enhanced game-bound EIP712 message. Its domain binds Robinhood chain4663, the new contract, name and version3. The signed fields bind:

- first funded game ID and original player;
- immutable engine policy/module and serializer version;
- complete transcript hash before the Black move, current native position hash and ply;
- exact encoded legal Black move;
- incoming `preCheckpointHash` and committed `postCheckpointHash`;
- actual searched nodes, depth and the first-application deadline.

The deployment/policy also binds the standard initial position. Full transcript and incoming checkpoint are essential: equal FENs can have different repetition and retained search history.

The engine finishes its full search, commits the complete post-search snapshot in ICP stable memory, and acknowledges a small content-addressed receipt in a **separate update**. Only after that committed acknowledgement and fresh canonical game verification may the coordinator sign. A cached best move without its complete durable post-state is not admissible.

`playBotMoveAndCache` checks the current active paid game, player, Black turn, position/transcript/ply, incoming checkpoint, immutable policy, deadline and signature. It independently applies the move with native Solidity legality and terminal adjudication. **Only in that same successful move transaction** does it add the prefix cache record and advance `lastCheckpointHash`. There is no standalone method to insert arbitrary certificates. Any failed validation or transfer reverts both effects.

The cache key is a full cryptographic commitment to policy/module/schema, transcript, position, ply and incoming checkpoint. Its stored value needs the Black move and post-checkpoint commitment; provenance can be emitted in events. A repeated identical insertion is idempotent. Conflicting data for an existing key faults/pauses the reviewed round rather than silently overwriting it.

The signature remains game/player-bound for its first use. The reusable object is the **native record established by that valid first application**, not an old signed transaction. This preserves admission-specific authorization while allowing deliberate sharing of a deterministic policy result.

## Repeated prefix: no ICP calls or signatures

After a future human move, Solidity first performs all normal native checks, clocks and terminal/draw adjudication. If the game remains active with Black to move, it computes the prefix key. If a certified record exists, it validates and applies exactly **one** cached Black move in the same human transaction, advances the checkpoint commitment and runs native adjudication again.

The two moves are atomic. Insufficient gas reverts the whole human transaction. A checkmating/terminal White move skips the auto-reply. The player cannot withhold a cached Black response to manufacture a bot-timeout refund. No browser or relay is needed for that cache hit, no ICP threshold signature is produced, and no project-funded gas transaction is sent. The human pays the combined native transaction gas, which must be estimated and shown before signing.

The UI labels the move **certified checkpoint reused**, links its original search and first native application, and never presents it as a new24m computation. Native receipts continue to determine checkmate and payout.

## New branch: restore exact state and search normally

If no record exists, the human transaction leaves a normal Black turn. The protected ICP relay reads and independently verifies the entire canonical history. It locates the snapshot named by the game's last checkpoint and verifies exact module/schema/policy, original source prefix/result and checksum.

The saved post-search state corresponds to the search input immediately before its Black move. Restoring it therefore sets the engine's previous-input history and previous Black response, then the next request extends those by that same Black move and one new human move. Full history reconstructs `Position`/`StateInfo`; no process pointers are imported.

The prototype intentionally accepts restoration only when the destination already matches the incoming digest. Production direct restore must instead authenticate the snapshot and its lineage against the current native game, then load its complete post-state into an arbitrary idle engine without replaying its parent snapshots. That direct-restore API and its cross-game proof remain unimplemented. A header incoming digest describes the source decision; it is not authority to restore authorization state.

The restore must alter only the Stockfish retained state. Current reservation, coordinator principal, game ID, job IDs, request intents, clocks and reply journals remain those of the new game. Its API accepts only the pinned coordinator, exact native game/checkpoint bindings, an idle engine and bounded idempotent phase/cursor state. Old game IDs and expired restore intents cannot resurrect a game.

Restore validation is transactional: either build an inactive engine and swap after all checks, or keep admission closed through bounded staging and commit only when complete. A new block/terminal outcome must be rechecked after awaits. Missing/corrupt data fails closed into the existing native timeout/refund path; it must not reset histories or use a weaker answer. The next fresh search still gets exactly24m nodes and Hash128.

## Storage, bounds and operations

Each native proof snapshot was163,086,838bytes, about155.53MiB.80 snapshots occupy about12.15GiB. The98,511,183-byte NNUE (about94MiB) is shared read-only and need not be copied per prefix. An initial bound such as128 pinned entries is about19.44GiB of stable data, independent of heap limits.

Every checkpoint referenced by a reusable native record must stay available while that cache epoch accepts games. **Ordinary LRU eviction is unsafe.** At capacity, stop adding native cache entries and handle new branches with normal fresh-search moves, or retire an epoch only while entries are paused and no game depends on it. Epoch, availability and storage-reserve changes require reviewed operator handling. Stable indexes and checksums persist across upgrades; an active in-flight search still follows the current explicit upgrade-fault policy.

The synthetic160MiB restore costs27.49Bcycles with two SHA256 passes. A separate incoming-state hash could exceed40B if combined with it. Use separate bounded updates, or an authenticated checkpoint lineage and a separately verified restore; measure the actual C++ logical serializer before selecting a limit. First cache commits also need their own update, never appended to the existing28B search slice.

Persist separate search-complete, checkpoint-staged, checkpoint-committed, signed and native-applied phase records. A crash or upgrade between phases must resume from the durable content hash and canonical chain receipt rather than repeat a signature or broadcast. If the snapshot commit fails, keep the result unsigned; if the native application is uncertain, reconcile its receipt before retrying. Pin all snapshot data before exposing the native record. A staged restore must keep game admission closed and never publish partially restored state. Existing job/auth journals remain authoritative and are not loaded from a snapshot.

Maintain one active game initially. The fixed1M GH0ST prize,25k entry, native checkmate payout, human-win pause and manual pool funding remain unchanged. Existing services and balances are not funding sources.

## Budget evidence and the hard limit

[`budget.json`](evidence/budget.json) is generated from saved local execution, the certified CMC rate, actual native snapshot bytes and the synthetic IC copy probe. In its explicit **twenty repeated80-decision paths** scenario:

1. The first path computes80 full searches and creates80 certificates/snapshots.
2. The other1,520 Black replies are native cache hits and require no ICP inference or threshold signatures.
3. Storage, creation, operating reserves, a conservative30-day idle allowance and20% fresh-work contingency are included separately.

This illustrative shared-path scenario totals about82.36ICP at the saved rate, including the13ICP already converted rather than adding it again. About101 fresh prefixes fit the same arithmetic with storage charged per fresh checkpoint, so the1,600-request example needs at least93.6875% reuse; this is an assumption, not an observed human-game hit rate. **Twenty unique paths do not**:1,600 fresh searches remain over1,000ICP before contingency. Persisting all1,600 checkpoints gives about1,308ICP with those allowances and contingency and requires a larger cache capacity than the initial128-entry bound; stopping cache growth does not remove the fresh-search expense. The cache must cover a very high fraction of requests; ordinary independent human games may diverge too early. Longer games, rate changes, real serializer cost, HTTP behavior, live storage pricing and time spent waiting for players remain uncertainties. Twenty-game capacity must never be advertised as guaranteed from these examples.

This v3 design changes the contract ABI, EIP712 policy and engine/coordinator APIs. The existing immutable game cannot be patched to add it. A new paused deployment, complete native legality/custody/gas tests, full actual-IC restored-search equality, cross-game/epoch/poisoning tests and a capped mainnet pilot are required before any production integration. No new spending or deployment is authorized by this document.
