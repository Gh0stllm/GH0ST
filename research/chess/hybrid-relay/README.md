# Autonomous ICP bot relay

The relay makes Black's progress independent of the player's browser. A player cannot intentionally refuse to apply the bot's signed reply and then classify that refusal as a service outage to reclaim the entry fee.

This is source and isolated local execution, **not a mainnet deployment or funded service**. Paid entry must remain closed until this relay's actual module/controllers/config, ETH, cycles and timer readiness verify alongside the brain and native game.

## Fixed responsibilities

- Dedicated third ICP canister. Its immutable configuration pins Robinhood chain 4663, the exact game/runtime, coordinator/module, engine configuration and bot attestor. The only RPC is the official public Robinhood endpoint.
- The game stays authoritative in Solidity. The relay never declares a winner, selects a move, changes a position or accepts a browser-chosen bestmove.
- An ICP timer polls for a paid Black turn. It reads the canonical full encoded history, independently replays it through the existing chess core, and requests/advances the fixed 24m job on the pinned coordinator. One bounded action executes per timer tick.
- On completion it independently checks the exact EIP-712 bot signature, current position/history/ply/player/configuration, full 24m budget (or valid maximum-depth completion), and native turn deadline.
- A separate canister-specific `key_1` threshold key pays Robinhood gas. It signs only a type2 transaction with value 0 and calldata for `playBotMove` on the pinned game. It cannot approve or transfer GH0ST, withdraw escrow, change the prize, call an arbitrary address, or send arbitrary ETH.
- The operator funds this dedicated relayer address manually. The default reviewed limits are0.0025 ETH total gas budget and0.0002 ETH maximum signed transaction cost. The configuration may use smaller limits; it cannot exceed those code bounds. There are no automatic top-ups.

The relay starts disabled. `prepare_signer` is controller-only. `set_enabled(true)` verifies actual coordinator identity/readiness, native code/token/signer/configuration and ETH/cycle reserves before arming timers. Disabling increments an action generation so a late asynchronous enable cannot override the operator's stop. Disabling cannot revoke a transaction already submitted to Robinhood.

## Timers and bounded work

Idle polling defaults to 15 seconds; pending inference uses 1 second between bounded calls; pending transaction checks use 3 seconds; transient failures back off 15 seconds. Actual IC execution and inter-canister latency add to these delays. No public-network speed guarantee is implied.

Idle polls request only 2–4KB responses and reuse the observed game ID. Full code/history snapshots are fetched when needed for a new Black turn or transaction preparation, rather than on every tick while White thinks. Public `crank` can wake the existing relay, but cannot accelerate the fixed idle rate or bypass disabled/funding/target limits. Per-turn orchestration is bounded at 300 meaningful coordinator step/phase transitions (unchanged or in-flight replies from concurrent drivers do not consume that bound); a failure never changes Stockfish strength.

The relay has a fixed 1T-cycle daily HTTPS debit limit and 2T-cycle operating reserve. Exhaustion reports a liveness fault; it does not weaken the engine or move funds from another service. Frequent polling has an operating cost in addition to inference and signatures. Deployment planning must size these budgets and the actual selected subnet, rather than assuming idle operation is free.

Timers are rearmed after upgrade from stable state. An interrupted coordinator call is reconciled through its idempotent canonical request, not by asking for a fresh search. The brain and engine retain their own source/controller/upgrade trust boundaries.

## Transaction journal and uncertainty

1. Verify the exact canonical completed bot turn and a vacant relay account nonce. Estimate gas, apply bounded headroom, and check fee, wallet balance and remaining approved lifetime budget.
2. Persist the full unsigned transaction, exact nonce and reserved maximum gas cost **before** requesting its threshold signature.
3. Persist exact signed raw bytes and their Keccak hash **before** broadcasting. The transaction cannot subsequently change its nonce, target, calldata, fee or value.
4. Persist `Submitted` before the HTTP outcall. Identical raw-transaction repeats are the same Ethereum transaction; known-transaction replies normalize only to that precomputed hash. A nonce-too-low response is never relabelled successful.
5. Reconcile exact transaction/receipt, sender, target, nonce, value, calldata, gas, block hash and confirmations before freeing the intent or considering another nonce. Unknown conflicting nonce state halts spending. An absent transaction may be rebroadcast at most 3 times with identical bytes, after a delay and a vacant exact nonce; no replacement transaction is constructed.
6. Charge the actual confirmed receipt's gas once. A genuine unexplained revert halts. If another relayer already applied precisely the same Black move, canonical history proves that outcome; the recorded revert's gas is accounted without treating the game as an outage.

`reconcile_pending` is a receipt-only recovery path available even while halted/disabled. It never signs, rebroadcasts, alters a transaction, creates a nonce or re-enables an operator-disabled relay. Only confirmation of the existing exact intent clears a nonce-conflict halt. An unexplained already-accounted revert remains halted.

The lifetime limit bounds signed maximum gas liabilities, not just historical gas usage. Uncertain/signed intents keep their reservation. A stuck nonce can require operator recovery or a reviewed replacement deployment; there is no unsafe reset/withdraw endpoint.

## Verification

From `research/chess`:

```sh
cargo test --locked --manifest-path hybrid-relay/Cargo.toml --features canister
cargo build --locked --manifest-path hybrid-relay/Cargo.toml --features canister --release --target wasm32-unknown-unknown
cargo run --quiet --locked --manifest-path hybrid-relay/Cargo.toml --features canister --example export_candid > hybrid-relay/relay.did
node hybrid-relay/tools/transaction-vector.mjs
engine/.cache/venv/bin/python hybrid-relay/tools/test_pocketic.py
```

The independent ethers vector checks exact ABI encoding, EIP-1559 unsigned/signed RLP, transaction digest/hash, sender recovery and a **genuine previously executed local 24m bot signature**. Journal tests cover duplicate nonce exclusion, exact receipt gas, reserved/lifetime caps and revert freeze. Known signing scalars in vector tooling are explicitly public synthetic test fixtures.

The PocketIC gate harness installs the actual relay Wasm on a 13-node application subnet, derives its real local management key, verifies anonymous/disabled gates, known-hash normalization, nonce-conflict rejection and same-source upgrade preservation. It does not itself prove an active autonomous relay.

The separate end-to-end relay harness recreates the isolated native EVM game and serves a frozen genuine full 24m result from an explicitly labelled fixture coordinator. It proves actual relay timers, separate management ECDSA transaction signing, signed-raw journaling, broadcast, uncertainty/recovery and native application. It does **not** perform fresh Stockfish inference in that relay harness; fresh full-engine/coordinator execution is separately evidenced in `../hybrid-brain/evidence/end-to-end.json`.

All fixtures use synthetic local cycles, ETH, ERC20 tokens and RPC replies. No mainnet action, real reward or calibrated win probability is established by these tests. EIP-1559 encoding follows [the canonical specification](https://eips.ethereum.org/EIPS/eip-1559); timer semantics follow [the pinned library](https://docs.rs/ic-cdk-timers/1.0.0/ic_cdk_timers/).


## Frozen local release

Raw Wasm: **2,548,818 bytes**, SHA256 `f0b66473885c223e11f2fef48efc888ae264e921bdef6ac836d1d062b6a9c10a`.

Deterministic gzip/installed module hash: `0a7645d5cd27edd3c67edfd2d070875dd789653c7d620398e412c2bfbd399fd5` (455,546 bytes).

The release passed **11 core/interoperability tests**, **14 actual PocketIC gate checks**, **14 autonomous relay execution checks**, and independent ethers decoding of the raw transaction and native MovePlayed receipt. The relay execution interval used **31,288,547,702 local cycles**, including its separate threshold transaction signature and lost-reply/upgrade/nonce-conflict recovery. Its synthetic gas receipt is not a mainnet gas quote. See [artifact](evidence/artifact.json), [gate proof](evidence/pocketic-gates.json), [autonomous relay proof](evidence/relay-end-to-end.json), [independent receipt verification](evidence/relay-evidence-verification.json) and [scoped cost record](evidence/relay-costs.json).

An optional strict clippy run reported style suggestions (collapsible conditions, unnecessary unwrap, newer integer/chunk idioms). The functional release, tests and module identity are frozen; that style-only check is not recorded as passed.
