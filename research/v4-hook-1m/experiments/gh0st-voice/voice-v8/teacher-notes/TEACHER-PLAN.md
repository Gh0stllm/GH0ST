# Offline GPT-2 sequence teacher

The local124,439,808-parameter GPT-2 loads with the current installed tools and no missing, unexpected or mismatched keys. A CPU-only six-token smoke passed. The cache is pinned to SHA256 `248dfc3911869ec493c76e65bf2fcf7f615828b0254c12b473182f0f81d3a707`; no download is needed.

Installed dependencies are torch2.14.1, transformers5.20.2, tokenizers0.23.3 and safetensors0.8.0. The scripts use ordinary PyTorch training and Hugging Face local loading; PEFT, Accelerate and Datasets are not required. Network access and remote model code are disabled explicitly.

## Small first experiment

1. Adapt only the last four transformer blocks and final layer norm. Preserve embeddings and lower eight blocks. The option `--mode all` is available for a later explicit comparison.
2. Use the original project-authored training paragraphs only. The current encoded-base source contains749 train paragraphs/42,290 words,86 validation paragraphs/4,020 words and84 test paragraphs/3,905 words. Do not combine these into a supposed54k-word training set.
3. Default to two epochs at batch4, length256, learning rate2e-5, AdamW and gradient clipping1. Save only validation improvements as `checkpoint-best`; keep `checkpoint-last` separately. Report truncated documents. A worse final checkpoint is not automatically selected.
4. Screen full held-out continuations before bulk generation. The CPU smoke proves loading and arithmetic, not story quality; even its six tokens changed a brass key into a silver key.
5. If the adapted teacher is useful, generate100k BPE tokens first, in batches of8 with KV cache. Expand to300k only if a reviewed sample is substantially more grammatical and coherent than the student's outputs. Six-token CPU timing is not a bulk-generation benchmark.

Prepared files: `load_local_gpt2.py`, `train_teacher.py`, `sample_teacher.py`. They have not launched GPU training. Example commands, after review, from the research root:

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v8/teacher-notes/train_teacher.py --data experiments/gh0st-voice/voice-v7/training/encoded-base --out experiments/gh0st-voice/voice-v8/teacher-runs/top4-2epochs --device mps
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v8/teacher-notes/sample_teacher.py --checkpoint experiments/gh0st-voice/voice-v8/teacher-runs/top4-2epochs/checkpoint-best --prompts PATH_TO_REVIEWED_PROMPTS.jsonl --out experiments/gh0st-voice/voice-v8/teacher-runs/samples-100k --device mps --target-tokens 100000
```

Prompt rows have `id` and `prompt`. Use new or training-derived first-person scene prefixes; do not use held-out original passages as prefixes for material that will be added to student training.

The sampler saves every raw continuation, then a separate candidate file with only minimal length/duplicate/nonprose filtering and cuts at naturally generated sentence endings. Candidate status is not a semantic-quality pass. Review narrator continuity, object identity, contradictions and long copied spans against the original corpus before training the student. Preserve prompt ancestry and group-derived splits. The prepared sampler does not yet perform the16-word source-copy audit; that is a required subsequent review step.

## Why sequence distillation

The teacher predicts50,257 BPE tokens. The student predicts8,192 lexical words plus a five-way punctuation label. Those logit spaces cannot be compared directly. Summing teacher first-piece probabilities does not give the probability of a complete student word, and an arbitrary hidden-state MSE does not fix this mismatch. Correct word-level KL would require trie-based multi-token likelihoods including word boundaries, which is a much slower and more complex experiment.

Sequence distillation avoids that ambiguity: the local teacher generates text, reviewed text becomes ordinary student training targets, and the student still generates every word and punctuation mark through its own network. No teacher, grammar repair or sentence bank is inserted into the runtime.

GPT-2 is an old base completion model. Adaptation may improve voice but can also overfit this small source set. No quality or runtime improvement is claimed before the teacher and student are tested.
