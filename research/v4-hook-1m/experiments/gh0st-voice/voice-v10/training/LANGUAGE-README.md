# Broad language replay with separate voice and grammar domains

`train_language.py` retains the exact existing H384 parameter layout. The native
GRU receives the embedding and two domain indicators; its first input weight
concatenates the existing `wx1` with the transpose of the existing domain bias
table. Thus it computes the original `wx1 × embedding + domain[domain_id]`
without introducing new learned parameters. Grammar documents use domain1;
authored voice and the small causal curriculum use domain0. The deployed-model
export remains domain0.

Whole documents occupy independent batch rows. The trainer masks padding and
unknown lexical targets while retaining unknown input context and punctuation
supervision. Validation reports grammar and authored voice separately. The
provisional checkpoint criterion is the mean of their joint losses, so the
much larger grammar holdout does not hide voice regression. Complete unedited
domain0 samples still require language and copying review before selection.

```sh
python train_language.py --data ../encoded-language \
  --init-weights ../runs/short-causal-jitter-3000/checkpoint-000500 \
  --output ../runs/NEW_LANGUAGE_TRIAL --steps 2500 --batch 32 \
  --lr 0.001 --every 500 --device mps --jitter 0
```

The example preserves the already broken neuron symmetry of that starting
checkpoint. A still-symmetric initial checkpoint can instead use `--jitter
0.005`. Packing projection and exact Q10 checkpoint bounds remain active.
The script never exports, deploys or contacts a public chain.

`LANGUAGE-VALIDATION.json` records CPU float64 parity with mixed domains,
including domain changes within a row. Maximum forward difference was
2.8e-17, full masked loss difference was zero, and full-objective gradient
difference was at most2.8e-17. A one-update mixed-domain MPS smoke test with
the real initial checkpoint passed, including checkpoint writing and an exact
Q10 packing maximum of15,884 below16,384. This validates mechanics only.
