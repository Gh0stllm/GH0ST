# Research status

Updated: 23 October 2026. Branch: `research/v4-hook-1m`.

## Completed local work

| Workstream | Result | Evidence |
| --- | --- | --- |
| Candidate selection | IBM Granite TinyTimeMixer R2: 805,280 pretrained parameters | [Selection record](MODEL-SELECTION.md) |
| Adaptation | Frozen backbone plus 6,915 trained parameters; 812,195 total | [Model report](reports/model-benchmark.json) |
| First held-out split | 90.625% accuracy; 771-parameter history baseline: 92.1875% | [Per-sample predictions](reports/model-predictions.json) |
| Compressed representation | 382/384 decisions agree after INT8 rounding and floating-point restoration | [Model report](reports/model-benchmark.json) |
| Saved-artifact verification | Exact reproduced outputs; malformed inputs and modified checkpoint rejected | [Verification report](reports/model-verification.json) |
| EVM row kernels | 120 oracle comparisons; 30 invalid inputs rejected; 35–42% lower receipt gas at widths 128–1,024 | [Kernel report](reports/kernel-benchmark.json) |
| Hook consumer | Pool/model binding, policy bounds, freshness, rollback prevention and fixed-fee fallback | [Contract](contracts/GH0STPolicyHook.sol) · [Tests](tests/evm/policy-hook.test.mjs) · [Local callback measurements](reports/hook-integration.json) |
| Additional synthetic evaluation | 8,192 new histories; no advantage on the original generator; exploratory benefit during faster regime changes | [Experiment 002](RESULTS-002.md) · [Full results](reports/generalization-benchmark.json) |
| Executed operation audit | 7,813,824 linear MACs across 53 calls for one complete prediction | [Operation audit](reports/operation-audit.json) |

## Research gates

- [x] Pin and account for the pretrained checkpoint and trainable head.
- [x] Retain first synthetic results, smaller controls and representation regressions.
- [x] Check signed arithmetic against an independent oracle.
- [x] Exercise bounded hook consumption using a local mocked policy source.
- [x] Evaluate frozen candidates on additional unseen simulation seeds and changed regimes.
- [x] Count executed linear operations through the complete selected model.
- [ ] Specify and validate the complete integer graph, including functional nonlinearities and normalization.
- [ ] Execute the full model with authenticated inputs and deterministic integer arithmetic.
- [ ] Connect verified inference to a real Uniswap PoolManager swap.
- [ ] Evaluate real regularly sampled pool histories and economic outcomes.

## Interpretation

This is a set of local component experiments. The full TTM model does not execute inside the hook. The mock policy source attests to a policy but does not prove inference. No full-swap gas, market advantage, production readiness or public-chain deployment is established. Keep new experiment results separate from the first split.
