# Validation · 26 October 2026

## Executed locally

- **10 JavaScript/EVM checks passed** with Solidity 0.8.30, optimizer 200, Paris target and Ganache 7.9.2.
  - Signed request/response round trip and permissionless delivery.
  - Same-gateway replay and another-gateway replay rejection.
  - Wrong signer/chain, changed prompt/model/manifest/answer and exceeded token cap rejection.
  - Pilot admission, pause, cancellation, expiry, byte/deadline limits and malformed/high-s signatures.
  - Durable journal serialization and shared Rust/client signature vector.
- **7 Rust checks passed**: strict hexadecimal parsing, prompt framing, signature normalization/recovery, Ethereum receipt decoding and rejection cases, exact EIP-712 equality with the JavaScript fixture, Candid export and stable-state serialization.
- Coordinator compiled to `wasm32-unknown-unknown`; Candid metadata embedded; `WebAssembly.validate` accepted the output.
- Gateway compiled to 4,465 bytes of deployed runtime code with the stated compiler settings.
- Worker imports verified against the pinned `@icp-sdk/core` package.

The native µWS add-on is unavailable for this Node build. Ganache used its JavaScript fallback; this affects test speed, not the EVM assertions.

The dependency audit reports advisories in Ganache's bundled development/test dependencies. Ganache is not part of the transport worker's runtime dependency set. Build the gateway ABI first, then use `npm ci --omit=dev` for a worker deployment; do not ship the development `node_modules` tree as a production image. This checkpoint is not a clean full-development-dependency security audit.

## Not established by this checkpoint

- Upstream model Wasm compilation/reproducibility in this environment, 639 MB GGUF upload, successful model loading or generation.
- Live/PocketIC execution of the coordinator, HTTPS outcall consensus on RH endpoints, production threshold key availability or end-to-end canister management permissions.
- Live RH gateway deployment or callback delivery.
- Measured total ICP cycles, inference latency, throughput or the quoted $0.60 cost target.
- Formal security audit, cryptographic verification of RH consensus, or removal of controller trust.

Model-Wasm hash checks and receipt comparisons are implemented but must be exercised on the selected ICP subnet. In particular, confirm response sizes fit the 64 KiB HTTPS response bound and that the one-billion-cycle attachment covers the selected subnet's outcall pricing. Failure returns an error rather than accepting unchecked data.

All changes are additive in `rh-icp-inference/`, plus its documentation index link. No existing model run, deployment, website or workflow was modified.
