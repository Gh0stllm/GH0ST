# GH0ST multichain GPT-2 research

A real, quantized **124,439,808-parameter GPT-2** executor with Robinhood Chain as home and optional EVM compute chains. The token remains GH0ST; this package creates no coin and changes no token supply.

This is research infrastructure. Compilation and local tests are separate from public deployment, real interchain delivery and paid-chain fee savings. See `evidence/STATUS.json` for the precise completed checks from this revision.

The next deployment is a small **RH → opBNB → RH transport canary**, before model weights. It includes sealed request/acknowledgement contracts, an exact unsigned deployment plan, a two-DVN delivery runner, and persistent native-fee budgets. The local official-protocol test passed; its DVN attestations are mocked, and no public canary transaction has been submitted. See [canary setup and recovery](docs/CANARY.md) and [local evidence](evidence/canary-local.json).

## Cheapest measured architecture

**RH → opBNB → RH**, with every model operation on opBNB and one request plus one final result per job. RH stores no model weights; BNB Smart Chain, Arc and Monad are unused in this route. The original four-chain engine remains available below.

| Two-output, one-token-prompt job | Recommended gas bid | Observed low bid |
| --- | ---: | ---: |
| Model/control + exact opBNB posting, per output | $2.869 | $0.030 |
| Including quoted source messages and explicit delivery/posting allowances, per output | $2.941 | $0.101 |
| Including estimated new-session execution, per output | $3.064 | $0.221 |

The low bid has **no demonstrated inclusion guarantee**. All figures are local measurements repriced at captured public fees; initial shared weights, session-setup posting, operator hosting and margins are additional. Session contracts are single-use. Longer prompts and responses cost more. See [complete cost accounting](docs/ECONOMY-COSTS.md) and [deployment/relay guide](docs/JOB-DEPLOYMENT.md).

The full opBNB-profile run passed: two outputs `[198, 464]`, 172 phase vectors, 100,514 vocabulary logits and 72 KV comparisons, with 6,244 reconciled local receipts. All 124,439,808 parameters and the existing INT8/Q12 arithmetic are retained. A separate fork test exercised the official LayerZero source Endpoint and send library, including source-side fee assignment to both official DVNs, in both directions. Public destination delivery remains untested, and the default managed executor does not support this pair in our snapshot. The optional self-operated executor retains the two-DVN security configuration and requires an operator to commit verified messages and execute delivery.

After preparing the canonical export in `data/` as described below (or supplying `--data` to the planner):

```sh
npm run plan:job -- --compute=opbnb
npm run benchmark:job:opbnb -- --tokens=2
npm run costs:economy
```

The completed raw evidence package is needed to regenerate all three cost sources (model, transport, posting). Restore it into `reports/` before running the cost calculator; a fresh model-only benchmark does not recreate the historical fee snapshots or transport fork report. Compact evidence is included under `evidence/`.

## Previous four-chain optimization

The optimized research route uses **RH → BNB → Arc → Monad → RH**, moving ten transformer blocks and the full output head to Monad. It preserves the canonical weights and arithmetic. See [optimization details](docs/OPTIMIZATION.md), [per-chain dollar estimates](docs/COSTS.md), and [captured fee sources](docs/FEE-SOURCES.md). The original engine and 4/4/4 layout remain available for comparison. Both complete native-profile comparisons passed with identical token outputs and full phase/logit/KV checks. The second-position model/import estimate fell from **$91.88 to $21.71 (76.37%)** at the captured prices. Adding provider components gives **$22.76**; adding a conservative source-execution allowance and RH posting scenario gives **$24.55**. These are short-context local-benchmark projections, not paid mainnet fees.

The original generic-Cancun four-node run passed: two generated token IDs (198, 464), 172 phase commitments, all 100,514 vocabulary logits and 72 KV-vector comparisons match the independent integer reference. All 7,966 local transaction receipts reconcile. The current 62 protocol checks, 16 configuration checks and eight worker-selection checks also pass. No public transaction was submitted.

| Stage | Intended chain | Computation |
| --- | --- | --- |
| 0 | Robinhood, 4663 | Token/position embedding; receive final output |
| 1 | BNB, 56 | Transformer block 0 |
| 2 | Arc, 5042 | Transformer block 1 |
| 3 | Monad, 143 | Blocks 2–11, final normalization, all 50,257 output logits |

For every processed token position, the optimized route is **RH → BNB → Arc → Monad → RH**. Each intermediate message carries one 768-element signed-int32 residual vector: 3,072 bytes. The canonical ABI packet is 3,488 bytes; the final token packet is 416 bytes. KV caches stay on the chain that owns the associated layers. Computation advances through bounded transactions; no model inference runs inside the messaging callback.

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

The newer comparison harness uses native Monad metering and tight declared gas limits on its Monad stage. Run `npm run plan:optimized`, `npm run benchmark:baseline-native -- --tokens=2`, and `npm run benchmark:optimized -- --tokens=2 --out=reports/optimized-native-full`. Then `npm run costs -- --markdown=docs/COSTS.md` reconciles receipts and applies the saved live price snapshot. The other three nodes still use generic Cancun; exact target-chain fee quotes remain separate.

## Structure

- `contracts/GPT2Shard.sol`: real bounded inference, strict token-position sequencing and local KV state.
- `contracts/GPT2ShardOptimized.sol`: compatible exact-arithmetic candidate with fewer repeated reads and copies; selected explicitly by the optimized plan.
- `contracts/GPT2ShardOptimizedV2.sol`: unselected research candidate with partial kernel measurements only; it has not passed a complete full-model benchmark and is not accepted by the deployment planner.
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

## Historical baseline cost

The goal is a lower total fee per inference. Splitting does not remove matrix operations, and adds message delivery plus activation import/export. Gas numbers from different chains are not directly interchangeable economic costs.

Original generic-Cancun run, before the fee-aware placement and kernel optimization, including activation import/export and **simulated** message send/receive:

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

The data catalogs themselves can be reused by subsequent verified sessions on the same chain; the supplied deployment planner prepares a full initial installation. Session state and KV caches belong to the engine instance. For the optimized route, use `config/runtime.optimized.example.json` and explicitly select `--config=config/chains.optimized.json --engine=GPT2ShardOptimized` when preparing unsigned deployment requests. Verification pins both selections and the route-file hash.

Model provenance: [official GPT-2](https://github.com/openai/gpt-2), checkpoint revision `607a30d783dfa663caf39e06633721c8d4cfcd7e`, SHA-256 `248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707`. LayerZero network and security sources are linked in `config/chains.json` and `docs/TRANSPORT.md`.
