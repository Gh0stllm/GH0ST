# Four-source local comparison

This isolated copy leaves the original three-source runs unchanged. It trains the same 1,235,968 parameters and 4,019-token vocabulary from the pretrained base. Default block probabilities are 10% authored, 15% compositional, 15% public-domain and 60% licensed teacher replies. Actual supervised-token counts and repeat exposures are recorded separately.

`prepare_cache.py` accepts all four source kinds and requires a stable conversation/source group for each `licensed_teacher` row. A teacher conversation cannot appear in multiple splits. Existing normalized-text, compositional-family, public-domain-group, tokenizer and unknown-token checks remain. Input hashes bind the supplied data; permission and attribution remain properties of the source-data manifest.

`train_teacher.py` accepts a JSON `--source-weights` object of nonnegative probabilities summing to one. It uses the same no-EOS paragraph packing, random document boundaries, quote starts, causal sliding-64 attention, weight bounds, saved 512-token continuations and explicit candidate limitations as the three-source pipeline. Its default target is 4M supervised tokens at learning rate 1e-5. Degeneration stopping is disabled by default; numeric safety failures still stop the run.

```sh
python experiments/gh0st-voice/large-v3/training-teacher/prepare_cache.py \
  --data PATH_TO_FINAL_FOUR_SOURCE_SPLITS \
  --output experiments/gh0st-voice/large-v3/cache/teacher-v4

python experiments/gh0st-voice/large-v3/training-teacher/train_teacher.py \
  --cache experiments/gh0st-voice/large-v3/cache/teacher-v4 \
  --output experiments/gh0st-voice/large-v3/runs/teacher-v4-4m \
  --target-tokens 4000000 --learning-rate 0.00001 --threads 2 \
  --source-weights '{"authored":0.1,"compositional":0.15,"public_domain":0.15,"licensed_teacher":0.6}'
```

The data path is intentionally unresolved until the merged corpus is approved. `test_pipeline.py` checks the four-source distribution, cache reuse, no inserted EOS, quote labels, conversation leakage rejection and a one-step gradient/snapshot smoke test. `evaluate_snapshots.py` measures held-out loss separately by source, without changing candidate selection. Different mixture-validation scores cannot be compared directly across runs.

No network inference, wallet or mainnet operation is part of this pipeline. Teacher text is model-generated training material, not independently human-authored evidence or a guarantee of accuracy. Low validation loss and passing loop guards do not certify coherent prose; selected checkpoints still need manual review, exact Q12 export and local v4 gas tests.
