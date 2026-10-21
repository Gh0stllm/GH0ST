# Prepaid execution and contract-computed budgets

The prepaid controller is integrated into `GH0STRuntime`, now deployed on RH at `0x69996912a59a241763c71810193cf1021ddbb8c0`. See the [deployment receipt](mainnet-runtime.json) and [frontend integration kit](FRONTEND-INTEGRATION.md). `PrepaidBudget.sol` is inherited code, not another deployed helper. The runtime still reuses the existing kernel and immutable weight index.

## Contract quote

Call `quote(promptTokens, maxNewTokens, gasPriceCap, postingFeeCap)` without sending a transaction. It returns `maximumUnits`, `executionGasCap` and `budgetWei`. All calculations occur in Solidity; the client reads the returned values. The price ceilings are chosen and approved by the requester rather than predicted by the contract.

Let P be prompt length, O the maximum output length, G the gas-price cap in wei/gas and L the posting-fee cap in wei per continuation. P and O must be positive and P+O must not exceed 64.

```
maximumUnits    = (P + O - 1) * 2161 + O * 129
executionGasCap = maximumUnits * 31_000_000
budgetWei       = executionGasCap * G + maximumUnits * L
```

Each processed position uses one embedding and 24 layers of 90 work units. A generated token also needs final normalization and 128 vocabulary-projection tiles. Intermediate prompt positions skip output projection. Early EOS shortens the work. Every successful continuation must execute at least one work unit and consumes its actual unit count from the quoted allowance, so the number of successful paid continuations cannot exceed `maximumUnits`.

Every successful call's billed execution gas is at most 31 million, its gas price at most G, and its posting fee at most L. Consequently all successful charges together are bounded by `budgetWei`, regardless of how the allowed work is divided among transactions. No top-up function or silent increase of either price ceiling exists. If prices exceed a ceiling, work pauses until it can fit or the requester cancels. More funding cannot be silently taken from a wallet.

This is a deliberately loose **maximum reimbursable budget**, not a measured prediction of required execution gas or proof that every permitted input will finish. For the Hi/Hello example, P=11 and O=2 gives **26,190 units** and **811,890,000,000 maximum billed execution gas**. At the historical price 21,088,000 wei/gas and with zero posting allowance, the maximum deposit is **17.121136320000000000 ETH**. This is far above the measured roughly 34 billion execution gas. It must never be displayed as the expected fee. A positive posting allowance adds `26,190 * L` wei. A zero posting cap is illustrative and will reject a continuation with a nonzero posting charge. No such deposit has been requested or sent on mainnet.

Tighter upfront funding requires validated tighter work-cost bounds or a different, explicitly partial budget policy. This implementation prioritizes an enforceable spending bound over a falsely precise estimate. It does not claim that the current conservative deposit is practical for ordinary chat.

## Settlement formula

For one successful `advancePrepaid`:

```
billedGas  = gasAtEntry - gasBeforeSettlement + 120_000
paymentWei = billedGas * tx.gasprice + currentTransactionPostingFee
```

The 120,000-gas allowance is a disclosed accounting term for intrinsic/settlement and executor overhead, not an exact reconstruction of the final receipt. It can overcompensate or undercompensate an executor relative to its actual receipt. Storage refunds and work outside the runtime call are not measured exactly. The cap is checked before any charge becomes durable. The return value is not supplied by an executor: the contract measures gas and reads the current posting fee from ArbGasInfo at `0x6c` using `getCurrentTxL1GasFees()`.

Missing or malformed precompile results fail closed; they are never treated as free posting. Tests explicitly mock this precompile on Anvil, and the separate read-only RH quote probes availability. A transient-storage guard permits only **one paid continuation across all sessions per transaction**, preventing the whole transaction's posting fee from being reimbursed twice. This intentionally prohibits multicalling paid continuations in one transaction. Separate transactions can still be submitted in a group; each remains subject to its own chain limits and charges. Cancun transient-storage support must be verified on the target chain.

The requester chooses an executor and may replace it. An executor can choose small successful batches and receive the disclosed overhead more often; the quote assumes this worst case. Requesters should select an executor whose batching policy they accept. There is no administrator, platform commission, arbitrary intermediate-activation input or trusted output provider. Executors trigger the same on-chain inference state machine; they cannot substitute model results.

## Lifecycle and funds

| Call | Effect |
| --- | --- |
| `quote(P,O,G,L)` | Computes a conservative maximum refundable escrow. Read only. |
| `startPrepaid(prompt,O,executor,G,L,expectedBudgetWei)` | Checks quote and exact `msg.value`, records requester and fixed caps, then starts the session. |
| `advancePrepaid(id,maxUnits)` | Chosen executor computes 1–256 units subject to gas headroom; receives capped withdrawal credit. |
| `setExecutor(id,executor)` | Requester replaces a stalled executor without altering caps, escrow or inference state. |
| `cancel(id)` | Requester stops generation and receives the unused balance as withdrawal credit. |
| `budgets(id)` | Reports owner, executor, caps, remaining work allowance, remaining escrow and charged wei. |
| `credits(account)` | Reports withdrawable refunds and executor compensation. |
| `withdraw(recipient)` | Caller withdraws all its own credit; failed recipients preserve the credit; reentry is blocked. |
| `status(id)` / `values(id,base,count)` | Reads generated token IDs or numerical checkpoints. |

`totalLiability` includes active escrows and all withdrawal credits. Charges and refunds only reassign this liability. It decreases only on successful withdrawal. Completion automatically releases unused escrow into credit, so a rejecting recipient cannot block inference completion. Contract users may withdraw to another recipient.

## Remaining limits

The chain does not execute contracts by itself. An executor must operate a transaction sender, have working capital, and agree to the quoted caps and billing terms. The repository prepares unsigned calls and deliberately contains no new signing-key service. Funding does not guarantee an executor or a completion deadline. The requester can cancel at any time while unfinished.

The 64-token numerical worst case has not been fully benchmarked. A numerical revert or a unit exceeding available gas can prevent completion for some inputs, even with the entire quoted escrow. Spent work is not refundable. The owner may cancel and reclaim the remaining balance. This is a bounded research implementation requiring further numerical, economic and independent security review before production use.

The client must show the deposit separately from estimated consumption and from the wallet's funding-transaction fee. `client.py start` requires an explicit `--max-budget-wei` and refuses a larger on-contract quote. It does not silently authorize a large escrow.

## Primary references

- [Solidity transaction variables](https://docs.soliditylang.org/en/latest/units-and-global-variables.html): `gasleft`, `tx.gasprice` and the limits of off-chain call context.
- [Arbitrum precompiles](https://docs.arbitrum.io/arbitrum-essentials/precompiles/reference): ArbGasInfo and current-transaction parent posting fees.
- [EIP-1153](https://eips.ethereum.org/EIPS/eip-1153): transaction-scoped transient storage.
