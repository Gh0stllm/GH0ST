# Integer inference evaluation — pilot 001

Frozen first checkpoint evaluated on the complete 270-example synthetic held-out test split. No training or numeric-spec adjustment was made in response to these results.

| Measurement | Result |
| --- | --- |
| Exact action and arguments | **85 / 270 (31.48%)** |
| Action type | 129 / 270 (47.78%) |
| Valid grammar and EOS completion | 270 / 270 (100%) |
| Complete generated token sequence equal to float checkpoint | 269 / 270 (99.63%) |
| Token-position agreement, including EOS and unequal lengths | 729 / 734 (99.32%) |
| Saturated values | 0 |
| Full-prefix integer forward calls | 734 |
| Integer generation wall time summed across records | 47.15 seconds |
| Total evaluation time, including float comparison | 49.37 seconds |

All generations used greedy argmax, a maximum of 32 new tokens and the configured 128-token context budget. No grammar-constrained decoder was used. Generated PAD/BOS/SEP controls are visible failures; EOS termination and action schema are checked independently.

## Interpretation

The candidate reproduces most float-checkpoint token decisions on this narrow test, but its task correctness is poor. Valid action syntax does not establish correct arguments, authorization, safety or broad language ability. This result does not support autonomous execution of model-selected actions.

The single float/integer sequence difference was `test-00061`: the request asked to remember mode `rapid`. The float model produced `TASK_LIST|SELF`; the integer candidate produced `MEM_SET|mode|quiet`. Both were incorrect. All raw predictions and token IDs are retained in [the JSON report](integer-evaluation-pilot-001.json).

The earlier illustrative prompt `Check my ETH balance.` also produced a wrong GH0ST balance action in both float and integer inference. This is a model generalization failure, not evidence of successful balance understanding.

These are CPU measurements for a Python/NumPy integer reference. They are not EVM gas estimates, chain transactions or an on-chain inference result.

## Pinned evidence

- Checkpoint SHA-256: `d594a408de23926c2898b9e18248cb0e4de35d1eef02a89d2fd6577df4a799a6`
- Test split SHA-256: `4513f9848cb2894b2e9a3b63b1f06b3afac5d71b6ffaa6de19fdcc5ed2e50496`
- Integer payload SHA-256: `9d70a2a7ae9d5fb8709de11c1078ed5ff95390dc0919acba359686c3fa36077f`
- Integer payload bytes: 1,102,856

## Reproduce

```bash
python -m s0ul.integer --checkpoint runs/pilot-001/checkpoint.pt --output exports/integer-pilot-001
python -m s0ul.integer --bundle exports/integer-pilot-001 --evaluate-data data/test.jsonl --evaluation-output reports/integer-evaluation-pilot-001.json --compare-checkpoint runs/pilot-001/checkpoint.pt --max-new-tokens 32
```

The numeric specification is [INTEGER-SPEC.md](../INTEGER-SPEC.md). Model checkpoints and binary bundles are identified by hashes; they are generated local artifacts unless explicitly published separately.
