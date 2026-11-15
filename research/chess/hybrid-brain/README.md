# GH0ST hybrid chess coordinator

Robinhood is the game authority. This ICP canister verifies the native game's state, replays its complete UCI history independently with shakmaty, drives the pinned full Stockfish 19 engine, and signs only a legal Black move. A signature cannot declare a winner or bypass the native Robinhood chess rules.

The fixed candidate policy is 24,000,000 nodes, Hash 128 MiB, one thread, full pinned NNUE, maximum skill and retained TT/history within each game. The engine/config hash uses the distinct `GH0ST_ENGINE_CONFIG_V2_RETAINED` domain. A caller cannot choose a smaller search, alternate model, FEN, bestmove, recipient or result. A missing retained reservation after the first Black turn is a refundable fault, never a cleared-cache restart.

The optimized engine retains that search policy and changes exact arithmetic/layout and message slicing. The coordinator additionally requires `quantum=0`, `yield_policy="instruction-budget"` and a 28B-instruction target, plus the immutable approved module hash. An instruction-budget yield pauses the same search; it does not lower its24m-node allowance or discard retained state.

## Bootstrap and one-time deployment binding

1. Allocate the engine and coordinator IDs. Install the engine with the coordinator principal and independently calculated V2 policy hash. Install the coordinator with the exact engine module hash, `reviewed_release=false`, and both native-game binding fields zero.
2. The controller calls `prepare_signer`. The management canister derives the coordinator's threshold ECDSA key under the fixed `GH0ST_HYBRID_CHESS_V1` path. No private key is exported.
3. Deploy the reviewed native Robinhood game with that signer and policy hash. Leave it paused and empty.
4. The controller calls `seal_release` with its contract address and exact runtime hash. The coordinator verifies engine identity and reserves, RPC chain 4663, runtime, canonical token address, signer, policy hash, paused state and absence of an active paid game. It rechecks the chosen block hash and the still-unbound stable configuration before committing.
5. Binding is one-time. There is no method to change the engine, model, key, RPC, search budget or sealed game. Prize funding and unpausing are separate native-wallet operations. Sealing alone never opens entry.

The raw coordinator Wasm exceeds the ingress envelope. The tested installation uses deterministic gzip. **The installed module hash is the gzip blob's hash**, as verified by the actual local management `canister_status` response. The large engine uses `upload_chunk` and `install_chunked_code` with its exact raw module hash.

## Job and recovery behavior

The standard starting position and every historical move must reproduce the native board, raw en-passant square, castling rights, halfmove clock, position hash and transcript commitment. The game ID must also bind its original wallet, full uint256 nonce, chain and contract. The native game must still be active on Black's turn and before its deadline.

Jobs are deterministic for the canonical game/ply/position/config. Another request ID cannot purchase another search for the same turn. A durable per-job lock is written before each asynchronous call. Expected-step retries read the cached engine journal, and uncertain callbacks reconcile instead of blindly restarting. A verified terminal native game permits reservation release and bounded old-job pruning. An engine upgrade that loses retained state remains refund-only for that active game.

A completed full-budget result remains in `Signing` after transient HTTPS/quorum, canonical-read or signature-request failures. A later retry must reverify the still-active native game before signing that same stored result. It never reruns the expensive search to repair a transport failure. Wrong code/model/history/binding or an expired native game still fails closed. `evidence/signing-recovery.json` proves this path using a separate test-only engine fixture that replays a genuine recorded24m result; it explicitly performs no fresh inference.

Only a completed full-budget search can reach threshold signing. Its EIP712 material binds the exact game, original wallet, ply, position, transcript, legal encoded move, engine policy and native deadline. Duplicate completed jobs return the same cached signature. The signature can be relayed by anyone; Robinhood independently checks its legality and adjudicates checkmate/payment.

## Operating bounds and trust

One active native game matches one retained engine instance. Histories are bounded to 1,024 plies and 512 bot jobs per active game. The coordinator requires a 2T-cycle reserve before engine updates/outcalls, and verifies at least 3.5T engine cycles before admission/readiness. These are operating guards, not complete-game cost guarantees or permission for automatic funding.

Public readiness/admission HTTPS verification has a 500B-cycle daily allowance and a rate-limited, generation-bound lease. Final signing has a separate 2T-cycle daily verification allowance and uses the durable job lock, so unrelated public refreshes cannot consume that allowance or occupy its lease. These are maximum allowances; public admission remains a bounded service and can be throttled. No unlimited-availability claim is made.

The official RPC is pinned, queries use at least 12 L2 confirmations, and the selected block hash is checked again. HTTPS subnet consensus and confirmations are **provider/data-availability trust**, not an EVM state proof or a claim of L1 finality. Native Solidity remains authoritative for legal moves and payments. ICP controllers remain trusted to run the promised engine honestly; a threshold signature is not a cryptographic proof of Stockfish execution. Disclose and verify controller/module sets before a funded release.

Dynamic chain/head discovery uses a replicated flexible HTTPS committee of13, requiring at least9 valid Robinhood-chain responses and selecting their median head. Execution rejects a subnet whose node count is not13; it never silently samples13 nodes from a larger subnet under the same four-fault assumption. All subsequent canonical reads use the selected confirmed block, fully replicated HTTPS consensus and a sorted JSON-RPC batch transform. Fewer than9 valid responses fail closed; there is no single-response fallback. CostV2 outcall prepayment is charged against conservative daily allowances; asynchronous unused-budget credits mean that booked prepayment is not identical to net spend.

## Verification

From `research/chess`:

```sh
cargo test --locked --manifest-path hybrid-brain/Cargo.toml --features canister
cargo build --locked --manifest-path hybrid-brain/Cargo.toml --features canister --release --target wasm32-unknown-unknown
engine/.cache/venv/bin/python hybrid-brain/tools/test_pocketic.py
engine/.cache/venv/bin/python hybrid-brain/tools/test_end_to_end.py
engine/.cache/venv/bin/python hybrid-brain/tools/test_end_to_end.py --signing-recovery
```

The core and interoperability suite checks native ABI/board/transcript/EIP712 agreement, signer recovery, tampered canonical state rejection, immutable policy and one-time binding. `evidence/pocketic-coordinator-gates.json` covers actual Wasm installation, controller/anonymous gates, local management key derivation, HTTP normalization and a stable same-source upgrade.

`tools/test_end_to_end.py` uses the **real coordinator and full Stockfish 24m Wasm**, local management ECDSA, and the actual Solidity game in an isolated EVM. HTTPS responses are explicitly mocked from that EVM; its ERC20 is synthetic. The complete result is recorded only after search, native move application, signature caching and native timeout refund all pass. `end-to-end-unpinned-subnet.json` preserves the earlier functional run's unexplained/contaminated balance deltas; it is not a production cost quote. The corrected harness pins Application placement and sets synthetic time before canister creation, with detailed stage balances/reserved-cycle/memory observations.

`evidence/subnet-sizing.json` connects the saved local topology to the pinned PocketIC 16.1 source defaults: 13-node Application execution and 34-node Fiduciary `key_1` signing. This is local test configuration, not a claim about a future mainnet canister's placement.

`evidence/end-to-end-consensus-baseline.json` preserves the full consensus-aware baseline run: **14 checks**, exact **`e7e5`, 24,000,033 nodes, depth38**, over240 engine steps. After65virtualseconds for HTTP credits, warm engine debit was1.239085T cycles and coordinator debit0.038088T. This is the historical fixed100k-node slicing baseline; the current coordinator requires the optimized adaptive engine. `evidence/end-to-end.json` is the current optimized integration evidence when `passed=true`; the harness records exact engine/coordinator hashes and measured costs rather than treating the baseline as the new artifact's proof.

`evidence/signing-recovery.json` passed **17 checks** with the actual coordinator, local management signer and native game, while replaying a genuine stored engine result. It proves an insufficient Signing quorum preserves completed work, makes no new engine advance, and later signs only after successful verification. This fixture run is never a fresh full-engine performance measurement.

The current optimized `end-to-end.json` passed **14 actual integration checks** on the exact release hashes in `release-manifest.json`. It independently matched fresh native **`e7e5`,24,000,033nodes,depth38**, using35 engine updates and36 coordinator updates. After65virtualseconds to settle HTTP credits, warm engine debit was **0.972755T cycles**, and coordinator debit **0.032172T**: **1.004927T paired** for this one decision. The comparable consensus baseline used1.277173T paired, so this measured pair used **21.32% fewer cycles**, with **6.86× fewer engine update hops**. Full-strength policy and actual output remained identical for this position. `engine/optimized` records the separate second retained-decision equality test; no universal position saving or win-probability claim follows from these examples.

Creation/upload/install, autonomous relay signing, RH gas, hosting, failures and position-dependent search variance remain additional costs. Local elapsed time depends on host load and PocketIC; it is not a measured mainnet move latency.

No local test is a mainnet deployment, real GH0ST transfer, public gameplay receipt, Elo rating, calibrated win probability or guarantee that the pool is safe. Paid launch still requires public module/controller/source verification, native receipts, manual operating and prize funding, and the improved policy's broader strength checks.
