# N0VA compatible full-document trainer

This local trainer keeps the existing 8,175,493-parameter, two-layer H384
architecture, tensor names, hierarchical word heads, punctuation head, and
inference `step` unchanged. Native PyTorch GRU computes the same reset-after
gate equations as V8. Each batch row contains one complete source document;
hidden state starts at zero for that row, and padded targets have zero loss.
There are no artificial transitions between documents.

`train.py` consumes the existing encoded JSONL format (`id`, `token_ids`,
`punctuation`, domain0) and `vocabulary.json`. Only the training split updates
weights. Validation loss identifies a provisional candidate; test text is not
used for checkpoint selection. Every saved checkpoint includes unedited,
free-running seed0/42 samples. Language approval still requires reading those
outputs and independent held-out evaluation.

The default post-update packing projection limits each supported matrix-row
group to float L1 15.5. This is an intentional training regularizer and changes
weights; it is not an inference mask. Every checkpoint recomputes quantized
L1 bounds and rejects sums at or above16,384, independently of projection.
Projection counts are reported for each matrix/group. `--no-packing-projection`
disables projection, but the exact checkpoint bounds still must pass.

`--reset-output-priors` optionally initializes group and conditional-word biases
from new-training counts with additive0.25 smoothing. All8,192 output words
remain possible; no lexical or grammar mask is introduced.

Example (run using the research Python environment with local MPS access):

```sh
python train.py --data PATH_TO_ENCODED_DATA --init-weights PATH_TO_CHECKPOINT \
  --output PATH_TO_NEW_RUN --steps 1000 --batch 16 --lr 0.0003 --every 100 \
  --device mps --reset-output-priors
```

CPU float64 parity covered recurrent output/state, gradients, and the complete
masked hierarchical-word plus punctuation loss. Maximum recurrent-output
difference was8.7e-18; masked objective difference was zero. A short MPS probe
at batch8×128 measured warm forward/backward/projection in0.081–0.088seconds,
versus0.179seconds for the original unrolled forward/backward. This is a small
synthetic timing measurement, not a training or language-quality claim.

A one-update smoke test using the actual V8 weights, temporary synthetic
documents, output-prior reset, MPS, checkpoint writing and exact Q10 bounds
passed. No long training run, export, deployment or public-chain operation was
performed to validate this trainer. `VALIDATION.json` records the checks.
