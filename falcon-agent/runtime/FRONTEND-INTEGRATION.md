# Connect the GH0ST frontend

The prepaid runtime is deployed on **Robinhood Chain, chain ID 4663 (`0x1237`)**:

```
0x69996912a59a241763c71810193cf1021ddbb8c0
```

[frontend-config.json](frontend-config.json) contains the chain, address, model/tokenizer pin and limits. [frontend-abi.json](frontend-abi.json) contains the deployable contract's ABI. [mainnet-runtime.json](mainnet-runtime.json) contains the successful receipt, exact bytecode verification, fees and initial read-only checks. No RPC credential or signing key is included.

The address can be wired into a frontend using an EVM wallet library. The deployment does not itself connect the existing website, run an executor, or establish a live end-to-end mainnet inference benchmark. The current frontend remains a separate implementation.

## Request lifecycle

1. Connect the requester wallet and select chain 4663. Configure a working RH RPC outside this public configuration. Check the runtime's code hash against the published pin.
2. Apply the pinned Falcon tokenizer's official chat template to the prompt in the client. Use the same tokenizer to decode generated token IDs. Require a positive output limit and `prompt.length + maxNewTokens <= 64`.
3. Choose an executor. This may be the requester for manual operation, or a separately operated transaction sender with working capital. Only this address can call `advancePrepaid` for that session. A worker service is not included in the deployment.
4. Call `quote(prompt.length, maxNewTokens, gasPriceCapWei, postingFeeCapWei)` as a read. Show `budgetWei` as a **maximum refundable deposit**, separately from estimated consumption and the funding transaction's network fee. Both caps require requester approval. Enforce an explicit maximum deposit in the frontend.
5. Simulate and then submit `startPrepaid(prompt, maxNewTokens, executor, gasPriceCapWei, postingFeeCapWei, budgetWei)` with `value = budgetWei`. Decode `SessionStarted` or `Prepaid` from the confirmed receipt to obtain the session ID. Do not infer the ID from a prior `nextSession()` read, since another requester may start in between.
6. The chosen executor submits `advancePrepaid(id, 256)` repeatedly while unfinished. Each call pays network gas first, then earns withdrawal credit from the request's escrow for successful computation. Transactions need live execution/posting estimates and fee-cap checks; do not blindly copy a local gas limit or treat the billed-gas cap as the total Nitro transaction-gas limit.
7. Read `status(id)` and listen for `Progress`, `Token` and `Finished`. Decode generated token IDs with the pinned tokenizer and display confirmed text. Some continuations only advance computation and produce no visible text. Reconcile events with state after reconnects or chain reorganizations.
8. Show `budgets(id)` and `credits(requester)`. On completion, unused escrow becomes requester credit automatically. The requester calls `withdraw(recipient)` to receive it. The executor also withdraws earned credit. These withdrawals require separate wallet transactions.

The requester may `cancel(id)` before completion, releasing unused escrow into credit, or `setExecutor(id, replacement)` if the current executor stalls. Cancellation does not refund compensation already earned for completed inference work.

## Wallet-library call shapes

The following are library-neutral JavaScript request objects. A frontend may pass them to viem's matching read/simulate/write methods or translate them to ethers. They are not a standalone wallet application:

```js
const contract = { address: config.runtimeAddress, abi };

const quoteRead = {
  ...contract, functionName: 'quote',
  args: [BigInt(prompt.length), maxNewTokens, gasPriceCapWei, postingFeeCapWei],
};
// Read quoteRead -> [maximumUnits, maximumBilledGas, budgetWei].
// Require budgetWei <= requesterApprovedMaximumDepositWei.

const fundingWrite = {
  ...contract, account: requester, functionName: 'startPrepaid',
  args: [prompt, maxNewTokens, executor, gasPriceCapWei, postingFeeCapWei, budgetWei],
  value: budgetWei,
};

const continuationWrite = {
  ...contract, account: executor, functionName: 'advancePrepaid',
  args: [sessionId, 256n],
};

const resultRead = {
  ...contract, functionName: 'status', args: [sessionId],
};

const refundWrite = {
  ...contract, account: requester, functionName: 'withdraw', args: [recipient],
};
```

## Important interface behavior

- The maximum deposit is very conservative. At the deployment preflight's 20,820,000 wei/gas price cap, an 11-token prompt and two-token output quoted **16.9035498 ETH with zero posting allowance**. This was a read-only quote, not a deposit or expected final fee. Nonzero posting allowance increases the deposit. Zero posting allowance rejects a continuation that has a nonzero posting fee.
- The comparable local prepaid chat credited about 0.72 ETH to its executor at its simulated price. This is not a mainnet chat receipt or a guarantee of current cost. Deposits and actual charges must be labelled separately.
- Display cancellation, unclaimed refunds, executor credit, fee-cap pauses and failures explicitly. Do not present a deposit as guaranteeing completion or automatic execution.
- Only one paid continuation is permitted per transaction, even across sessions. Separate transactions may be submitted together; do not multicall multiple `advancePrepaid` calls in one transaction.
- Prompts, intermediate states and generated tokens are public. Text tokenization is performed by the frontend; inference math and model reads execute in contracts.
- Only runtime creation has been sent publicly. Initial verification found zero sessions, zero escrow liability and zero runtime balance. No mainnet paid chat or automatically operated executor has been launched.
