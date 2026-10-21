# Stylus port: validated locally; Robinhood activation blocked

The matching Rust/Stylus integer kernel is implemented and compiled. **Robinhood mainnet and testnet currently report an activation gas charge of `18446744073709551615` (maximum uint64).** Official `stylus-tools` treats a charge above 30,000,000 as an activation pause. No public deployment or activation was attempted, no chain configuration was overridden, and no ETH was spent.

This finding is based on direct reads of Robinhood's `ArbWasm` precompile, not an assumption that an Arbitrum One notice automatically applies to Robinhood. The operator's reason and reopening date have not been confirmed.

## Completed

- Rust implementation of all five Solidity-compatible methods: `dotCalldata`, `dotFromCode`, `computeAndStore`, `resultHash`, and `runs`.
- Exact same packed int4 weights, int16 activations and genuine LFM slice as the Solidity benchmark.
- Seven passing Rust tests, covering arithmetic, signed bounds, odd packed lengths, invalid inputs, code-shard reads and persistent result commitments.
- Thirty passing checks against the **actual compiled WebAssembly**, using an explicit local mock host. These verify ABI-compatible calls, arithmetic, error selectors, hash encoding, storage layout and counters.
- Same four integer outputs: `207214, -150983, 410232, -109613`.
- Same result commitment: `0x942bf1e07782c6cbd557e7e8c4ed5657b9628a2bd46370b42f20215f01348ecc`.
- Compiled Wasm size: 33,537 bytes. Maximum memory observed in these local tests: 1,114,112 bytes (17 pages).

The Wasm tests use Wasmtime with mocked code reads, storage and Keccak host calls. They are **not Nitro execution**, do not meter Stylus ink/gas, and cannot establish activation validity. Wasmtime's fuel limit is only an infinite-loop guard. No conversion from fuel or CPU time to blockchain gas is made.

## Observed Robinhood configuration

Reads were made on 20 October 2026 in India (19 October UTC). The JSON records include exact timestamps and block hashes.

| Setting | Mainnet, chain 4663 | Testnet, chain 46630 |
| --- | ---: | ---: |
| Block checked | 92,987,757 | 139,015,769 |
| Stylus version | 3 | 3 |
| Ink per gas | 10,000 | 10,000 |
| Maximum Wasm pages | 128 | 128 |
| Maximum Wasm memory | 8 MiB | 8 MiB |
| Activation gas charge | 18,446,744,073,709,551,615 | 18,446,744,073,709,551,615 |
| Default expiry days | 365 | 365 |

These are current parameter reads, not immutable network guarantees. Our small local program's memory use does not establish that the entire LFM runtime fits in the limit.

## How to proceed during the pause

1. **Continue using Solidity/Yul on Robinhood.** The existing EVM slice already passed Robinhood read-only simulations. This preserves on-chain execution but needs realistic gas estimates as more of LFM is implemented. Hundreds of contracts do not reduce the total arithmetic work.
2. **Reuse an already-active compatible program, if one can be verified.** Active Stylus programs can remain callable under the activation-pause mechanism. A usable program must already expose the necessary operations and data interfaces, permit our calls, and remain unexpired. We have not verified a reusable LFM executor on Robinhood. A small specialized neural-network project or a financial risk calculator is not automatically a general-purpose inference engine.
3. **Seek authorized network support or wait for reopening.** Only the authorized network governance/operator can change the relevant activation parameter. A different RPC, a new wrapper contract, or higher transaction fees cannot make our new binary active under the current setting.
4. **Continue local Nitro development.** A developer-controlled local chain can test deployment/activation and gas without changing Robinhood. Its measurements must be labeled as local and tied to its precise runtime/configuration. No such Nitro gas run was performed in this package.

The Solidity and Rust methods intentionally share an ABI so a future agent can use either execution backend. No complete layer, full next-token pass, chat session or autonomous agent action has yet been implemented.

## Reproduce

Install Rust through https://rustup.rs/ and Python dependencies from this folder's lock file (the lock includes the earlier model environment). From this directory:

```bash
cargo test --lib --locked
cargo build --lib --release --target wasm32-unknown-unknown --locked
cargo run --locked --features export-abi --bin lfm-int4-stylus -- abi --license MIT > ABI.sol
../.venv/bin/python test_wasm.py
../.venv/bin/python probe_runtime.py
../.venv/bin/python probe_runtime.py --rpc https://rpc.testnet.chain.robinhood.com --chain-id 46630 --output ../results/stylus-runtime-testnet.json
```

The Python executable above assumes the `.venv` created at the package root in the main README. `test_wasm.py` uses the fresh build under `target/`; the tested binary is also included as `artifacts/lfm_int4_stylus.wasm` for inspection. Rust 1.99.1 and Stylus SDK 0.10.10 are pinned. `Cargo.lock` records transitive dependency versions. The two directly used Alloy crates are pinned together to 1.7.3 to keep their generated ABI code and types compatible.

## Results and unknowns

- `../results/stylus-native-tests.log`: final Rust test results.
- `../results/stylus-wasm-build.log`: successful Wasm build.
- `../results/stylus-wasm-tests.json`: compiled-Wasm checks, hashes and observed memory.
- `../results/stylus-runtime.json` and `stylus-runtime-testnet.json`: current chain parameter reads.
- Stylus activation validation: **not completed because of the pause**.
- Stylus gas per projection, full token or reply: **unknown**.
- Comparison claiming a Stylus speedup over our Solidity implementation: **not available**.

## Primary sources

- SDK code and pause detection: https://github.com/OffchainLabs/stylus-sdk-rs/blob/v0.10.10/stylus-tools/src/core/activation.rs
- Official pause behavior (notice specifically addresses Arbitrum One/Nova): https://docs.arbitrum.io/notices/stylus-activation-pause-notice
- Robinhood RPC details: https://docs.robinhood.com/chain/connecting/
- Robinhood precompile addresses: https://docs.robinhood.com/chain/protocol-contracts/
- SDK release source inspected at git commit `76f8b055ec0bf421edd542b164dc2917c9e4e0bd`.

This is a development benchmark, not production authorization or asset-management code. It introduces no wallet credentials or broadcast path.
