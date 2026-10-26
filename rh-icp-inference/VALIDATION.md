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

## Existing-pool trigger extension · 26 October 2026

- **24 JavaScript/EVM checks passed**, including the original bridge checks, existing-pool receipt scanning, full PoolKey/token validation, canonical source IDs, source-bound callback routing, one result per swap log, same-transaction multiple swaps, callback confirmation depth, canonical block checks and exact committed answer verification.
- **12 Rust checks passed**, including independent JavaScript/Rust equality for the saved GH0ST pool key, Swap topic and source ID, canonical signed ABI widths, source registration checks and canister-derived prompts. Existing manual-request signature vectors remain valid.
- The updated coordinator built successfully to Wasm with its generated Candid interface embedded: 1,460,776 bytes. The updated gateway compiled to 5,914 bytes of deployed runtime code with the same Solidity settings.
- Both saved source PoolKeys (sentence-hook and Pons) hash to the declared pool IDs. This is configuration verification, not a fresh liquidity or live-state attestation.
- No pool, liquidity, hook, model training run, canister or X account was changed. Live source RPC/canister integration, model inference and actual RH callbacks remain unverified. X publishing and persistent character memory are still pending.

The callback confirmation check validates the canonical fulfillment event and answer hash/text before recording terminal delivery. Queue/job/signed result IDs are checked for both direct swaps and explicit requests. A confirmed callback is still subject to the selected confirmation/finality policy; this is not a proof against arbitrary deep chain reorganizations.

## Persona, memory and publisher extension · 26 October 2026

- **39 JavaScript/EVM checks passed**. New checks cover exact confirmed-delivery memory acknowledgements, callback log identity, opt-in X account verification, fixed proof URLs, exact committed text, durable pre-send journaling, ambiguous-send reconciliation, rate-limit deferral and disabled/re-enabled publication history.
- **24 Rust checks passed**. Persona checks cover verified GH0ST delta direction in either currency slot, source/attempt/output-offset seeds, bounded prompt/memory, profile grammar and quality gates, repetition/stock-phrase cooldown, complete quoted endings, positive repair instructions, shared compute counters, exact independently verified RH memory acknowledgements, idempotence and backward stable-state decoding.
- The coordinator rebuilt with Candid metadata: **1,653,463 bytes**. Its raw release Wasm SHA-256 before metadata packaging was `247ee208be7d7d08c053c93f32d2994fff012a30f7472721f02f74a07b6558e4`. The RH gateway is unchanged from the 5,914-byte swap-trigger extension.
- **Actual local Qwen3-1.7B Q4_K_M inference** used the pinned model SHA-256. The frozen profile produced eight naturally finished, structurally valid first-pass replies. Applying chronological recency checks accepted five immediately and three after an actual bounded model regeneration; the raw before/after guard results and prompts are retained under [evaluation](evaluation/README.md).
- This is prompt/decoding tuning, not weight training. The final native Q8 KV/flash-attention runner differs from ICP's pinned Wasm runtime. Native timing and output acceptance do not measure ICP cost, exact token parity, live memory operation or general writing quality. The single AI assessor's first-pass review remained uneven: mean 6.125/10, three of eight at least 7/10.
- The default model profile now targets 1.7B with a reviewed 2T model-cycle ceiling. Earlier 0.6B/$0.60 estimates do not price the longer persona prompt. Both attempts share this ceiling, so a quality repair can still fail its live resource budget.

No funded ICP coordinator/identity or X user token is configured in the development environment. No canister was deployed, no live swap was processed and no X post was sent. X publication defaults to disabled; its account and API tests used injected mock responses. Existing pools, hooks, liquidity, websites and training workflows remain unchanged.
