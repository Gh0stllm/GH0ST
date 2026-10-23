# Research protocol: a model-controlled Uniswap v4 hook

## Question

Can a pretrained model with approximately one million parameters be adapted into a bounded pool policy, then executed with deterministic onchain inference at a practical cost?

This branch separates three questions:

1. Can the chosen pretrained model produce useful signals for the proposed numerical task?
2. Can its full adapted computation be represented with reproducible integer arithmetic?
3. Can that computation and the hook integration satisfy realistic gas, manipulation-resistance and economic requirements?

Passing one question does not establish the others.

## Initial action space

The experimental output is an action index in `{0, 1, 2}`. Illustrative fee values are `[500, 3000, 10000]` in Uniswap fee units, equivalent to `[0.05%, 0.30%, 1.00%]`. These choices are experimental constants, not a fee recommendation for a live pool. The model cannot invent an arbitrary action, transfer assets or change fee bounds.

The initial target is future volatility regime in synthetic regularly sampled histories. This makes the pipeline reproducible without claiming a dataset of real pool observations. The experiment does not optimize realized LP returns, loss-versus-rebalancing or trader execution cost.

## Execution designs under study

### Direct inference

The eventual direct design performs the complete model computation during `beforeSwap`, checks the output against contract-enforced limits, and returns a fee override. `afterSwap` updates bounded observations. Both callbacks run synchronously inside the transaction. A complete full-model integer port and gas benchmark are prerequisites for calling this design implemented.

### Completed policies for future swaps

A separate incremental onchain engine can complete a larger computation before a subsequent swap uses its result. A policy must bind the model identity, pool, input snapshot, validity window and allowed state drift. The hook applies a baseline fee if no acceptable policy exists.

The integration harness in this branch uses a mock policy source to exercise the consumption interface. Its mock publisher is trusted. Model-hash fields, signed statements or an interface named `finalized` are not proofs that a model was executed. An authenticated onchain inference engine or a separately specified verification mechanism is required to remove that trust assumption.

## Measurements

### Model experiment

Record model and library revisions, checkpoint hashes, exact parameter counts, frozen versus trainable parameters, seeds, split sizes, preprocessing, label definition, training objective and all baseline results. Retain sample-level held-out predictions. Publish negative comparisons and quantization regressions.

An INT8 storage estimate excludes floating-point scales, biases, metadata and execution code unless those are explicitly included. Rounded/dequantized CPU evaluation is a representation-sensitivity study, not native integer inference.

### Arithmetic experiment

Compare the scalar and packed-load INT8 dot-product implementations using identical inputs, Solidity compiler settings and local EVM configuration. Validate every output against a separate BigInt oracle, including signed extremes and partial 32-byte words. Record receipt gas, data layout and source hashes. These measurements concern a primitive, not an entire forecast or swap.

### Hook integration

Test pool identity, dynamic-fee requirements, caller restrictions, policy identity, expiry, replay/staleness and state drift. Exercise safe fallback paths. Clearly identify whether tests use the real Uniswap PoolManager or a harness. A passing mocked integration does not establish complete settlement or router compatibility.

## Further work before live use

- Build a real pool-data collector with fixed observation intervals and reproducible historical snapshots.
- Evaluate held-out chronological regimes and compare with fixed fees and simple deterministic policies.
- Test wash trades, splitting trades, transient liquidity, same-block manipulation and cross-pool interactions.
- Define and verify full-model integer normalization, nonlinearities, gating and scaling.
- Measure full inference, weight deployment, observation writes and complete swaps on the intended EVM configuration.
- Authenticate finalized inference results and bind their inputs to observations.
- Assess router/quote compatibility and economic performance; changed fees change future order flow, so historical replay alone is not a complete counterfactual.

## References

- [Uniswap v4 hooks](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks)
- [Uniswap dynamic fees](https://developers.uniswap.org/docs/protocols/v4/concepts/dynamic-fees)
- [PoolManager call order](https://github.com/Uniswap/v4-core/blob/main/src/PoolManager.sol)
- [Official deployments, including Robinhood Chain 4663](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [Pinned model and selection record](MODEL-SELECTION.md)
