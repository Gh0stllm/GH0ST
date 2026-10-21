# Selected baseline: original FLAN-T5-small

The user selected `google/flan-t5-small` as the existing pretrained model below 100M parameters. `../selected-model.json` pins revision `0fc9ddf78a1e988dac52e2dac162b0ede4fd74ab`. This baseline performs **zero training steps** and preserves the original tokenizer and checkpoint weights. In-memory int8 weight rounding is an additional sensitivity experiment; no modified checkpoint is saved by it.

The loaded checkpoint has 76,961,152 unique parameters, eight encoder layers and eight decoder layers, hidden width 512, feed-forward width 1024, six attention heads of width 64, gated GELU, and separate input/output matrices. It is distinct from the stopped 60.5M T5-small training experiment.

## What is measured

- Six open text responses for manual review.
- Six grounded/numeric questions, six intent classifications and six exact command cases.
- Identical prompts with original float32 weights and with per-row int8-rounded/dequantized matrix weights.
- Original tokenizer round trips, including the known JSON-brace limitation.
- Actual tensor shapes and parameter counts, plus analytic linear multiply-accumulate counts.

These are synthetic smoke tests, not a general model benchmark. Scored answers allow differences in case, repeated whitespace and one or more trailing full stops. No prompt tuning, test-based training, grammar-constrained decoding or generated-action execution is performed. Decoder generation is greedy and capped at 64 new tokens, with four CPU threads.

`run.json` and `eval-*.json` contain every result, raw generated token IDs and CPU timing. `upstream-integrity.json` records hashes of the pinned input files and a model-card translation probe. A separate runtime check may be recorded in `reference-runtime.json`; read the project-level report for which result is authoritative.

## Runtime costs

Raw float32 parameters occupy 307,844,608 bytes. Ideal matrix-only int8 payload is 76,939,648 bytes, with 580,864 bytes of float32 row scales and 86,016 bytes of other float32 parameters. Tokenizer data, contracts, padding, state and caches are additional. Neither storage figure is a deployment fee.

The direct dense implementation requires 38,469,632 linear multiply-accumulate operations per generated position including the full vocabulary projection, assuming encoder cross-attention keys/values are cached. Attention score/value products, normalization, activations, softmax, tokenization and persistence add work. This is an analytic operation count, **not measured gas**.

Full on-chain execution requires tokenizer/decoder implementation, encoder and decoder arithmetic, both attention caches, fixed-point numerical validation, conversation state and a deterministic action executor. The original tokenizer maps JSON braces to unknown tokens; a command representation or validated tokenizer adaptation is required.

## Reproduce

Use the model and dependency revisions stated in the recorded run. Cache the upstream checkpoint/tokenizer at the pinned revision, with remote code disabled. From the project root:

```bash
python flan-t5-baseline/benchmark.py
```

`benchmark.py` uses `local_files_only=True`; no model API, GPU rental or blockchain RPC is called. An initial public checkpoint download is required if it is absent from the cache. Original upstream model files are not duplicated into this archive; hashes and revision identifiers are supplied.

The optional reference check uses an isolated environment with Transformers 4.57.1, huggingface-hub 0.36.0 and tokenizers 0.22.1, plus the same Torch version. Run `python flan-t5-baseline/verify_reference_runtime.py --checkpoint /absolute/path/to/pinned-checkpoint`. It verifies original file hashes before replaying the same prompts. Do not change the historical LFM environment to run this optional check.

The Apache-2.0 license and upstream model card are included. Reference: https://huggingface.co/google/flan-t5-small . The selected-model report states measured limitations and the next implementation gate.
