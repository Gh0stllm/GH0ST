# GH0ST Chess frontend

Staged, unpublished `/chess/` interface. Paid actions fail closed by default. No public canister, vault, pool funding, or deployment is represented as live.

From `research/chess`:

```sh
node frontend/build.mjs
node --test frontend/test.mjs
node frontend/test-dom.mjs
python3 -m http.server 8767 --bind 127.0.0.1 --directory frontend/dist
```

Open `http://127.0.0.1:8767/chess/`. Build output is `frontend/dist/chess`. All public filenames are lowercase. Build artifacts include the exact reviewed Solidity source, compiled vault artifact, and current Candid interface. Fonts and GH0ST masthead are reused from Forge with their licenses.

The explicit local rules board uses pinned `chess.js` solely for two human-controlled sides. It has no bot, fee, reward, or onchain execution. Production moves and results come exclusively from the ICP authority. Browser rule calculations only display moves in SAN; the authority supplies legal moves and the canonical position hash. No Stockfish engine executes in the browser.

`service.mjs` implements the current Candid protocol, Internet Identity, certified module/controller verification, pinned engine identity and status checks, exact search configuration, idempotent move request persistence, and read-only reconciliation. An uncertain human update is never retried automatically. `accept_entry` is intentionally absent: the browser cannot assert that its own payment was canonically verified.

`wallet.mjs` enforces canonical chain 4663, public RPC, canonical GH0ST code hash and decimals, original vault deployment receipt and exact constructor bytecode, compiler runtime and immutable consistency, owner, attestor, fixed terms and configuration, solvency, and a full 100k unreserved prize **before** any approval or entry. Its direct paid methods call fresh authority verification themselves. Exactly 25k is approved separately from entry; a preexisting nonzero different allowance must first be reset. There are no funding, owner, or automatic top-up actions in this UI.

Before a wallet can broadcast, transaction intent is stored with original target, calldata, sender and nonce. Unknown outcomes block further sends. Confirmed receipts must match the original transaction and exact entry/approval events. An entry binds `SHA256(raw principal bytes)` to the payout wallet. Reconciliation never broadcasts. A terminal signed result is imported explicitly, checked against authority material and the pinned EIP-712 attestor, and submitted separately. A result download is not a payout receipt.

`public-config.json` is intentionally `unconfigured`. It cannot be set live by a user-facing toggle. A reviewed release must supply exact ICP identities, certified module hashes and controller sets, source/net commitments, budget, vault deployment/runtime commitments, pinned owner/attestor, and release evidence. The canister must independently report production readiness and paid entry admission. Current backend admission is disabled until canonical Robinhood receipt verification exists, so filling placeholders alone cannot launch paid play.

The game clock displays the 24-hour entry deadline, not an invented per-side chess clock. A loss, draw, resignation, or player timeout pays zero and retains the entry; service/engine faults refund the 25k entry. A human checkmate pays 100k **total**, net 75k before gas. Full reserve is separate from the entry fee. After the 7-day reconciliation window an unattested entry can be refunded. The EVM vault trusts the pinned attestor and ICP deployment; it does not independently prove Stockfish execution.

Unit and isolated DOM tests exercise disabled staging, canonical values, principal hashing, runtime corruption, exact receipt/event matching, fresh authority gates, pre-entry full reserves, persisted ambiguous sends, no-resend recovery, 64 board squares and local-only chess interactions. Native responsive browser review is performed separately by the parent task. No live paid entry is tested or claimed here.
