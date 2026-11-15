# GH0ST Chess

**ICP brain. Robinhood game. Fixed 1,000,000 GH0ST checkmate prize.**

The interface is being released at [gh0st.fyi/chess](https://gh0st.fyi/chess/). It is an **unfunded preview**: no public chess engine, deployed game or prize pool is configured, and paid entry stays closed. Local testing, native engine matches and mainnet deployment are separate evidence categories.

## Selected game

- Human plays White from the standard position. Entry: **25,000 GH0ST**.
- Legal human checkmate pays **1,000,000 GH0ST total** to the original wallet, net 975,000 before gas. This is a fixed prize, not the entire pool.
- The full prize must already be free in escrow before entry. Owner withdrawals cannot touch an active reserve. Funding is manual.
- Robinhood Solidity stores the board and complete move transcript, validates every move and decides checkmate. It pays the prize in the checkmating transaction.
- Full Stockfish 19 on ICP plays Black. The stronger candidate uses **24,000,000 nodes**, Hash 128 MiB, one thread, maximum skill, full pinned NNUE and retained TT/history within a game. No lower-strength fallback.
- A dedicated ICP relay advances the bot and submits its signed reply without relying on the player keeping a browser open or choosing to relay Black. The relay is a required launch dependency.
- ICP threshold ECDSA authorizes a Black move, never a winner. The signed move binds game, player, position, transcript, ply, engine configuration, contract, chain and deadline. Native legality still applies.
- A human checkmate pauses new entries until the owner explicitly reopens a reviewed round.
- One active game matches one retained engine instance. White has 24 hours per turn; Black one hour. A missed Black turn refunds the 25,000 entry on Robinhood. Draw, loss, resignation or missed White turn retains entry.

## Strength evidence

The original 3m-node, cache-cleared reference completed six games against 12m White: **one legal White checkmate and five draws**. Six deeper baseline jobs are unfinished and excluded. The winning 195-ply Larsen transcript can be replayed against that unchanged deterministic policy, so it is not the funded candidate.

The improved 3m per-game retained policy drew fresh Larsen games against 12m and 24m challengers (63/57 plies). Four consecutive decisions and a new-game reset matched native execution on actual local ICP, including the changed defence at ply 8. This is case-specific repair evidence, not a population win probability.

The tougher 24m retained candidate passed actual local ICP search/coordinator tests. Two complete native games against 48m White (Larsen and e4) ended in legal Black threefold draws at 65 and 81 plies. These two selected openings do not establish public win odds. [Benchmarks and complete records](benchmarks/README.md).

At 25,000 entry and 1,000,000 payout, entry fees cover prizes at a **2.5% player win rate before execution costs**. That arithmetic is not an estimated win rate or profitability claim. Players may use engines and automation. A repeatable winning strategy could be reused, so stronger search alone does not establish pool safety.

## Measured optimization — same bot

The selected [optimized engine](engine/optimized/) preserves full Stockfish19, the complete NNUE, 24m nodes, Hash128 and per-game retained state. It changes integer implementation and update scheduling, not the chess policy.

| Representative full24m local test | Previous | Optimized |
| --- | ---: | ---: |
| Engine updates | 240 | 35 |
| Warm engine + coordinator cycles | 1.277173T | 1.004927T |
| Best move / actual nodes / depth | e7e5 / 24,000,033 / 38 | identical |

This is **21.32% lower paired compute/coordination cost** and **6.86× fewer engine updates** for the measured opening decision. Fewer updates do not imply the same factor in mainnet wall time. A second consecutive retained search also matched native exactly: Nc6 /24,000,311 /depth39,33updates. Actual local integration elapsed about60seconds; mainnet timing remains unmeasured.

Derived small affine integer layouts and wider Wasm accumulator tiling preserve exact arithmetic. An independent review verified every model byte, all 32,768 sparse weight coordinates and 5 million Wasm/scalar output comparisons. The maximal journal test completed under the 40B instruction ceiling; its all-in debit was around 30.35B cycles, a different quantity. [Quality review](engine/optimized/QUALITY.md) and [paired integration evidence](hybrid-brain/evidence/end-to-end-costs.json).

## Implementation and checks

- [Native game and custody](spec/hybrid-game.md): new HybridChessGame and independent packed-board HybridChessRules. 280 local checks/56 receipts passed, including 4,510 differential/perft positions, all promotion choices, en-passant/castling, 195-ply historical mate replay, simulated 1M payout and hostile token rollback. This is not an external audit.
- [Hybrid architecture and trust](spec/HYBRID.md): RH is authoritative; ICP, RPC and controllers have explicit roles.
- [Selected retained ICP engine API](engine/optimized/): authenticated arbitrary requests, bounded continuation steps, cached retry replies, one-game reservation and upgrade fault policy.
- [ICP coordinator](hybrid-brain/): independently replays canonical RH history, binds engine jobs and signs only the engine's legal Black move.
- [Frontend](frontend/): native wallet moves, canonical board/history, resumable ICP progress, exact fee approval, saved uncertain transaction recovery and independent timeout refund.
- [Read-only deployment preflight](ops/hybrid/): current RH pricing, token identity, CMC rate and launch planning. Preflight sends no transaction.

The full NNUE file is 98,511,183 bytes; the optimized warm 24m ICP engine snapshot occupies 647,773,966 bytes (about 618 MiB). Wasm file size is not live memory. Large model/tool/build files are ignored; pinned sources, GPL notices, patches, manifests and test evidence are retained.

**Public transport is locally hardened:** flexible 13-node/9-valid-response head discovery feeds fully replicated fixed-block state checks. Actual PocketIC tests cover divergent heads and reordered batches. Live ICP-to-Robinhood operation and latency still require the funded mainnet pilot.

Launch requires reviewed canister hashes/controllers/signer, exact paid deployment approval, receipt-backed RH deployment, operating cycles, full prize funding and an end-to-end paid pilot/refund. A preview page does not satisfy these gates.

## Historical alternatives

[Native Robinhood Stockfish research](NATIVE_ROBINHOOD.md), the [legacy ICP game authority](protocol/README.md), old RHChessChallengeVault terminal-attested escrow and [older 3m/10m ICP cost comparison](icp-costs/) remain reproducible research. They are not the selected 24m hybrid deployment. Old 100,000-prize fixtures do not set the new contract's 1,000,000 prize.
