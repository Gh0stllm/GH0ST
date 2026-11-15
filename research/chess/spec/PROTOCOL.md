# GH0ST chess authority protocol — review source

Status: **not deployed; paid entry disabled; production ready false**. Local Rust tests exercise game rules and session transitions. Compiling a Rust authority Wasm does not prove the C++ engine runs under ICP consensus, the RH bridge verifies canonical receipts, or anyone has funded or won a paid game.

## Intended execution and trust boundary

1. The wallet calls the Robinhood Chain vault. Its `EntryAccepted` log fixes the game ID, wallet, raw-principal SHA-256 commitment, wallet nonce, immutable engine-configuration hash and deadlines. The vault reserves the full 100,000 GH0ST liability before accepting the 25,000 GH0ST fee. Funding is manual.
2. A deployment-specific canonical RH verifier validates that exact successful receipt and log against chain 4663 and the pinned vault. An authenticated ICP attestor admits the entry exactly once. **That canonical verifier and its production replay index are not implemented here.** The authority's `accept_entry` deliberately returns `ChallengeInactive`, even to the configured attestor. There is no controller flag or fixture endpoint that bypasses this gate.
3. The player uses the wallet-bound ICP principal to submit a UCI move plus expected ply/position hash. Rust `shakmaty 0.30.2` validates a complete standard 8×8 position held inside the authority canister. The authority accepts no client-selected initial FEN, board state or winner. The browser renders state and sends move intentions.
4. The authority commits the human move and a unique pending search in one update. A separate `run_bot` update calls the pinned Stockfish canister with the initial position and **complete legal UCI history**, fixed nodes/hash budget and engine configuration hash. Search happens on that canister; it is not a browser or chat-model decision. The engine must authorize only this authority principal, enforce identical immutable settings, clear its transposition table/history for each job, and cache request IDs or reject conflicting retries. The response is checked against the saved job, version/network/configuration and legal moves before a single bot move is committed.
5. The terminal authority record exposes unsigned result material. A pinned ECDSA attestor must attest/relay the terminal result to the RH vault using the agreed EIP-712 domain/schema. **Signing and relay are not implemented by this Rust canister.** Solidity trusts that attestor for the ICP evidence; it does not independently prove Stockfish execution or ICP source. A browser query response is not sufficient signing evidence: the attestor needs a verified ICP agent/certificate or an authenticated update response and must pin both canister identities/code versions.

Controllers able to upgrade the authority, engine or signing canister can change their future behavior. A publicly documented upgrade policy, frozen controllers or equivalent verifiable governance is a launch gate. The current source is not a trustless cross-chain proof system. External engines cannot be excluded by wallet/principal binding; a player may use outside assistance.

## Fixed economic terms

| Outcome | Code | GH0ST paid to bound entry wallet |
|---|---:|---:|
| Human legally checkmates the bot | 1 | 100,000 total; 75,000 net before network costs |
| Bot legally checkmates the human | 2 | 0 |
| Draw | 3 | 0 |
| Human resigns | 4 | 0 |
| Human abandons the game | 5 | 0 |
| Service fault | 6 | 25,000 entry refund |
| Engine invalid response/abort | 7 | 25,000 entry refund |

The human is White and moves first. Every game starts from the standard position. The proposed immutable duration is 24 hours from the RH entry, followed by seven days of settlement reconciliation. Ordinary results 2–5 retain the entry fee. A vault entry left unsettled after the reconciliation deadline has a permissionless 25,000 refund; this unresolved-evidence fallback is distinct from a signed abandonment result. Outcome 8 exists only inside the vault for that fallback and is never signed by the protocol.

## Authoritative state and transitions

`Game` stores the bound `VerifiedEntry`, immutable `EngineConfig`, canonical FEN, full per-ply move/audit history, repetition keys, rolling transcript hash, idempotency keys, pending search and terminal result. Castling, legal en passant, checks, checkmates, stalemates, all four promotion choices and insufficient material are validated by the rules library. Repetition keys contain the legal en-passant state and castling rights but exclude move counters.

| Current phase | Accepted event | Result |
|---|---|---|
| No game | Canonically verified, authenticated, unused entry | `WaitingHuman` at the standard initial position |
| `WaitingHuman` | Bound principal submits legal fresh move | Terminal if mate/draw; otherwise committed `WaitingBot` |
| `WaitingBot`, queued | Permissionless `run_bot` | Mark `in_flight` in stable memory, then await fixed engine canister |
| `WaitingBot`, in flight | Matching valid engine reply | Legal move committed once; `WaitingHuman` or terminal |
| `WaitingBot` | Engine reject, invalid reply or deadline reached | Refundable terminal result; previous human move preserved |
| `WaitingHuman` | Valid human draw claim / resignation / deadline reached | Draw / resignation / abandonment |
| Any active phase | Bound principal resigns before deadline | Terminal resignation |
| Terminal | Duplicate identical move/search completion | No additional move or payout authorization |

Threefold repetition and the 50-move rule are claimable. The player may claim the current position or announce one legal move that would make the claim valid. The bot always claims an available current-position draw. Fivefold repetition and the 75-move rule end the game automatically; checkmate on the final move takes precedence. `shakmaty`'s material-based insufficient-material detection is used; this implementation does not claim to solve every abstract FIDE dead-position construction. Agreed draws and draw offers are not provided.

A failed or late engine call never rolls back a previously accepted human move and never counts as human checkmate. Callback state is checked again after the await to handle interleaving resignation/expiry safely. One pending job can start only once. A stuck callback can be resolved only to a service-fault refund by the configured attestor after ten minutes, or by anyone at the game deadline. No game can be restarted with a different engine or weaker fallback.

## Identity, replay and hashes

All hash prefixes below are literal UTF-8 plus a zero byte. Variable fields use a four-byte unsigned big-endian length prefix. Numeric fields use fixed-width big-endian encoding. `Hash` is exactly 32 bytes, `Address` exactly 20 bytes, and entry nonce is the exact 32-byte big-endian uint256 from the vault.

* `principalHash = SHA256(Principal.as_slice())`; hashing its display text would produce a different value.
* `gameId = keccak256(abi.encode(uint256(4663), vault, player, nonce))`, matching the vault.
* `engineConfigHash = SHA256("GH0ST_ENGINE_CONFIG_V1\0" || len+enginePrincipalRaw || len+stockfishCommitLowerHex || len+nnueSha256LowerHex || nodes:u64 || hashMb:u32 || cyclesPerSearch:u64 || [1,20,0,1,1])`. The last five bytes fix one thread, skill 20, strength limiting disabled, MultiPV 1 and cleared search state.
* `positionHash = SHA256("GH0ST_POSITION_V1\0" || len+canonicalFen)`. Canonical FEN contains all six fields with legal en-passant encoding.
* Initial transcript commits to `gameId, player, principalHash, nonce, engineConfigHash, initialPositionHash` under `GH0ST_GAME_TRANSCRIPT_V1`.
* Each ply commits to previous transcript, ply, UCI move, new position hash and presence/contents of the engine audit under `GH0ST_PLY_TRANSCRIPT_V1`. The audit includes job ID, requested/actual nodes, actual completed depth, measured Wasm instructions, engine commit and network hash.
* Terminal transcript additionally commits to result code, reason and completed-at timestamp under `GH0ST_TERMINAL_TRANSCRIPT_V1`.
* A pending job commits to game ID, current transcript and engine configuration under `GH0ST_SEARCH_JOB_V1`.

Identical human request IDs and bodies return the current game without applying a second move, even after the original phase has changed. Reusing an ID with different content is rejected. The principal is authenticated before checking duplicate requests. Exact repeated entries are idempotent; a RH transaction/log pair cannot admit another game. The review core's in-memory replay map is tested; persistence of that map belongs to the blocked production verifier integration.

## Compute and persistence

Search uses fixed node limits rather than wall-clock controls, one thread, maximum skill, strength limiting disabled, no external opening book, no Syzygy dependency and cleared TT/search history for every decision. Nodes, hash memory and attached cycles are immutable per game. Actual nodes and completed depth are recorded. Stockfish can overshoot a node limit slightly; a response above requested nodes plus 65,536 aborts. A lower node count may be a natural early search termination and is recorded, not promoted into a rating claim. The engine must enforce the request settings independently; response strings alone cannot prove a binary used them.

The source supports 1–10,000,000 requested nodes, 1–256 MiB hash and at most 1 trillion attached cycles per search. Those are admission bounds, **not a measured paid strength configuration**. Only the pinned Stockfish 19 commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d` and official full NNUE SHA-256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2` pass source configuration validation. A fixed paid configuration is selected only after real ICP instruction/cycle/latency calibration. A single ICP message may not fit that budget; if the engine cannot finish legally within consensus limits, launch stays disabled until a resumable full-strength implementation is verified. There is no fallback model.

The authority stores each game independently in `ic-stable-structures` memory region 1, with immutable configuration in region 0. Region 2 is reserved for the future canonical RH replay index. Stable records survive upgrades without serializing all games in `pre_upgrade`. Schema version is 1; incompatible upgrades need an explicit migration. Inputs are bounded by legal move length, exact fixed-width types and a maximum of 1,024 plies per game. Hitting the resource ceiling produces a service-fault refund, not a fabricated draw or win. Encoded game size is capped at 1.5 MB. Admission count/retention/backpressure must be enforced by the future entry integration; the pure core caps retained games at 5,000.

## Launch gates

* Reproducible Stockfish C++ ICP module plus pinned official source, patch, network and Wasm hashes; measured worst-case message instructions and cycles, deterministic search checks and a declared fixed paid node budget.
* Canonical RH successful-receipt/event verification with a specified finality/reorg policy; stable transaction/log consumption; chain, vault, token, wallet, nonce, fee and reserved-prize checks.
* Correct `EntryAccepted` to principal binding, idempotent cross-chain retry behavior and end-to-end local/integration receipt fixtures using the exact EIP-712 schema.
* Attestor evidence verification, key custody/rotation, replay/domain checks, signing/relay and controller/upgrade policy review.
* Full authority/engine/vault integration tests including game-start race, lost callback, late reply, wrong engine identity, exhausted cycles, expiry, draw, human mate, bot mate and exact payout to the original wallet.
* Explicit user funding/deployment authorization. No code here deploys, signs, spends or automatically tops up.

Reference APIs: [shakmaty 0.30.2](https://docs.rs/shakmaty/0.30.2/shakmaty/), [ICP inter-canister calls](https://docs.internetcomputer.org/guides/canister-calls/inter-canister-calls/), [ICP stable structures](https://docs.internetcomputer.org/languages/rust/stable-structures/).
