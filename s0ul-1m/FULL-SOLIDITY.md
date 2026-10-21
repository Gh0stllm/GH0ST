# Complete S0UL-1M Solidity inference

This implementation executes the complete integer-v1 transformer in Solidity: embeddings, four attention/FFN layers, RMS normalization, rotary positions, causal softmax attention, residuals, final normalization, tied output projection and greedy token selection. It also tokenizes user text on-chain and returns generated token IDs and decoded bytes. It produces model outputs; it does not execute agent actions.

The runtime was developed on the historical [`research/GH0ST-S0UL-Solidity`](https://github.com/8tk8m2kv9f-lang/GH0ST/tree/research/GH0ST-S0UL-Solidity) branch and is recovered in this repository. The existing training workflows and trained checkpoints remain independent.

## Robinhood Chain mainnet deployment

The selected trained model is deployed on **Robinhood Chain mainnet, chain ID 4663**, using **51 contracts**: 48 immutable data shards, the model registry, tokenizer and inference engine. The completed [deployment journal](deployments/robinhood-mainnet.json) records all addresses, successful creation transactions, gas and source/model identities. The deployment CLI checked each creation transaction and runtime against the verified build, all 48 shard runtime hashes against the model export, and the registry, tokenizer and engine identity pins.

| Contract | Mainnet address |
| --- | --- |
| Inference engine | `0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650` |
| Model registry | `0xa62C2d6fbba575732AAB38c56fCd73B2361B1D98` |
| Tokenizer | `0x3Cf3739D8e587C3AB5706fd459e75A6fCE26d333` |

Model ID: `0x6b0817a3bc4d0ba1f03ec6e14387285e1bcda0e40fdd40d7daee2cbc3c2ff89a`.

The 51 deployments used **257,254,365 gas** and paid **0.005238250757104 ETH**, calculated as the sum of `gasUsed × effectiveGasPrice` from their receipts. This covers contract creation and excludes inference or other wallet activity. A separate [read-only receipt and smoke check](reports/robinhood-mainnet-deployment-check.json) confirmed all 51 successful receipts, `Wait.` tokenization and a simulated `beginText("Wait.", 2)` call; the simulated request was not persisted. That check did not repeat the deployment CLI's runtime verification.

The 398-transaction, 892,989,640-gas full inference result later in this document is a local EVM benchmark; no paid mainnet full inference benchmark has been run.

All three Solidity contracts have exact creation and runtime source matches on Sourcify: [inference engine](https://repo.sourcify.dev/4663/0x07bB8455Db0928bEBEb3E7F27A22A0599AF1b650), [model registry](https://repo.sourcify.dev/4663/0xa62C2d6fbba575732AAB38c56fCd73B2361B1D98) and [tokenizer](https://repo.sourcify.dev/4663/0x3Cf3739D8e587C3AB5706fd459e75A6fCE26d333). [Verification evidence](reports/robinhood-mainnet-verification/sourcify-verification-status.json).

## Selected trained model

| Property | Value |
| --- | --- |
| Model | GH0ST S0UL-1M, 984,192 parameters |
| Architecture | 4 layers; dimension 128; 4 heads; FFN width 640; vocabulary 512 |
| Context / generation bound | 128 total tokens / at most 32 generated tokens |
| Selected training lane | `expand-replay-5-52`, selected using validation only |
| Checkpoint SHA-256 | `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692` |
| Original integer bundle SHA-256 | `1f392feffdf57059ca3969c3fb8087b831ee4a9261764f9bbb1680192da60501` |
| Canonical Solidity payload SHA-256 | `4857535018d946093b61777ec3e1b5801f9a6fc9f8f9bea13e74bf6700c476e4` |
| Integer payload | 1,102,856 bytes, including quantization scales, normalization gains and lookup tables |
| Portable data shards | 48, at most 23,000 payload bytes each |
| Required deployments | 48 data contracts + model registry + tokenizer + inference engine = 51 |
| Arithmetic | Existing integer-v1 Q14 activations / Q24 row scales; exact ties away from zero |
| Compiler | Solidity 0.8.30, optimizer 200 runs, `viaIR: true`, Shanghai EVM |

The selected checkpoint and integer export come from the [completed 20-lane workflow](https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39630021281), artifact `s0ul-hard-max-selected-39630021281`. Its final task results are 41.48% exact correctness on the harder 540-request challenge and 58.06% on the historical 360-request challenge. Integer inference scored 41.48%, with zero saturation in that evaluation. These task-quality measurements remain separate from EVM/reference arithmetic parity. [Training evidence](https://github.com/8tk8m2kv9f-lang/GH0ST/blob/research/GH0ST-S0UL-1M/s0ul-1m/reports/hard-max-39630021281/SUMMARY.md).

## Contracts and transaction flow

`S0ULModel` derives all 62 tensor spans from the fixed architecture and pins each STOP-prefixed data contract's runtime hash and length. No tensor, scale or shard setter exists. A model ID binds configuration, source-checkpoint hash, export-manifest hash and deployed shard addresses/hashes. The deployment tool constructs this concrete registry from a verified export; an arbitrary replacement implementation of the registry interface is outside that deployment's trust boundary.

`S0ULTokenizer` implements the frozen byte/domain dictionary. It uses longest-prefix matching with byte fallback. Text cannot inject special control IDs. The inference constructor verifies both its dictionary identity and exact compiled tokenizer runtime code hash. Tokenization bounds are explicit and reject overflow.

`S0ULInference.beginText(text, maxNewTokens)` tokenizes the text and adds BOS/SEP. `begin(tokenIds, maxNewTokens)` supports numeric inputs. Each request pins the deployed model, its input and its owner. No hidden state, cache, logit or predicted token is supplied by an external caller.

`advance(requestId, maxRows)` performs one deterministic phase or one matrix-row chunk. `maxRows` is 1–128; the CLI defaults to 32. Attention advances one head at a time. Completed token/layer keys and values remain in the contract's causal cache, so a continuation reuses verified earlier work. Final logit chunks expose every vocabulary score; argmax chooses the lowest token ID on a tie. Generation ends on EOS or its requested budget.

Any caller may pay to advance a request. Only its original owner may cancel it. Requests cannot alter each other's inputs or computed state. Progress, tokens, logits and saturation counts are readable. There is no token transfer, approval, arbitrary contract call or automatic action execution.

The initial tokenization, every continuation and all persistent state writes consume gas. A request needs many transactions. The caller or an explicitly arranged keeper must submit and pay for them; the contracts do not wake or fund themselves.

## Reproduce locally

From `s0ul-1m`:

```bash
python -m pip install -e .
npm ci --ignore-scripts --no-audit --no-fund
python -m unittest discover -s tests -p 'test_*.py' -v
npm run test:math
npm run test:tokenizer
```

Download and extract the selected workflow artifact, then export its unchanged integer bundle:

```bash
python -m s0ul.solidity_export --bundle bootstrap20/exports/integer --output exports/solidity-model
python -m s0ul.solidity_export --verify exports/solidity-model
node scripts/s0ul-solidity.mjs compile --output exports/solidity-build/contracts.json
```

The Solidity payload reorders tensor bytes into the contract's canonical layout. Its hash therefore differs from the original alphabetically serialized integer bundle; array values and numeric rules are unchanged. Verification checks tensor layouts, byte hashes, shard reconstruction and deployment initcode/runtime hashes.

Create independent Python golden vectors and compare complete EVM inference:

```bash
python scripts/make_solidity_vectors.py --output exports/solidity-tests --full-bundle bootstrap20/exports/integer --full-text 'Wait.' --full-new-tokens 2
npm run test:inference
```

The integration test deploys real data contracts and the full trained architecture to an in-process Shanghai EVM with a 30-million block gas limit and standard contract-size enforcement. It checks all 512 integer logits at each generated-token decision against `IntegerModel.forward`, then checks generated IDs and EOS. Tiny random/zero/EOS fixtures separately test cache reuse, ties, bounds, cancellation, hash failures and continuation by another caller. The local results report records exact prompts, tested logit counts, transaction counts, deployment gas and inference gas.

For faster verification, CI runs the same deployed contracts against pinned Anvil v1.3.1 with the Shanghai hardfork and 30-million block gas limit. Set `S0UL_RPC_URL=http://127.0.0.1:8545` to use that local native runner; the test harness checks the local endpoint, chain ID and client identity. Without that variable it uses Ganache. The runner change leaves model weights, Solidity arithmetic and golden-logit assertions unchanged. These are host verification speeds, separate from the workload's measured gas and public-chain transaction latency.

## Deploy and run against an explicit RPC

The following example uses an already-running local node with an unlocked test account and chain ID 31337. The CLI sends transactions only when its `deploy` or `infer` command is explicitly invoked. The compile/export commands send none.

```bash
node scripts/s0ul-solidity.mjs deploy --rpc http://127.0.0.1:8545 --chain-id 31337 --account 0 --model exports/solidity-model/model.json --output deployments/local.json
node scripts/s0ul-solidity.mjs infer --rpc http://127.0.0.1:8545 --deployment deployments/local.json --account 0 --prompt 'Wait.' --max-new-tokens 2 --rows 32 --output deployments/wait.json
```

For a signer managed outside an unlocked local node, `--private-key-env S0UL_SIGNER_PRIVATE_KEY` reads only that explicitly selected environment variable. The tool does not load `.env` files or print signing keys. RPC chain ID must match the requested deployment or saved deployment record.

The CLI writes deployment addresses, source/model identities and transaction receipts. It also writes inference receipts and generated outputs. Resume an existing request with `--session REQUEST_ID` instead of `--prompt`; lowering `--rows` reduces matrix work per continuation. Opt in to larger batches with `--rows 128`; the default transaction gas limit is 12 million for up to 32 rows and 25 million above 32 rows. `--step-gas` overrides that limit, and `--max-transactions` bounds submitted calls. The tool checks the deployed engine's row cap before sending. A partial run preserves its on-chain state for later continuation.

## Verified faster execution

The final 128-row native run passed all eight integration tests, including the full trained checkpoint, cache reuse, every decision logit, EOS, request bounds, corrupt shards, tokenizer spoof rejection and varying row budgets `[1, 3, 32, 128]`. All 67 Python checks and the component EVM suites also passed in that job. [Full native evidence](reports/solidity-inference-ci-128.json) · [Independent 32-row control](reports/solidity-inference-ganache-control.json).

For the actual trained model in the local EVM, the deployed tokenizer converts `Wait.` to prompt IDs `[1, 316, 50, 3]`; generation returns `[268, 2]` (`WAIT`, EOS). Both 512-logit decision vectors match the existing Python integer reference exactly, with zero saturation.

| Measurement | Verified 128-row trained run |
| --- | ---: |
| Transactions, including `beginText` | 398 |
| Inference gas, including `beginText` | 892,989,640 |
| Maximum single transaction | 11,927,948 gas |
| Model/data/engine deployment gas | 250,110,495 |
| Shared tokenizer deployment gas | 1,146,174 |
| Local native inference elapsed time | 4.505 seconds |

That elapsed time excludes compilation/deployment and describes a local native EVM; it is not public-chain latency. The 32-row state-machine count for the identical prompt/budget is **1,022 transactions**, calculated as five token positions × 197 phase/chunk calls + two decisions × 18 calls + one begin. The measured 128-row count is **398**, a calculated transaction-count reduction of **61.06%**. A matched native 32-row gas/time result was not retrieved; no full-model gas saving or wall-time speedup ratio is asserted.

The independent older 32-row Ganache control checked all 512 logits for raw prompt `[1, 3]` and output `[266]`: 413 transactions and 400,948,321 gas. That control was stopped after this completed case; its report explicitly marks the remaining suite incomplete. Its prompt and historical engine build differ from the native text run, so their gas/time values are not a matched comparison.

A matched local CLI smoke test on the small 512-vocabulary numerical fixture measured **75 → 63 transactions** and **14,026,342 → 13,011,698 gas** when changing only the row budget from 32 to 128: **16% fewer transactions and 7.23% less gas**, with the same generated token. It also verified that requesting 128 rows from an older 32-cap engine fails before submitting any transaction. [CLI evidence](reports/solidity-cli-fast-local.json).

Code through commit `e094cc76980b2a7d622fbf520faca5e0fbb7884c` was published to the runtime branch. GitHub subsequently returned HTTP 403 with `Sorry. Your account was suspended`; final reports and this documentation were preserved locally rather than asserted as remotely published. [Verification summary](reports/solidity-optimization-summary.json).

## Evidence boundary

This is complete model inference, with bounded persistence between transactions. Local EVM gas is measured workload gas, not a Robinhood Chain fee quote. The mainnet deployment and its identity checks are recorded separately above; the local tests establish arithmetic parity for the tested inputs. They do not establish mainnet inference latency or a paid mainnet inference result.

The port preserves integer-v1 saturation and counts it. Incremental execution computes each cached token/layer once; Python's original generation recomputes whole prefixes. Their total saturation counters need not match, even when every final logit agrees. Arithmetic agreement does not improve the checkpoint's language understanding or authorize the actions it proposes.
