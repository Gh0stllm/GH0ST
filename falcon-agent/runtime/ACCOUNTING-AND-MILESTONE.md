# GH0ST research milestone and spending record

GH0ST has deployed its selected four-bit model data and matrix kernel on Robinhood Chain. A complete, bounded inference runtime has generated **“Hello!” from a chat-template “Hi”** in a local EVM mirror of that deployed code. All 288 layer checkpoints matched the independent fixed-point reference. This is a research milestone. Execution cost is a substantial engineering constraint and an optimization target.

This record does not establish a “first of its kind” or world-first priority claim. Such a claim needs a defined scope and a comparison with prior work. It does not diminish what the reproducible deployment and numerical checks demonstrate.

## What was actually paid

These are mainnet receipt totals, not forecasts:

| Deployment | Contracts | Gas charged | Fee paid (ETH) |
| --- | ---: | ---: | ---: |
| Historical six-bit pilots | 2 | 14,071,366 | 0.000283860789728000 |
| Four-bit kernel, 495 weight shards and index | 497 | 15,338,014,634 | 0.324359492033248000 |
| Prepaid inference runtime | 1 | 7,807,400 | 0.000162253386800000 |
| Total | **500** | **15,359,893,400** | **0.324805606209776000** |

The complete [receipt journal](../fourbit-study/mainnet/deployment-state.json), [final report](../fourbit-study/mainnet/batch-0004.md) and [address manifest](../fourbit-study/mainnet/deployment-manifest.json) preserve the individual transactions. The weight-stage closing balance was 0.010509448211852451 ETH. After the runtime creation, the verified balance was 0.010347194825052451 ETH. These are dated snapshots. The new [runtime receipt](mainnet-runtime.json) records the additional creation transaction.

The deployed data are real and reusable. Deployment gas has already been consumed and cannot be refunded by adding the runtime. The integrated inference runtime and prepaid escrow **are deployed** at `0x69996912a59a241763c71810193cf1021ddbb8c0`. The actual public count is **500 contracts**. Exact deployed bytecode matches the locally validated build. No paid public inference has been sent; website and executor integration remain outstanding.

## What the local inference measurements establish

The earlier direct-payment runtime, 33,098 bytes, processed 11 prompt tokens and one generated token to return two output tokens (“Hello!”). It used **34,036,992,062 continuation gas in 1,552 transactions**, plus 148,482 start gas. At the historical 21,088,000 wei/gas quote, that continuation gas converts to **0.717772088603456 ETH before parent-chain posting**. That was a conversion of local gas, not a fee charged on mainnet.

The current prepaid candidate has its own measurements in [prepaid-chat-validation.json](prepaid-chat-validation.json). Its accounting adds work, so the earlier runtime's gas and deployment quote must not be presented as current-candidate measurements. Historical reports remain intact for comparison.

The experiment sequencing should have included a full-token cost benchmark before committing to the complete weight deployment. Matrix-kernel benchmarks did not establish the cost of a working chat. Future spending must distinguish historical receipts, local measurements, live estimates and enforceable spending caps.

## Requester-funded execution

The new integrated runtime computes a **conservative maximum escrow** before accepting a prompt. The requester supplies a maximum output length, a gas-price ceiling, a parent-posting-fee ceiling per continuation and a chosen executor. The requester deposits exactly the contract quote. Funding is verified atomically with session creation; no unfunded public session-start function exists.

The executor sends continuation transactions and initially pays the network. For successful inference work only, the contract transfers a bounded accounting amount from that request's escrow into the executor's withdrawal credit. Thus the requester funds the service; GH0ST need not subsidize it. The requester can choose themselves as executor, but then still needs wallet liquidity to submit continuations before withdrawing reimbursement.

Completion, early EOS or cancellation moves every unused wei into the requester's withdrawal credit. Cancellation cannot reclaim compensation already earned for completed work. Either party explicitly withdraws their credits to a chosen recipient. No administrator or platform treasury can sweep the escrow.

**A maximum prepaid budget is not exact advance knowledge of the final network fee.** Future gas prices, the actual generated length, transaction packaging, storage refunds and failed attempts cannot all be known by a contract beforehand. This implementation does not make that claim. It enforces the chosen caps and discloses its settlement formula. It does not reduce the model's computation.

The initial funding transaction's network fee is paid separately by the requester's wallet. Cancellation, executor replacement and credit withdrawals also require separate network fees. An executor pays for failed/reverted attempts and its own withdrawal; those are not reimbursed automatically from the request. Smart-wallet/router costs outside the measured runtime call are not an exact reimbursable receipt. There is no guaranteed executor availability, automatic scheduled execution, frontend integration or automatic wallet signing in this change.

The user subsequently authorized the single runtime creation. It is complete and recorded above. No inference deposit, paid chat, or further deployment was included. The source, ABI, frontend configuration, receipt, bytecode pin and local tests are public for integration.
