# S0UL-1M parallel two-hour-20-lane campaign

Selected lane: **expand-replay-5-52**.

Each candidate completed its observed run-walltime budget (7200 seconds), including normal validation and checkpoint work. Optimizer compute is recorded separately. Selection used the complete validation set only; the frozen final challenge was opened afterwards. No final-challenge result was used to choose a candidate or alter training.

| Final challenge measurement | Frozen baseline | Selected float model | Selected integer model |
| --- | --- | --- | --- |
| Exact action and arguments | 40.93% | 41.48% | 41.48% |
| Action type | 50.37% | 52.04% | 52.04% |
| Valid format | 95.00% | 92.04% | 92.04% |

Final challenge cases: 540. Integer saturated values: 0.

## Validation-only ranking

| Lane | Full validation exact accuracy | Response cross-entropy | Observed duration | Optimizer steps |
| --- | --- | --- | --- | --- |
| expand-replay-5-52 | 70.19% | 1.429008 | 7206.75 s | 35802 |
| expand-smooth-05-55 | 69.81% | 1.106958 | 7204.45 s | 48807 |
| expand-replay-15-49 | 69.17% | 1.421611 | 7207.09 s | 36881 |
| expand-uniform-lr-00025-46 | 66.67% | 3.012986 | 7204.22 s | 50522 |
| expand-uniform-lr-00015-45 | 66.20% | 2.148375 | 7206.69 s | 37959 |
| warm-hard-low-lr-44 | 65.65% | 1.333834 | 7205.59 s | 41430 |
| expand-smooth-02-54 | 65.56% | 1.140562 | 7205.71 s | 39735 |
| expand-repeat-uniform-59 | 65.46% | 2.192828 | 7206.51 s | 36535 |
| expand-decay-01-56 | 65.37% | 1.039780 | 7206.73 s | 36370 |
| expand-decay-1-57 | 65.09% | 1.058381 | 7207.05 s | 36071 |
| expand-smooth-01-53 | 63.98% | 1.391913 | 7206.36 s | 35090 |
| expand-repeat-low-lr-61 | 63.89% | 1.454747 | 7204.52 s | 50464 |
| expand-replay-35-51 | 63.70% | 2.651693 | 7204.55 s | 50496 |
| expand-repeat-hard-60 | 63.52% | 1.313343 | 7206.00 s | 36704 |
| expand-uniform-lr-0006-47 | 63.52% | 2.983184 | 7206.28 s | 43554 |
| warm-uniform-42 | 63.43% | 2.755203 | 7205.08 s | 48357 |
| expand-replay-25-50 | 62.87% | 2.109055 | 7205.59 s | 40748 |
| expand-decay-2-58 | 62.22% | 1.943330 | 7204.00 s | 50293 |
| warm-hard-43 | 60.93% | 1.502343 | 7207.44 s | 32636 |
| expand-uniform-lr-0008-48 | 60.46% | 2.240807 | 7207.12 s | 37769 |

## Historical challenge regression check

The historical 360-request challenge is a previously reported benchmark, not a fresh test. It was opened after selection and used for reporting only.

| Measurement | Frozen preceding checkpoint | Selected float model |
| --- | --- | --- |
| Exact action and arguments | 58.89% | 58.06% |
| Action type | 71.11% | 73.33% |
| Valid format | 96.94% | 97.22% |

Historical challenge SHA-256: `67624db57500eda43102c7b1d298157ce5287bc9a59a73d09219d9a9859535e8`.

Integer/float complete token-sequence agreement: 537/540. This numerical agreement is separate from correctness against expected actions.

## Evidence boundaries

These are narrow synthetic benchmark results. Correct syntax, improved scores or close integer/float agreement do not establish broad reasoning, real-world robustness, financial competence, authorization or production safety.

Training was supervised and offline. Integer inference is a Python/NumPy reference. The mixed export retains floating-point scales/norm gains and is a separate artifact from the fully fixed-point host reference. No full Solidity inference, RH deployment, public transaction, trading action or EVM gas saving is established here.

The artifact contains the selected checkpoint, both export formats, per-lane validation reports, baseline/selected final-challenge predictions, raw token IDs, hashes, duration reports and this summary. CPU times are not gas estimates.

Challenge SHA-256: `2832112d7aa0f357bf3eb09d137abfbe46b89d58103d3755362132dd8c10d4d7`.
Selected checkpoint SHA-256: `44bed666c464273e6fff84b10a4977744d9b0e923f5b6a519d7725920b500692`.

## Combined campaign provenance

Original three lanes: https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39629553411

Supplementary 17 lanes: https://github.com/8tk8m2kv9f-lang/GH0ST/actions/runs/39630021281

The original three-lane workflow may have published a preliminary measurement on this same preregistered challenge. All 17 supplementary configurations were frozen before those results. No preliminary challenge score changed training or the combined validation-only selection. This is the combined 20-lane measurement, not a claim that the challenge was first reported here.
