# Local GH0ST voice tuning

This runner fine-tunes the existing 1,235,968-parameter SimpleStories V2 checkpoint on a supplied original JSONL corpus. It does not create a corpus, access a public network, deploy a contract, or modify the frozen pretrained files.

## Fixed model contract

- Four layers, hidden size 128, intermediate size 341.
- Four query heads, two key/value heads, head size 32.
- The same 4,019-token WordPiece vocabulary and tied input/output embeddings.
- Actual tokenizer/runtime EOS is token 1. The downloaded model config names token 2, which is a period; the runner corrects this metadata and never inserts automatic BOS tokens.
- Training uses causal sliding64 attention. Its FP32 absolute rotary arithmetic follows the relative-position identity; the relative-key Q12 export has different rounding and must be evaluated separately.

The fast EVM matrix representation requires rounded Q12 matrix weights in `[-2048,2047]`. By default the optimizer explicitly projects matrix parameters into `[-0.5,2047/4096]` and norm parameters into the signed16 Q12 range after each step. Projection counts are reported. The first pilot needed no projections. Vocabulary expansion, embedding resizing, silently clipping exported weights, or reusing old weight commitments is not supported.

## Input and selection

Provide `train.jsonl`, `validation.jsonl` and `test.jsonl`, each with `id`, `split` and `text`. Normalized exact duplicates are rejected across all splits. EOS 1 is appended to each document. Long documents use overlapping blocks; repeated context is excluded from the loss. Padding uses token 0 with ignored labels and a separate validity mask.

Only validation loss selects a checkpoint. The untouched baseline is retained as step 0. Early stopping prevents continued memorization after validation stops improving. Held-out prompt evaluation is a separate command and does not choose a checkpoint.

## Commands

Run from `research/v4-hook-1m` with a Python environment containing PyTorch, Transformers and Tokenizers, and the existing local pretrained checkpoint:

The runner is `experiments/gh0st-voice/training/train_voice.py`. A pilot command is:

```sh
python experiments/gh0st-voice/training/train_voice.py \
  --corpus experiments/gh0st-voice/data \
  --output experiments/gh0st-voice/runs/new-pilot \
  --steps 600 --batch-size 16 --block-size 128 \
  --eval-every 25 --patience 5 --device cpu --threads 2
```

Add `--inspect` to validate architecture/corpus and report tokenizer coverage without training. A new/empty output directory is required. `--device mps` works only when the installed PyTorch runtime exposes MPS; this host currently uses CPU.

`checkpoint-best/` and `checkpoint-last/` are ordinary Hugging Face safe-serialization directories with the unchanged tokenizer and training metadata. `training-report.json` records source hashes, parameters, split/token counts, validation history and quantization eligibility.

## First pilot

The original 112-document corpus contains only 6,636 text tokens. This is a small voice-transfer experiment, not a general language-model training dataset. The run requested 600 optimizer steps but stopped at 150 after validation deteriorated. Step 25 was selected: validation cross-entropy improved from 5.038 to 4.251 nats/token, while longer training memorized the small corpus. The selected checkpoint is `runs/pilot-600/checkpoint-best`.

Perplexity improvement does not establish good style, originality or on-chain correctness. `evaluate_float.py` compares held-out continuations under identical sampling settings. Quantization/export must regenerate all packed weights, executable tiles, tile partitions and pinned commitments. The newly exported model then requires independent Q12 checks and real local v4 gas tests before any deployment decision.

The first held-out FP32 comparison used 36 prompts and four seeds per prompt. Test loss improved from 4.887 to 4.169, but 11 of 144 tuned outputs were empty or quote-only and median output length fell from 54 to 14 words. The checkpoint is a feasibility pilot, not a release-quality voice model.

## Continuous-stream second pass

`--continuous-corpus` strips one outer pair of double quotes from each document, deterministically shuffles only the training documents, joins each split into its own space-separated stream, and prepends one quotation mark. It does not append EOS between documents or at the stream end. Validation and test text remain isolated from training. Blocks retain the same 128-token length and 64-token overlapping context.

`--trainable-mode top2` freezes the embedding/tied output head and transformer layers 0–1. Only layers 2–3 and the final norm are updated: 360,832 parameters. `all` remains the default. The exact original pilot runner is preserved as `train_voice_pilot_v1.py`, and the default corpus preprocessing was checked to produce identical token/label blocks.

`run_continuous_sweep.py` freezes a copy of the original corpus and compares all-parameter versus top-two-layer training at learning rates 0.00001, 0.00003, and 0.0001. Each run has at most 400 steps, validation every 25 steps, and five-round early stopping. Selection uses validation loss only; held-out generation prompts are not read by this sweep.
