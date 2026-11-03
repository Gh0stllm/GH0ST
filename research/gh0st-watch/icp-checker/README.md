# GH0ST Watch on ICP

The first ICP checker runs an EVM simulation inside a Rust canister. It tests whether an ordinary account can mint seven units to itself on a fresh deployment. A second call checks that the deployer can mint seven units to another recipient. This release supports one of the six research checks.

[Open the temporary ICP preview](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=6cajv-qqaaa-aaaab-qactq-cai). Select **Query** under **demo**. The hosted playground can recycle this canister ID when its reservation expires. The recorded 3 November 2026 run is in [preview-result.json](preview-result.json).

| ICP demo | Ordinary mint | Ordinary balance | Deployer control |
|---|---|---|---|
| Open mint | Succeeded | 0 to 7 | 0 to 7 |
| Protected mint | Reverted | 0 to 0 | 0 to 7 |

To check compatible code, open **check_mint**, paste hexadecimal EVM creation bytecode into the first field and choose the balance getter with the second field. Use true for `balanceOf(address)` or false for `balance(address)`. The target must expose `mint(address,uint256)`. Constructor arguments, if required, must already be ABI-encoded after the creation bytecode. The simulation uses Shanghai rules, an isolated empty chain, zero deployment value, a 12 KiB input limit and an 800,000 EVM gas limit per simulated transaction. The two [open](open.hex) and [protected](protected.hex) examples use the false setting.

The reported balances come from the contract's getter. Interpret a successful mint against the protocol's intended mint policy. A reverted call describes that account and input. Missing getters, failed deployments and unsuccessful deployer controls produce an error. The checker accepts compiled input directly and performs no Qwen inference. Its public queries return ephemeral simulation results.

## Build and verify

The hosted preview runs without any software installation for the caller. To reproduce the canister artifact, use Rust with the wasm32-unknown-unknown target and the committed Cargo.lock. The preview was built with Rust 1.99.1, revm 19.7.0 and dfx 0.32.0. The two hex files are Solidity 0.8.24 Shanghai creation bytecode for the existing mint fixtures in [the research dataset](../audit-improvement-results.json), compiled as Mint.sol with the optimizer disabled.

```sh
cargo test --locked --lib
cargo build --locked --release --target wasm32-unknown-unknown
dfx deploy watch_checker --playground
dfx canister --network playground call watch_checker demo '()'
```

The playground reservation is temporary. A persistent deployment needs a dedicated funded ICP canister. Operating costs depend on its subnet, memory and workload.
