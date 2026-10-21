> Historical first-stage results. See `TEST-RESULTS.md` for the newer complete-block, precision and three-chain comparison.

# First run: 19 October 2026

**Status: CPU reference completed; on-chain feasibility is not yet established.**

The exact checkpoint `40cb2ad3b3044d5a41eee083a6103c8b523afa45` of `LiquidAI/LFM2.5-230M` loaded successfully and answered all six smoke prompts. The runtime was float32 on CPU, with greedy decoding, four threads, a 256-token context budget and a maximum 32-token reply.

## Model size

The loaded model has **229,693,184 unique parameters**. Uniform ideal 4-bit packing would require **114,846,592 bytes**, about **114.85 MB / 109.53 MiB**, before scales, padding, tokenizer data, contract code and state. This is a size calculation, not an evaluated quantized artifact.

At the chosen 256-token context, float32 attention KV tensors alone account for 6,291,456 bytes (6 MiB). Convolution state, activations and other runtime allocations add to this. It is not a measurement of total runtime memory.

## Observed replies

| Case | Finding |
| --- | --- |
| Greeting | Coherent reply, but did not follow the one-short-sentence constraint. |
| Brief definition | Coherent definition, but 21 whitespace-separated words exceeded the requested under-20-word limit. |
| Supplied project name | Correctly recalled Cedar. |
| Unknown wallet balance | Acknowledged lack of access instead of inventing a balance; the reply was cut off at 32 tokens. |
| Structured action | Returned `action: set_goal` and `goal: learn Solidity` as plain text, not valid JSON. No action was executed. |
| Arithmetic | Computed 43 correctly, but included an equation and formatting instead of returning only the number. |

One of three strict automatic checks passed. The arithmetic check failed on output format, not arithmetic. These few cases should not be generalized into an overall model accuracy score. They do show why an action executor must reject malformed output and enforce permissions separately.

The six generation calls took about 0.95–2.21 seconds each on this CPU environment, including prompt processing. **These timings say nothing about blockchain reply latency or gas.**

## Robinhood RPC

The read-only preflight returned chain ID **4663**, block **92,917,082**, and a gas-price quote. The full timestamp and block hash are in `results/rpc.json`.

- Transactions broadcast: **0**.
- Stylus activation tested: **no**.
- Model computation executed by contracts: **no**.
- Gas per token, deployment cost and cost per reply: **not measured**.

## Decision

Proceed to an actual contract arithmetic and weight-access benchmark before funding a full model deployment. The next milestone is deterministic integer parity and measured gas for a model computation slice, followed by one complete block and a full token. More deployments alone do not establish affordable or responsive on-chain chat.

The requested product inputs are a budget ceiling, acceptable reply delay and a few concrete tasks. The baseline required no private API key or GPU rental.
