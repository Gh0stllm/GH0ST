# Model selection: approximately one million parameters

Research date: 23 October 2026. Repository baseline: `d9d6306b8cbf0eb39e844097e7aa669afe82729e`.

## Selected pretrained candidate

**IBM Granite TinyTimeMixer R2, 512-context / 96-forecast variant.**

- Model repository: https://huggingface.co/ibm-granite/granite-timeseries-ttm-r2
- Pinned revision: `d6a79570cac0f33d526601cd3a0fc7c80a8f9a2f`.
- Configuration: https://huggingface.co/ibm-granite/granite-timeseries-ttm-r2/blob/d6a79570cac0f33d526601cd3a0fc7c80a8f9a2f/config.json
- Published checkpoint: **805,280 parameters**, counted from safetensors tensor dimensions, including every stored parameter tensor. This is approximately 0.81 million, not exactly one million.
- Task: numerical time-series forecasting. This model is not a language model.
- Upstream license: Apache-2.0. See the pinned model metadata and the retained notice accompanying any downloaded model artifacts.

The input to a pool policy is a numerical history. A numerical forecaster is therefore a useful external candidate to evaluate alongside GH0ST's existing language-model work. Suitability for the data type is a hypothesis to test; it is not evidence of profitable trading or improved liquidity-provider returns.

## Comparison

| Candidate | Parameter accounting | Research decision |
| --- | --- | --- |
| Granite TinyTimeMixer R2 512-96 | 805,280 pretrained parameters; adaptation head counted separately | Selected for the initial numerical adaptation experiment |
| GH0ST S0UL-1M | 984,192 parameters from the architecture formula and existing reports | Retain as the existing onchain language-model baseline; no existing trading policy is assumed |
| TinyStories-1M | A 50,257 by 64 token-embedding matrix alone contains 3,216,448 parameters; the complete model is larger | Excluded from the approximately one-million-total-parameter shortlist |

TinyStories configuration: https://huggingface.co/roneneldan/TinyStories-1M/blob/main/config.json

S0UL architecture: [existing model implementation](../../s0ul-1m/s0ul/model.py). Existing public inference costs are in [the S0UL guide](../../s0ul-1m/AGENT.md). These are historical evidence, not new measurements from this branch.

## Initial adaptation

Preserve the pretrained numerical forecasting backbone, train a small classification head on explicitly synthetic histories, and map the three action indices to bounded fee choices. Record the frozen-backbone count, trainable-head count and combined count independently. The experiment is supervised volatility-regime classification: labels are not economically optimal fees.

Use independent training, validation and held-out synthetic histories. Fit any feature scaler and choose training checkpoints without using the test labels. Compare against simple fixed and trailing-volatility baselines. A useful synthetic classification score is only a functional check; simulator design may favour a particular method.

The initial weight-quantization experiment rounds weights and evaluates the rounded/dequantized model on the CPU. It measures sensitivity to representation changes. It does not demonstrate a complete integer implementation or EVM inference.

## Constraints for direct hook inference

The selected model uses 512 observations, patch mixing, GELU, gating, normalization and forecast rescaling. Its 805,280 stored parameters do not equal the number of multiply-accumulate operations in one prediction: weights are reused across patches and other tensor dimensions.

An EVM port must define exact fixed-point arithmetic for the full graph and compare complete outputs against an independent integer reference. The row-dot benchmark in this branch is one primitive in that work. It cannot establish the full-model gas budget by multiplying a per-row number by the parameter count.

The selected model's regular sampling and context length must be respected. Per-swap events have irregular timing; a future collector must define fixed observation intervals, the treatment of intervals with no trades, minimum history and pool-specific normalization. Padding short histories is not evidence of a valid pretrained forecast.
