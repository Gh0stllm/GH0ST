# S0UL-1M parallel hour campaign

Selected lane: **warm-42**.

Each candidate completed its observed one-hour duration budget. Selection used the complete validation set only; the frozen final challenge was opened afterwards. No final-challenge result was used to choose a candidate or alter training.

| Final challenge measurement | Frozen baseline | Selected float model | Selected integer model |
| --- | --- | --- | --- |
| Exact action and arguments | 17.22% | 58.89% | 58.89% |
| Action type | 23.89% | 71.11% | 71.11% |
| Valid format | 100.00% | 96.94% | 96.94% |

Final challenge cases: 360. Integer saturated values: 0.

## Validation-only ranking

| Lane | Full validation exact accuracy | Response cross-entropy | Observed duration | Optimizer steps |
| --- | --- | --- | --- | --- |
| warm-42 | 49.56% | 1.617391 | 3605.94 s | 15772 |
| scratch-43-low-lr | 46.67% | 1.144297 | 3605.97 s | 16096 |
| scratch-42 | 44.00% | 2.304361 | 3605.97 s | 15799 |

Integer/float complete token-sequence agreement: 359/360. This numerical agreement is separate from correctness against expected actions.

## Evidence boundaries

These are narrow synthetic benchmark results. Correct syntax, improved scores or close integer/float agreement do not establish broad reasoning, real-world robustness, financial competence, authorization or production safety.

Training was supervised and offline. Integer inference is a Python/NumPy reference. The mixed export retains floating-point scales/norm gains and is a separate artifact from the fully fixed-point host reference. No full Solidity inference, RH deployment, public transaction, trading action or EVM gas saving is established here.

The artifact contains the selected checkpoint, both export formats, per-lane validation reports, baseline/selected final-challenge predictions, raw token IDs, hashes, duration reports and this summary. CPU times are not gas estimates.

Challenge SHA-256: `67624db57500eda43102c7b1d298157ce5287bc9a59a73d09219d9a9859535e8`.
Selected checkpoint SHA-256: `3647f818b2c6a187d5127ecaf3101308fcc84320491b655c0da98098a08d4665`.
