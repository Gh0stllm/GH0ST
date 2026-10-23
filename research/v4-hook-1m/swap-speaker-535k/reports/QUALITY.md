> Historical fine-tune, superseded by the compositional sampled release. See `NOVELTY.md` and `../../selected-quality-model.json` for the current selection.

# Sentence-quality candidate

Selected artifact: `../quality-candidate-final/`. Its weights are frozen after
epoch 148 of a 160-epoch local NumPy run. The baseline in `../model/` is unchanged.
The saved reports contain every generated sentence and its input features.

The candidate substantially improves agreement between the current price tick
movement and the voice's intensity. Grammar is **not uniformly improved**: the
candidate has a small number of fragments and malformed sentences. The results
therefore support a better-conditioned research candidate, not a claim of
general language fluency.

| Exact-integer development audit, 300 outputs | Baseline | Candidate |
| --- | ---: | ---: |
| Ends naturally within 12 words | 299 | 300 |
| Passes controlled grammar including article agreement | 298 | 296 |
| Article agreement | 299 | 299 |
| Intensity agrees with current movement category | 128 | 265 |
| Outputs with repeated bigrams | 0 | 1 |
| Distinct sentences | 75 | 65 |

The separate confirmation below uses reserved seed **523951**, 12 continuous
streams and 50 callbacks per stream. Prior EWMA, last movement, acceleration and
elapsed-time features follow the hook's update equations. These are
hook-consistent feature trajectories, not proof of executable swaps or liquidity.

| Confirmation, 600 outputs | Baseline | Candidate |
| --- | ---: | ---: |
| Ends naturally within 12 words | 600 | 599 |
| Passes controlled grammar including article agreement | 600 | 588 |
| Article agreement | 600 | 600 |
| Intensity agrees with current movement category | 356 | 504 |
| Outputs with repeated bigrams | 0 | 0 |
| Distinct sentences | 46 | 84 |

The confirmation improves intensity agreement from 59.3% to 84.0%, but loses one
natural completion and 12 controlled-grammar passes. Diversity depends on the
feature trajectory: it declines in the 300-output audit and increases in the
separate 600-output confirmation. It is not a correctness metric.

Examples from the confirmation:

- Low movement: “each swap brings a steady rhythm to the chain.”
- Medium movement: “i hear a shifting rhythm beneath the price.”
- High movement: “my memory carries the turbulent rhythm of this trade.”

The development audit's repeated-bigram error is retained in full:
“an gentle current is still a calm is still a conversation.” Confirmation
failures include fragments such as “the moment.” and one capped sentence,
“this swap leaves a rapid my voice follows my memory carries the.” No output
post-processing hides these errors.

## What changed

Training uses 378 original curated training sentences, 46 validation sentences,
and 56 held-out test sentences. The splits have no identical sentences in
common, but **share templates and vocabulary**. Template families are balanced
after deduplication. Two-sentence training streams carry recurrent memory across
sentence boundaries and changing market regimes. Intensity words receive four
times the token loss weight. Checkpoint selection uses validation cross entropy
plus twice the validation intensity-class error; generated test outputs do not
select the checkpoint.

The model still stores 534,751 parameter values and uses the same 32-wide integer
recurrent computation and depth-13 greedy tree. Of these values, 534,451 are
unconstrained by the fine-tuner. Three existing hidden units are fixed direct
reads of current movement, direction and exactness; 96 feature weights are
inactive (including nine already in those fixed rows). No additional inference
steps, sentence lookup table, sampling or offchain inference is added.

Current absolute tick movement controls intensity. The signs of swap direction
and exact-input/exact-output select four learned opening styles; the text does
not claim to describe those signs. Historical movement, acceleration and elapsed
time are deliberately inactive in this candidate. Those channels are still
accepted by the unchanged input interface, but they do not affect its outputs.

## Scope and reproducibility

The source is the hash-verified recovered quantized export identified in the
manifests, not a claim to have recovered the latest remote filesystem state.
The original `speaker.safetensors` was unavailable. `quality-checkpoint.npz`
is a new full-precision fine-tuning checkpoint reconstructed from the integer
export. General-language retention was not measured: the original pinned
WikiText cache was unavailable. Controlled grammar and intensity are narrow
diagnostics, not independent human or broad-language benchmarks. Intensity
categories are current absolute tick movement below 50, 50–199, and 200 or more;
they do not measure returns or statistical volatility.

From the `swap-speaker-535k` directory, with NumPy available:

```sh
env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 python/finetune_quality.py --epochs 160 --feature-anchors --style-weight 4 --output quality-candidate-final
python3 python/quality_eval.py --model quality-candidate-final --output reports/quality-confirmation-candidate.json --seed 523951 --rounds 50 --hook-consistent --teacher-feature-policy move-and-swap-style
python3 python/quality_eval.py --model model --output reports/quality-confirmation-baseline.json --seed 523951 --rounds 50 --hook-consistent --teacher-feature-policy move-and-swap-style
```

Full run and 300-output audit: `quality-finetune.json`. Reserved confirmation:
`quality-confirmation-candidate.json` and `quality-confirmation-baseline.json`.
Earlier rejected trials: `quality-development.json`. Runtime payload bytes and
SHA-256 hashes: `../quality-candidate-final/manifest.json`. The selected candidate
passed separate EVM and real PoolManager validation after freezing the weights;
see `quality-final-v4-integration.json`. Python results alone do not establish
gas usage. The real local suite passed 9 tests, 19 behavioral checks, and 14
adversarial model cases, including exact integer-reference parity. Full spoken
swap transactions consumed 3,575,471–4,046,224 gas in that local setup.
