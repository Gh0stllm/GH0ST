# Autonomous ICP bot relay

The relay makes Black's progress independent of the player's browser. A player cannot intentionally refuse to apply the bot's signed reply and then classify that refusal as a service outage to reclaim the entry fee.

This is source and isolated local execution, **not a mainnet deployment or funded service**. Paid entry must remain closed until this relay's actual module/controllers/config, ETH, cycles and timer readiness verify alongside the brain and native game.

## Fixed responsibilities

- Dedicated third ICP canister. Its immutable configuration pins Robinhood chain 4663, the exact game/runtime, coordinator/module, engine configuration and bot attestor. The only RPC is the official public Robinhood endpoint.
- The game stays authoritative in Solidity. The relay never declares a winner, selects a move, changes a position or accepts a browser-chosen bestmove.
- An ICP timer polls for a paid Black turn. It reads the canonical full encoded history, independently replays it through the existing chess core, and requests/advances the fixed 24m job on the pinned coordinator. One bounded action executes per timer tick.
- On completion it independently checks the exact EIP-712 bot signature, current position/history/ply/player/configuration, full 24m budget (or valid maximum-depth completion), and native turn deadline.
- A separate canister-specific `key_1` threshold key pays Robinhood gas. It signs only a type2 transaction with value 0 and calldata for `playBotMove` on the pinned game. It cannot approve or transfer GH0ST, withdraw escrow, change the prize, call an arbitrary address, or send arbitrary ETH.
- The operator funds this dedicated relayer address manually. The approved initial profile remains 0.0025 ETH lifetime gas budget and 0.0002 ETH maximum signed transaction cost. The code also supports a proposed 0.0095 ETH lifetime profile, contingent on separate approval before initialization/funding. The per-transaction ceiling stays 0.0002 ETH. Configured authority is immutable per canister and may be smaller than the supported ceiling. `get_status` reports `configured_lifetime_gas_budget_wei` separately from `maximum_supported_lifetime_gas_budget_wei`; wallet funding cannot increase the configured lifetime authority. There are no automatic top-ups.

The relay starts disabled. `prepare_signer` is controller-only. `set_enabled(true)` verifies actual coordinator identity/readiness and its immutable admission relay principal equals this canister, native code/token/signer/configuration and ETH/cycle reserves before arming timers. Disabling increments an action generation so a late asynchronous enable cannot override the operator's stop. Disabling cannot revoke a transaction already submitted to Robinhood. Broadcast rechecks enabled/non-halted state after prior awaits, so a stop suppresses later identical-byte resend attempts; receipt-only reconciliation remains available while disabled.

## Timers and bounded work

The launch configuration polls advisory state every 30 seconds; pending inference uses 1 second between bounded calls; pending transaction checks use 3 seconds; transient failures back off 15 seconds. Actual IC execution and inter-canister latency add to these delays. No public-network speed guarantee is implied.

Idle advisory polls request only 2–4KiB responses and reuse the observed game ID. A latest-state advisory is fully replicated and can only request fresh verification; it cannot authorize inference, a move, a signature or a nonce. Every 300 seconds the relay refreshes a quorum head and fixed confirmed active/game/ETH state. The pinned native game has no upgrade/delegatecall/selfdestruct path and constructor bindings are immutable; full runtime/token/signer/configuration verification occurs on enable and every Black turn before inference/signing. `last_checked_at` means confirmed freshness and expires after 360 seconds; `advisory_last_checked_at` is separate. Every suggested Black turn independently obtains a fresh quorum head and fixed confirmed snapshot before inference/signing. Full code/history snapshots are fetched when needed for a new Black turn or transaction preparation, rather than on every tick while White thinks. Public `crank` can wake the existing relay, but cannot accelerate the fixed idle rate or bypass disabled/funding/target limits. During an already verified search, liveness polls use cheap fully replicated latest-state hints. A differing active game, ply, result or position triggers fresh confirmed verification before the turn can be discarded. A false latest hint cannot cancel the paid search. The independent 300-second confirmed refresh remains active, and full binding/history checks still precede new inference and ETH signing. Per-turn orchestration is bounded at 300 meaningful coordinator step/phase transitions (unchanged or in-flight replies from concurrent drivers do not consume that bound); a failure never changes Stockfish strength.

The relay has a fixed 2T-cycle daily HTTPS **prepayment booking** limit and 2T-cycle operating reserve. The booking subtracts immediate callback refunds, but deliberately does not count later asynchronous V2 refunds as newly available quota. It is a conservative bound, not a measurement of net cycles burned. Exhaustion reports a liveness fault; it does not weaken the engine or move funds from another service. Frequent polling has an operating cost in addition to inference and signatures. Deployment planning must size these budgets and the actual selected subnet, rather than assuming idle operation is free.

Timers are rearmed after upgrade from stable state. An interrupted coordinator call is reconciled through its idempotent canonical request, not by asking for a fresh search. The brain and engine retain their own source/controller/upgrade trust boundaries.

## Replica agreement

The relay requires an actual 13-node application subnet before enabling or issuing flexible HTTPS. Moving head/nonce/gas observations use the official flexible HTTP API with 13 requests and at least 9 valid replies. Chain 4663 is checked per head reply; the median head selects a numeric confirmed block, gas price uses a bounded median, and dynamic nonces use a conservative maximum. A conflicting nonce blocks a new transaction. The full 60-second HTTP resource reservation remains in place.

All authorizing contract/code/history/balance/confirmed-nonce/gas-estimate reads are fully replicated at that fixed numeric block. Batch response order is normalized by ID. Receipt and by-hash transaction reads remain fully replicated after projecting only checked stable semantic fields; a pending/included race retries. Broadcast normalization recognizes only the exact precomputed hash or a genuinely known identical transaction.

The no-history code snapshot uses a 48KiB response bound; active history snapshots retain 131072 bytes. Large/unavailable responses fail closed. Polling caps are availability limits, not permission to omit a check or trust a single node. See [the shared policy](../ops/hybrid/RPC_CONSENSUS.md) and [the official cycle reservation/refund semantics](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#cycle-cost-calculation).

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
RELAY_FIXTURE_STEPS=35 engine/.cache/venv/bin/python hybrid-relay/tools/test_end_to_end.py
```

The independent ethers vector checks exact ABI encoding, EIP-1559 unsigned/signed RLP, transaction digest/hash, sender recovery and a **genuine previously executed local 24m bot signature**. Journal tests cover duplicate nonce exclusion, exact receipt gas, reserved/lifetime caps and revert freeze. Known signing scalars in vector tooling are explicitly public synthetic test fixtures.

The PocketIC gate harness installs the actual relay Wasm on a 13-node application subnet, derives its real local management key, verifies anonymous/disabled gates, known-hash normalization, nonce-conflict rejection and same-source upgrade preservation. It does not itself prove an active autonomous relay.

The separate end-to-end relay harness recreates the isolated native EVM game and serves a frozen genuine full 24m result from an explicitly labelled fixture coordinator. It proves actual relay timers, separate management ECDSA transaction signing, signed-raw journaling, broadcast, uncertainty/recovery and native application. It does **not** perform fresh Stockfish inference in that relay harness; fresh full-engine/coordinator execution is separately evidenced in `../hybrid-brain/evidence/end-to-end.json`. The relay fixture pins the preserved genuine `end-to-end-pre-quorum.json`, so a concurrent newer engine proof cannot silently change its signed domain or timestamps.

All fixtures use synthetic local cycles, ETH, ERC20 tokens and RPC replies. No mainnet action, real reward or calibrated win probability is established by these tests. EIP-1559 encoding follows [the canonical specification](https://eips.ethereum.org/EIPS/eip-1559); timer semantics follow [the pinned library](https://docs.rs/ic-cdk-timers/1.0.0/ic_cdk_timers/).


## Frozen local release

Raw Wasm: **2,715,335 bytes**, SHA256 `b7d6c638d76bdae5ee93ecf9191b7bd06a6ab011ed607f3f99446d4ae1a19fe1`. Deterministic gzip/installed module: **482,719 bytes**, SHA256 `f95dd4504d04ff7ea6b2927f12ed1639e4492e860e1f39569dc659d00cb23207`.

Passed **21 core/interoperability tests**, **16 actual PocketIC gate checks**, **23 autonomous relay checks**, and independent ethers receipt verification. The complete conservative idle upper bound is **645,990,355,296 cycles/day**, leaving **1,354,009,644,704 cycles** of the fixed daily HTTP booking limit for gameplay.

Release identities, exact completed checks and scoped cost measurements are recorded in [artifact](evidence/artifact.json), [gate proof](evidence/pocketic-gates.json), [autonomous relay proof](evidence/relay-end-to-end.json), [independent receipt verification](evidence/relay-evidence-verification.json) and [cost record](evidence/relay-costs.json). Pre-quorum evidence is preserved separately and is not presented as the current module proof.

The release passed 21 core/interoperability tests. Its active local relay proof includes 8-valid-response rejection, divergent 13-node heads and batch order, genuine signed Black move application, lost broadcast response, same-source upgrade, nonce-conflict freeze, receipt-only recovery, false Black advisory rejection and periodic confirmed readiness. Exact counts and hashes appear in the linked evidence.

Local cycle debits and synthetic gas receipts are not mainnet quotes. The complete idle prepayment projection includes advisory polling and the 300-second head and fixed active/game/ETH state, before asynchronous refunds. Gameplay consumes the remaining daily quota; exhaustion reports an outage without weakening search or spending from another wallet. Mainnet subnet placement, live HTTP reliability and the full-strength public-network move deadline still require a capped public pilot before paid entry.

An optional earlier strict clippy run reported style suggestions. It is not recorded as passed; builds and functional tests are the required checks documented here.

The [35-step cost comparison](evidence/relay-search-cost-comparison.json) executes both the prior search polling path and the optimized candidate. HTTP bookings through the first broadcast fell from **16.088B to 8.681B cycles (46.0%)**, including a false cancellation hint in the optimized run. These are quota bookings, not equivalent net-burn savings. Full fault-recovery and full-idle forecasts are included; no arbitrary-length game or mainnet throughput is guaranteed.

The daily HTTP booking cap is 2T cycles; the quota regression checks exact acceptance at the cap, rejection of one additional cycle, atomic rejection of overflow/oversized reservations and UTC-day rollover. The 2T operating floor, fixed 0.0002 ETH transaction limit, node budget, game rules and signatures are unchanged. The initial profile remains 0.0025 ETH; the proposed 0.0095 ETH profile requires new approval. This is a finite service allowance, not automatic funding or a guarantee of 20 complete games.

The reviewable [init profiles](evidence/init-profiles.json) distinguish the approved initial lifetime budget from the larger proposed profile. Actual local gates install both profiles, while the active relay proof retains the 0.0025 ETH pilot profile. Additional capital/init authority is not inferred from a supported maximum.
