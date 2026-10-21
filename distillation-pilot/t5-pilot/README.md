# Second local pilot: complete pretrained T5-small student

**Stopped by the user.** Training, float32 final evaluation and int8 evaluation completed. Int4 evaluation was interrupted after 20 logged cases; qualitative evaluation and reload verification did not run. This experiment has not been resumed. The current selected model is the original FLAN-T5-small checkpoint in `../../flan-t5-baseline/`, not this trained T5-small student.

This CPU experiment preserves all layers of the pretrained google-t5/t5-small model and adapts it to the same task/action schema as the first pilot. It follows the poor argument accuracy of the depth-pruned SmolLM2 pilot. It is not a controlled architecture comparison: initialization, training corpus, trainable parameters, teacher, step count and final test prompts all differ.

## Model and training

- Student: 60,506,624 unique parameters; six encoder and six decoder layers, hidden width 512. All student parameters train.
- Teacher: google/flan-t5-small, 76,961,152 unique parameters, frozen. Teacher output weights remain separate from its shared input embeddings.
- Exact revisions are recorded in `model-locks.json`; upstream model cards and the parent directory's Apache-2.0 license are bundled.
- Loss: 90% checked-target cross entropy plus 10% teacher-to-student KL at temperature 2 with T-squared scaling. Both see the same gold response prefix.
- AdamW, learning rate 0.0003, warmup and cosine schedule, gradient clip 1, batch size four, 240 planned steps, deterministic seed 29, four CPU threads.
- Class-balanced sampling with replacement from 693 hand-authored synthetic examples. Targets are not teacher-generated. There is no SFT-only control, so any improvement cannot be attributed specifically to the KL term.

## Tokenization

The upstream tokenizer lacks JSON braces and backslash. Three ordinary added tokens map to already available padded vocabulary rows: `{` = 32100, `}` = 32101, and backslash = 32102. Initial weights copy related punctuation. No matrix dimension is enlarged. The same vocabulary mapping is used in both model forwards; KL is excluded at these three target-token positions because they were absent from teacher pretraining.

Every gold example was checked for unknown tokens and JSON round-trip equivalence before training. Arbitrary quoted/escaped strings remain a known limitation: an initial escaped-title check failed because the tokenizer introduced spaces around a backslash. That training example was replaced before the recorded run. The quoted-title qualitative challenge remains included. This tokenizer is not yet an on-chain tokenizer.

## Evaluation and boundaries

The 47 validation examples share the earlier pilot's validation set. Final evaluation uses 62 freshly authored prompts and held-out argument values, with no prompt overlap with the first pilot's final test. Both sets remain narrow synthetic tests sharing task meanings and FAQ topics. This final set was not used for gradients or checkpoint selection. Once reviewed, it is retired for further tuning.

The model generates freely with greedy decoding, capped at 96 new tokens; there is no grammar-constrained decoder. Action tests require exact arguments and valid schema. Reply/clarify/refuse cases use selected-word checks and need semantic review. Twelve additional challenges are exploratory and reuse failure categories from the first pilot; they are not an independent accuracy benchmark.

`run.json` records actual step count, training time, checkpoint hashes, aggregate scores and quantization sensitivity. `eval-*.json` preserves every generation and expected response. The checkpoint is saved in BF16 and evaluated in float32 after BF16 rounding. Int8/int4 sensitivity quantizes and dequantizes matrix weights per row and still computes in float32. It is not integer-only execution or a gas measurement.

No generated action is executed. No public transactions, API inference or paid GPU allocation occur. The intended deployment boundary remains fully on-chain runtime inference, state and validation, with offline model training/export and an external transaction submitter.

## Reproduce

Use the pinned environment in the project root. Cache the public model/tokenizer files at both revisions in `model-locks.json`, with remote code disabled, then run from the project root:

```bash
python distillation-pilot/t5_pilot.py --steps 240 --max-seconds 900
```

The script uses `local_files_only=True`. Rerunning overwrites this pilot's generated dataset/results/checkpoint, so copy the experiment directory first if preserving this run. The two `initial-*-error.log` files preserve setup failures that preceded the recorded run. They are not completed training results.
