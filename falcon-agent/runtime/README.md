<!-- GH0ST reading guide: additive navigation. -->

**GH0ST / THE RESUMABLE INFERENCE RUNTIME**

[Project home](../../README.md) · [Architecture](../../docs/ARCHITECTURE.md) · [Request lifecycle](../../docs/REQUEST-LIFECYCLE.md) · [Evidence and costs](../../docs/EVIDENCE.md)

This is the deployed bounded token-generation and prepaid-accounting layer. For a first read, follow the [request lifecycle](../../docs/REQUEST-LIFECYCLE.md); for implementation, use the [frontend integration kit](FRONTEND-INTEGRATION.md), [budget specification](PREPAID-BUDGET.md) and reproduction instructions below. The original measurements, limitations and command examples are preserved.

---

# GH0ST bounded inference and prepaid execution

**Research milestone: the validated prepaid runtime is deployed on RH at `0x69996912a59a241763c71810193cf1021ddbb8c0`.** Its entire 35,852-byte runtime matches the validated pin. Creation used **7,807,400 gas** and cost **0.000162253386800000 ETH**. [Receipt and verification](mainnet-runtime.json), [frontend integration instructions](FRONTEND-INTEGRATION.md), [frontend ABI](frontend-abi.json), [configuration](frontend-config.json). No public chat deposit or inference transaction was sent.

The runtime compiles to **35,852 bytes** and requires **one additional contract**, with no externally linked helpers. It reuses the deployed four-bit matrix kernel and immutable weight index. The actual public total is now **500 contracts**, including the two historical pilots. The 24,576-byte Ethereum limit is insufficient for this artifact; RH's larger demonstrated limit is the target. Cancun transient-storage support is also required and separately probed by the read-only quote.

A real chat-template **“Hi” generated “Hello!”** in the local EVM mirror. All **288 layer checkpoint hashes** matched the independent Q32 reference, and both generated token IDs matched float32 inference using the same four-bit weights. This establishes reproducible bounded numerical execution. The checks measure numerical agreement on this workload, rather than general model quality.

The [milestone and spending record](ACCOUNTING-AND-MILESTONE.md) documents all actual deployment fees, local inference measurements, the sequencing lesson, and current deployment status. The [prepaid budget specification](PREPAID-BUDGET.md) gives the exact quotation and settlement formulas.

## Requester pays beforehand

1. The client reads the Solidity `quote` for the prompt length, maximum output length and requester-approved gas/parent-posting fee caps.
2. The requester reviews the conservative maximum, chooses an executor and deposits exactly the quoted escrow in `startPrepaid`.
3. That executor submits continuation transactions and initially pays their network fees. Successful, contract-computed inference earns capped withdrawal credit from the requester's escrow.
4. Completion, early EOS or cancellation credits every unused wei back to the requester. Credits are withdrawn explicitly.

The budget is a **maximum refundable service deposit**, not exact advance knowledge of future network fees. The current worst-case quote is intentionally much higher than measured consumption. Funding/start, cancellation, executor changes and withdrawal transaction fees are paid separately by the submitting wallet. Failed calls are not reimbursed. An executor and transaction sender must actually operate; the contract does not run itself.

The requester can replace a stalled executor or cancel. There is no administrator, platform commission, arbitrary treasury sweep or silent top-up. Only the selected executor advances a session. The requester can choose themselves, but still needs wallet liquidity for continuations. The client requires an explicit maximum wallet budget before preparing a deposit.

## Current prepaid measurements

See [prepaid-chat-validation.json](prepaid-chat-validation.json), tied to the current compiled artifact and runtime hash. These are local tests, not mainnet receipts:

| Quantity | Measured result |
| --- | ---: |
| Runtime size | 35,852 bytes |
| Local runtime deployment | 7,807,425 gas |
| Chat prompt / output | 11 prompt tokens / 2 output tokens (“Hello!”) |
| Continuation execution | **33,891,488,817 gas** |
| Continuation transactions | **1,546** |
| Session funding/start | 296,954 gas |
| Largest continuation | 24,854,317 gas |
| Exact layer checkpoint matches | 288 / 288 |
| Checks of payment and inference behavior | 27 passed |

The local accounting test used a simulated 21,088,000 wei/gas price and an explicit local posting-fee mock. It reserved **17.121136322619 ETH**, credited **0.719686164542016 ETH** to the executor and **16.401450158076984 ETH** back to the requester. Both withdrew, leaving zero balance and zero liabilities. These are simulated local balances, not funds paid on RH. The executor credit uses the disclosed measured-gas-plus-120,000 allowance; it is not identical to receipt fees. The local continuation receipt-gas conversion at that simulated price is **0.714703716172896 ETH**, excluding real parent posting.

The reserve is large because it conservatively allows as many paid calls as work units, each at the per-call ceiling. This is an enforceable upper budget, not an expected 17-ETH chat fee. Tighter practical deposits need validated tighter cost bounds. Execution cost remains a substantial optimization target; prepayment itself does not remove computation.

The tests cover every one of the 2,016 valid prompt/output length combinations for quote arithmetic, exact funding, stale quotes, unauthorized operations, fee ceilings, unavailable posting-fee information, cancellation, executor replacement, failed recipients, reentrant withdrawal, prevention of duplicate posting charges in one transaction, full inference, final refunds and conservation of funds. They do not constitute an independent production security audit.

## Historical measurements

Earlier versions used the identical smoke-test prompt and output IDs:

| Historical direct-payment implementation | Continuation gas | Transactions |
| --- | ---: | ---: |
| Initial checkpoint implementation | 15,957,162,305 | 731 |
| Cached matrix input and packed checkpoint loops | 8,345,494,700 | 383 |
| 256-row matrix batches and bounded MLP tiles | 8,240,553,260 | 378 |

The final direct-payment smoke result was 48.36% lower than its baseline. The separate chat-template test on the earlier **33,098-byte** runtime used **34,036,992,062 continuation gas across 1,552 transactions**, plus 148,482 start gas. At the historical live quote it converted to **0.717772088603456 ETH before parent posting**. The historical [deployment quote](deployment-quote.json) and [chat report](evm-chat-validation.json) describe that earlier artifact, not the current prepaid candidate.

The current build has changed code generation and transaction boundaries as well as accounting. Its result should not be described as a clean gas-savings comparison with the earlier artifact. Those experiments were local. The subsequent runtime creation is recorded separately above; no paid public inference has been sent.

## Numerical behavior and remaining product work

The runtime implements all 24 hybrid blocks: input RMS normalization, Mamba causal convolution and selective recurrence, rotary grouped-query attention, residuals, gated MLP and final normalization/projection. Sequential Mamba uses a sum of decayed historical rank-one updates to avoid persisting 1,179,648 dense recurrent values per session at short context lengths. A deterministic state machine stores intermediate values and resumes without caller-supplied activations.

Activations are signed Q32 packed into 64 bits, with adaptive int16 inputs for the existing four-bit matrix kernel. Deterministic integer approximations implement nonlinear functions, normalization and RoPE. This adds approximation beyond the deployed weight quantization. Four short CPU regressions agreed on 8/8 next-token predictions with float32 using the same four-bit weights; that is a small regression check, not a general accuracy score. No new training, distillation or weight quantization was performed.

The implementation allows **64 total prompt and generated tokens**, greedy generation and public token IDs. The full 64-token numerical/gas worst case has not been measured. A prepaid bound does not guarantee numerical success or executor availability; a numerical failure can require cancellation. Spent completed work is not refundable.

Browser/CLI tokenization uses the pinned official tokenizer. There is **no on-chain raw-text tokenizer, connected website chat, production executor service, tool-action system or production agent memory layer** in this change. Prompts, tokens and checkpoints would be public if deployed. Independent security and broader numerical review remain outstanding. Deployment alone does not connect website chat or operate an executor.

## Interface

| Call | Purpose |
| --- | --- |
| `quote(P,O,G,L)` | Read conservative work, billed-gas and upfront-escrow ceilings. |
| `startPrepaid(prompt,O,executor,G,L,expectedBudgetWei)` | Requester funds the exact quote and starts a token-ID session. |
| `advancePrepaid(id,maxUnits)` | Chosen executor advances up to 256 units with gas headroom and receives credit. |
| `setExecutor(id,executor)` | Requester replaces the executor. |
| `cancel(id)` | Requester stops inference and receives unused escrow as credit. |
| `budgets(id)` / `credits(account)` | Read escrow, charged amounts and withdrawals available. |
| `withdraw(recipient)` | Withdraw caller-owned refunds or executor compensation. |
| `status(id)` / `values(id,base,count)` | Read generation status, token IDs and aligned numerical checkpoints. |

Only one paid continuation is allowed per transaction, including across multiple sessions. This prevents duplicate reimbursement of that transaction's full posting fee. Separate transactions may be submitted together; chain execution limits still apply. The ABI is in [compiled.json](compiled.json).

## Reproduce

Use the existing Python environment, Solidity 0.8.30 and Anvil. The reference, quality, pin and EVM validators accept no public signing key. Set paths to the pinned checkpoint, selected export and local tools:

```bash
node falcon-agent/runtime/compile.cjs
node falcon-agent/runtime/tests/compile.cjs
python falcon-agent/runtime/validate_quality.py \
  --checkpoint "$GH0ST_CHECKPOINT" --export "$GH0ST_FOURBIT_EXPORT" \
  --chat-trace "$GH0ST_CHAT_TRACE"
python falcon-agent/runtime/validate_evm.py \
  --weights "$GH0ST_FOURBIT_EXPORT/weights.bin" --anvil "$GH0ST_ANVIL" \
  --trace "$GH0ST_CHAT_TRACE" --progress "$GH0ST_LOCAL_PROGRESS" \
  --report falcon-agent/runtime/prepaid-chat-validation.json
python falcon-agent/runtime/validate_client.py \
  --checkpoint "$GH0ST_CHECKPOINT"
python falcon-agent/runtime/pin_runtime.py \
  --weights "$GH0ST_FOURBIT_EXPORT/weights.bin" --anvil "$GH0ST_ANVIL"
```

The EVM validator installs all 495 exact verified shard runtimes, the kernel and index at their recorded RH addresses with local state overrides. It is a local code mirror, not a historical mainnet-state fork. It explicitly mocks ArbGasInfo and measures local receipt gas and simulated credit movements.

`client.py` reads the on-contract quote and prepares unsigned wallet calls. It never reads a private key or broadcasts. After an actual runtime deployment, an example is:

```bash
python falcon-agent/runtime/client.py \
  --runtime "$GH0ST_RUNTIME_ADDRESS" --requester "$GH0ST_REQUESTER" quote \
  --prompt-tokens 11 --max-new-tokens 2 \
  --gas-price-cap-wei "$GH0ST_GAS_PRICE_CAP" \
  --posting-fee-cap-wei "$GH0ST_POSTING_CAP"
python falcon-agent/runtime/client.py \
  --runtime "$GH0ST_RUNTIME_ADDRESS" --requester "$GH0ST_REQUESTER" start \
  --checkpoint "$GH0ST_CHECKPOINT" --prompt Hi --max-new-tokens 2 \
  --executor "$GH0ST_EXECUTOR" --gas-price-cap-wei "$GH0ST_GAS_PRICE_CAP" \
  --posting-fee-cap-wei "$GH0ST_POSTING_CAP" --max-budget-wei "$GH0ST_MAXIMUM_DEPOSIT"
```

The RPC URL is read from an environment variable. Quotes require chain 4663 and deployed code at the provided address. Use the published mainnet runtime address above. The repository provides its ABI and integration configuration; the existing website is not connected by this deployment.

`quote_deployment.py` accepts no signer and sends no transaction. It checks the current source/runtime pin and local prepaid validation, then reads RH pricing, nonce, balance, code/gas estimates, ArbGasInfo and transient-storage support. It evaluates the candidate's Solidity quote using a read-only code override. See [prepaid-deployment-quote.json](prepaid-deployment-quote.json) for its historical predeployment snapshot. [mainnet-runtime.json](mainnet-runtime.json) is the subsequent actual deployment record. `deploy_runtime.py` is the explicit one-contract manual deployment tool; it reads the key through a hidden terminal prompt and never starts or funds inference.
