# GH0ST multichain GPT-2 research

A real, quantized **124,439,808-parameter GPT-2** executor split across four EVM chains, with authenticated results returning to Robinhood Chain. The token remains GH0ST; this package creates no coin and changes no token supply.

This is research infrastructure. Compilation and local tests are separate from public deployment, real interchain delivery, native chain metering and fee savings. See `evidence/STATUS.json` for the precise completed checks from this revision.

The full four-node run passed: two generated token IDs (198, 464), 172 phase commitments, all 100,514 vocabulary logits and 72 KV-vector comparisons match the independent integer reference. All 7,966 local transaction receipts reconcile. The 62 protocol checks and eight worker-configuration tests also pass. No public transaction was submitted.

| Stage | Intended chain | Computation |
| --- | --- | --- |
| 0 | Robinhood, 4663 | Token/position embedding; receive final output |
| 1 | BNB, 56 | Transformer blocks 0–3 |
| 2 | Monad, 143 | Transformer blocks 4–7 |
| 3 | Arc, 5042 | Blocks 8–11, final normalization, all 50,257 output logits |

For every processed token position, the route is **RH → BNB → Monad → Arc → RH**. Each intermediate message carries one 768-element signed-int32 residual vector: 3,072 bytes. The canonical ABI packet is 3,488 bytes; the final token packet is 416 bytes. KV caches stay on the chain that owns the associated layers. Computation advances through bounded transactions; no model inference runs inside the messaging callback.

This is sequential layer partitioning. It does not execute dependent blocks in parallel. All parameters are retained; INT8 weights, row scales and Q12 activations approximate FP32 GPT-2. GPT-2 124M is the first integration model, not a billion-parameter or instruction-tuned model.

## Run locally

Validated locally with Node 24.19, Python 3.12 and Anvil 1.8.5. No public keys or RPC access are required for local tests. Install the exact package dependencies in this directory:

```sh
npm install --legacy-peer-deps --ignore-scripts
npm run build
npm test
```

The full benchmark also needs the pinned model export. A fresh checkout can create it locally:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python model/fetch.py
.venv/bin/python model/export.py
.venv/bin/python model/reference.py --quick --tokens=2
npm run plan
npm run benchmark -- --tokens=2
```

Set `GH0ST_MODEL_CACHE` to reuse an existing checkpoint/tokenizer directory. The export verifies the upstream checkpoint SHA-256 before writing tensors. An existing sibling `gpt2-bsc/data` export can be used by this working copy; a fresh clone does not depend on that sibling. Set `ANVIL_BIN` to your Anvil executable if it is not in PATH.

The local harness creates four separate unforked EVM nodes, deploys actual model bytes using CREATE, executes the full model, checks phase vectors and the complete vocabulary against the independent CPU oracle, and records transaction receipts. Local endpoint mocks replace only the external message-delivery service. They are not LayerZero security verification or production fee quotes. The four local nodes use a common EVM gas schedule with target chain IDs; native Monad, BNB, Arc and Robinhood metering is a separate measurement.

## Structure

- `contracts/GPT2Shard.sol`: real bounded inference, strict token-position sequencing and local KV state.
- `contracts/GPT2InferenceOApp.sol`: official LayerZero V2 OApp transport, immutable session/route identity, sealed peers, activation commitments and RH finalization.
- `contracts/mocks/`: isolated protocol-test fixtures. Never use them for a public deployment.
- `scripts/plan.mjs`: validates the complete model, exact partition coverage and every assigned weight hash.
- `scripts/local-benchmark.mjs`: real-model, four-node execution and receipt accounting.
- `scripts/prepare-deployment.mjs`: offline unsigned CREATE/wiring transactions with predicted addresses and exact data hashes.
- `scripts/verify-deployment.mjs`: read-only verification of a deployed route, exact contract code and model data.
- `scripts/worker.mjs`: restartable keeper with default read-only mode, gas-bounded compute and a per-hop message-fee ceiling.
- `model/`: pinned export, download helper and independent integer oracle. Tokenization and training remain local.
- `config/`: network metadata and an intentionally incomplete, disabled deployment template.
- `docs/TRANSPORT.md`: authentication, operational setup and trust boundaries.

## Cost objective

The goal is a lower total fee per inference. Splitting does not remove matrix operations, and adds message delivery plus activation import/export. Gas numbers from different chains are not directly interchangeable economic costs.

Latest measured local run, including activation import/export and **simulated** message send/receive:

| Stage | First position gas | Second position gas |
| --- | ---: | ---: |
| Robinhood | 6,157,283 | 4,433,120 |
| BNB | 1,088,463,267 | 1,078,633,416 |
| Monad | 1,088,424,154 | 1,078,602,021 |
| Arc | 2,382,682,569 | 2,372,683,113 |
| **Total** | **4,565,727,273** | **4,534,351,670** |

The maximum individual transaction used 16,186,577 gas, beneath the local 16,777,216 ceiling. Deployment used 36,446,260,980 gas, including four test-only endpoints; route setup used another 843,429. This is measured generic-Cancun EVM work, not native chain gas or a real LayerZero fee quote. Live savings remain unproven. `evidence/local-costs.json` records the reconciled totals and hashes of the complete local report and receipt ledger.

The historical single-EVM GPT-2 benchmark costs approximately 4.52 billion gas per processed position at contexts of one and two tokens. Allocating those operations to this route suggests about 1.07 billion on BNB, 1.07 billion on Monad, 2.37 billion on Arc and 1.2–2.9 million for RH embedding, **before the new routing overhead**. This is a planning allocation, not a live four-chain measurement.

The partition deploys 166,555,802 payload bytes, including 38,839,376 duplicated bytes (the tied embedding/output table and nonlinear tables). That is 7,142 weight contracts, 92 catalog contracts and eight engine/router contracts, before production messaging infrastructure. Historical same-EVM deployment allocation is approximately 36.4 billion gas. Full-chain deployment and per-token fees must be measured independently.

A prompt of N tokens requires N processed positions before its next token is available. Further generated tokens add positions. Attention and KV costs grow with context. The one/two-position benchmark is not a long-context pricing claim.

## Public deployment

The network metadata is a candidate configuration, not proof of deployed inference contracts or working pathways. Deploy only after reviewing each chain's runtime/gas limits and endpoint settings. Use explicit supported DVNs, libraries, confirmation policies and executor settings for every directed path. A default DeadDVN is not a working security configuration.

Deploy only the assigned tensor data and catalogs; each root has 77 entries, with unused entries zero. Deploy one router and one engine per stage for a single session. Wire the predecessor and successor peers, bind the exact engine, configure messaging security, then seal the route. The same validated route ID, model ID and fresh session ID must be used on all stages.

Fill `config/runtime.example.json` in an ignored `deployments/runtime.json`. Set real deployment transaction hashes, addresses, block numbers, RPC environment names, transaction limits, per-gas fee ceilings and native message-fee budgets. Null placeholders and zero fee budgets deliberately cannot start paid work. Verify all code and model bytes before enabling a worker:

```sh
node scripts/verify-deployment.mjs --config=deployments/runtime.json --data=data
node scripts/worker.mjs --config=deployments/runtime.json
```

To run paid work, the operator must explicitly set `enabled: true`, supply `GH0ST_WORKER_KEY` locally and invoke `--execute`. The worker checks fresh chain IDs, verified contract code, route identity and sealed peers before sending. Example with already-tokenized input:

```sh
node scripts/worker.mjs --config=deployments/runtime.json --execute --watch \
  --prompt-tokens=464,3290 --generate=2
```

The initial version uses one contract pair per session, not a multi-tenant serving cluster. A stalled or expired route needs operator recovery; the worker does not skip authenticated sequence rules or fabricate results. No end-user fee escrow, slashing, trustless computation proof or production deployment is claimed.

The data catalogs themselves can be reused by subsequent verified sessions on the same chain; the supplied deployment planner prepares a full initial installation. Session state and KV caches belong to the engine instance.

Model provenance: [official GPT-2](https://github.com/openai/gpt-2), checkpoint revision `607a30d783dfa663caf39e06633721c8d4cfcd7e`, SHA-256 `248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707`. LayerZero network and security sources are linked in `config/chains.json` and `docs/TRANSPORT.md`.
