# Experiment 002: frozen-model generalization and operation audit

23 October 2026 · [Configuration](configs/generalization-experiment.json) · [Machine-readable results](reports/generalization-benchmark.json) · [Operation audit](reports/operation-audit.json)

## Question and method

Does the selected 812,195-parameter model add predictive value beyond the saved 771-parameter history-only control when evaluated on additional independent simulated histories?

Both candidates, their preprocessing and thresholds were frozen. No retraining, checkpoint selection or scaler refitting occurred. The experiment evaluates 8,192 new histories across 16 seeds. Each history supplies 512 observations; the label uses the following 96 observations. The first condition uses the original simulator. The two stress conditions change only the specified simulator parameters. A check confirms that the parameterized generator reproduces the original generator byte-for-byte under its original settings.

## Held-out classification results

| Simulation condition | Histories | Adapted TTM | History-only control | Trailing rule | TTM minus control |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original generator, eight new seeds | 4,096 | 90.89% | 91.28% | 90.50% | −0.39 percentage points |
| Fivefold higher regime-switch probability | 2,048 | 71.78% | 70.17% | 68.07% | +1.61 percentage points |
| More frequent shocks and greater observation noise | 2,048 | 88.23% | 88.13% | 86.52% | +0.10 percentage points |

For the primary original-generator comparison, 32 histories were correct only for the pretrained candidate and 48 only for the history control: two-sided exact McNemar p = 0.0929. The pretrained candidate has not demonstrated an advantage on this endpoint. Its conditional Wilson 95% accuracy interval is 89.97–91.74%; the control's is 90.38–92.11%.

The faster-switching stress condition favours the pretrained candidate (74 versus 41 discordant correct predictions; exploratory p = 0.00269). This is a scenario-specific result. Both models' absolute accuracy falls markedly, and it does not establish robust market performance. The noisy/shock comparison gives exploratory p = 0.917.

The compressed-weight candidate still computes in floating point after dequantization. Its respective accuracies are 90.84%, 71.73% and 88.18%. Full per-seed statistics, confidence intervals, quantization agreement and hashes are retained in the JSON report. [Every sample's prediction](reports/generalization-predictions.jsonl.gz) is retained as deterministic gzip-compressed JSON Lines.

## Full prediction operation audit

Forward hooks traced the executed linear modules for one complete 512-observation input, including the pretrained backbone and trained fee head.

| Component | Linear multiply-accumulates |
| --- | ---: |
| Frozen TinyTimeMixer backbone | 7,806,976 |
| Adaptation head | 6,848 |
| Complete candidate | **7,813,824** |

The trace contains 53 linear calls, 92,835 bias additions and 16 layer-normalization calls. Functional GELU, softmax/gating, reductions, scaling, residuals and tensor manipulation are outside the complete arithmetic count. This is an operation audit, **not an EVM gas estimate**. Multiplying the isolated kernel gas by the parameter count would be invalid because weights are reused across patches and other dimensions.

## Decision

Retain both candidates. The smaller model remains the practical control, while the pretrained model warrants further testing specifically around regime transitions. Before a complete EVM port, specify and validate fixed-point normalization, nonlinearities, gating and scaling. Then benchmark complete inference and real PoolManager swaps. Real regularly sampled pool data and an economic objective remain separate research gates.

## Reproduce

From this study directory with the pinned Python environment and saved artifacts:

```bash
python python/evaluate_generalization.py
python python/audit_operations.py
gzip -dc reports/generalization-predictions.jsonl.gz
```

The scripts record their source/configuration hashes, verify saved model identities and use new test seeds. These simulations do not establish profitable fees, reduced LP loss, manipulation resistance or production readiness.
