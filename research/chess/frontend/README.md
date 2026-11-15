# GH0ST Chess hybrid frontend

The `/chess/` release uses ICP for the Stockfish brain and Robinhood Solidity for the canonical board, legal moves, checkmate adjudication and GH0ST rewards. The public configuration remains unconfigured and paid entry is closed until a reviewed deployment and prize reserve exist.

Entry is **25,000 GH0ST**. Legal human checkmate pays **1,000,000 GH0ST total**, net **975,000 GH0ST** before gas. The full prize must be unreserved before approval or entry; entry cannot fund its own reserve. No automatic topups. One active game holds the retained engine. A draw, loss, resignation or missed White turn retains the fee. The bot missing its one-hour turn deadline permits a 25,000 GH0ST refund; White has 24 hours per turn.

The stronger candidate uses full Stockfish 19 NNUE, **24 million nodes**, Hash128MiB, and TT/history retained only within the same game. This is a candidate setting, not a calibrated Elo or unbeatable claim. There is no browser engine and no silently weaker fallback.

From `research/chess`:

```sh
node frontend/build.mjs
node --test frontend/test.mjs
node frontend/test-dom.mjs
python3 -m http.server 8767 --bind 127.0.0.1 --directory frontend/dist
```

Output is `frontend/dist/chess/`, with lower-case public filenames, local fonts and GH0ST assets. The build includes exact native game/rules sources, the compiled game artifact, and the coordinator and relay Candid interfaces.

`wallet.mjs` pins chain4663, canonical GH0ST code/decimals, the original native-game deployment receipt and exact constructor, reviewed runtime/immutables, owner, attestor, policy hash, fixed entry/prize terms, reserve solvency and engine occupancy. Paid methods independently refresh the brain gate. Exactly25k approval and entry are separate user actions; a different nonzero allowance must first be reset. No funding/owner methods appear in the UI.

The game loads `getGame` and `getMoves` at the same Robinhood block. Independent chess.js legal replay checks the board, side, castling, halfmove clock, full transcript hash, raw en-passant target and position commitment. Browser legal previews cannot override Solidity. White moves use the original wallet. Brain requests carry only the paid game, expected canonical state and full move history; the server must independently verify them.

`service.mjs` checks certified ICP module/controller sets and the coordinator's pinned engine, retained cache policy, fixed budget, signer and RH game binding. It persists each search request or expected advance step before the update. Unknown outcomes are queried before another update. The browser runs at most300 bounded advances per action and resumes saved progress. A completed EIP712 Black move binds chain, game contract, game, original player, ply, position, transcript, encoded move, policy hash and expiry. Applying it is a separate explicit wallet action. Native legal checkmate pays in that same game transaction; no terminal-result attestor chooses winners.

Wallet transaction intent is saved before broadcast with original target, calldata, sender and nonce. Ambiguous results block new sends. Reconciliation verifies the original transaction, move event and exact canonical token payout. Reconciliation never broadcasts. Timeout/refund actions depend on native game verification and remain available even if the ICP brain is unavailable.

The local rules board is explicitly both-human chess.js on this device, with no engine, fee, prize or onchain claim. Unconfigured staging makes no external RPC/ICP reads and keeps all paid actions disabled. The release configuration cannot be made live through a user-facing toggle. It needs exact deployed identities, certified module/controller sets, source/network commitments, runtime/deployment proofs and funded reserve.

18 focused unit tests and an isolated DOM test cover reserve/custody guards, all four promotions, canonical history commitments, signer/game binding, persisted uncertain sends and search steps, exact payout transfer verification,64 squares and explicit local-only interactions. These checks do not replace a full contract audit or public end-to-end deployment evidence.

A single search action can drive up to 300 bounded coordinator updates. The optimized fixed 24m-node search yields near 28B instructions per engine update; the representative first turn used 35 engine updates plus signing. Stop helping stops the browser after the current step; it preserves the onchain continuation and does not refund or abandon the game. Stale-only readiness is refreshed once before an explicitly requested action; uncertain updates are still reconciled without automatic resends.

The promoted execution profile preserves 24m nodes, full NNUE and Hash128 while yielding near 28B instructions per update. Runtime identities and controllers for coordinator, optimized engine and autonomous relay all gate entry. Confirmed relay readiness lasts 360s; every authorizing Black-turn check remains fresh. Stopping the browser helper does not stop the autonomous relay.

The reviewed brain must pin the same immutable relay principal that the page verifies. Paid gameplay has a separate admission allowance from anonymous status requests. The page also pins the relay’s configured lifetime gas budget; the supported upper ceiling is not spending approval. The preview retains the approved pilot profile of 0.0025 ETH; a proposed 0.0095 ETH profile requires the separate capacity budget approval.
