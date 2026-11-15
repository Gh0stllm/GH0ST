# Authoritative ICP chess protocol

Source-only Rust chess/session authority using pinned `shakmaty 0.30.2`, `ic-cdk 0.20.3`, `ic-stable-structures 0.7.2`, `sha2 0.10.9` and `sha3 0.10.8`. The engine adapter is a separate C++/Stockfish canister; both components must execute on ICP before any fully on-chain gameplay claim.

**Paid challenge is inactive. `PRODUCTION_READY` is false.** `accept_entry` always refuses admission: the canonical RH verifier/replay-index bridge and payout attestor are still integration work. Local fixture entries can enter the pure Rust core only from tests; no public method seeds them. There is no production fallback bot.

```sh
cargo test --locked --manifest-path protocol/Cargo.toml
cargo build --locked --manifest-path protocol/Cargo.toml --release --target wasm32-unknown-unknown --features canister
cargo run --quiet --locked --manifest-path protocol/Cargo.toml --features canister --example export_candid > spec/chess-authority.did
```

Commands run from `research/chess`. No command deploys a canister, signs an attestation, transfers tokens or funds cycles. The resulting authority module is `protocol/target/wasm32-unknown-unknown/release/gh0st_chess_protocol.wasm`; a successful build proves compilation, not on-chain engine execution.

See [protocol, terms, trust boundaries and launch gates](../spec/PROTOCOL.md), [authority Candid](../spec/chess-authority.did), [engine Candid](../spec/stockfish-engine.did), and [the RH EIP-712 receipt schema](../evm/receipt-schema.json).

The tests check known perft counts, illegal/pinned moves, castling, en passant, underpromotion, full history/repetition, mate/draw precedence, caller/entry binding, stale requests, replay/idempotency, durable pending search, engine failure and expiry. Fixture bot replies demonstrate adjudication paths; they are not evidence of Stockfish strength or a human beating the paid engine.

`evidence/pocketic-authority-gate.json` records execution of the actual authority Wasm in an isolated local PocketIC instance: paid entries stayed disabled for the configured attestor, anonymous calls were rejected, the independently computed configuration hash matched, and stable configuration/gates survived a same-source upgrade. The harness is `tools/test_pocketic_gate.py` and uses the sibling engine lane's local test environment. It cannot seed a game or open paid entry.

The unsigned EIP-712 digest implementation matches the independent Solidity/ethers local test vector, including the exact wallet uint256 entry nonce and domain. This is encoding interoperability, not a live result signature or cross-chain settlement proof.

License: GPL-3.0-or-later, consistent with shakmaty and the Stockfish integration. Preserve upstream licenses and ship corresponding sources with distributed binaries.
