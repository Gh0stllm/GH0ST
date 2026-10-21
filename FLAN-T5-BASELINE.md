# Selected model: original FLAN-T5-small, 77M

**Selection is recorded, but the original model does not yet meet this agent's chat/action requirements.** It passed 3 of 18 scored local smoke checks, including 0 of 6 exact command cases. Six additional open text responses were reviewed separately and were weak. No training or public-chain transaction was performed in this baseline.

Model: `google/flan-t5-small`, revision `0fc9ddf78a1e988dac52e2dac162b0ede4fd74ab`, Apache-2.0. The loaded original checkpoint has **76,961,152 unique parameters**. It has eight encoder and eight decoder layers, and separate input/output matrices. This is the original instruction-tuned FLAN checkpoint, not the earlier trained 60.5M T5 student.

## Actual local results

| Check | Original float32 | Int8-rounded weights, float32 arithmetic |
|---|---:|---:|
| Grounded/numeric questions | 2/6 | 2/6 |
| Intent classification | 1/6 | 1/6 |
| Exact command and arguments | 0/6 | 0/6 |
| Total scored | 3/18 | 3/18 |

These are small synthetic smoke tests, not a broad capability estimate. Correctness uses case/whitespace-normalized exact answers, allowing trailing full stops. There was no prompt tuning or training against the results. The unsupported-action classification was the only successful intent case: the float32 model selected “unsupported” for all six intent prompts. This illustrates why a valid output label does not establish useful classification.

Examples from the original checkpoint:

| Request | Actual response |
|---|---|
| Read the status of task 701 from supplied state | `pending` — correct |
| Extract Rowan's name from supplied context | `Rowan` — correct |
| What is 12 plus 7? Number only | `0` — incorrect |
| Convert “Mark task 701 complete” into the specified command | `Mark task 701 complete.` — echoed request, invalid command |
| Explain blockchain gas fees | `Bitcoin is a cryptocurrency` — does not answer |
| Ask what the user requested yesterday, without history | Invented a doctor-related response |

All 24 original-weight generations were reproduced token-for-token under a separate Transformers 4.57.1 reference run, compared with the primary 5.2.0 run. The checkpoint hash matches the pinned cache manifest's upstream LFS SHA-256. This addresses the concrete loading/runtime concern raised by the poor model-card translation and the newer runtime's weight-tying warning; it is not a claim of broad model validation.

## Tokenizer and cost findings

The original tokenizer turns JSON braces into unknown tokens. Plain commands such as `complete_task 701` round-trip correctly, although the model failed to generate the specified commands reliably. A future interface needs a deterministic parser and either a supported text command format or a trained tokenizer adaptation.

| Tensor quantity | Bytes |
|---|---:|
| Raw float32 weights | 307,844,608 |
| Ideal int8 matrix payload | 76,939,648 |
| Float32 per-row quantization scales | 580,864 |
| Other float32 parameters | 86,016 |

These figures exclude tokenizer, contract, padding, state and cache overhead. Int8 testing rounded/dequantized weights and retained float32 arithmetic; it is not integer inference.

An unoptimized direct dense forward needs **38,469,632 linear multiply-accumulate operations per generated position**, including the output vocabulary projection, assuming cached encoder cross-attention keys/values. Attention products, activation functions, normalization and other operations add work. This analytic count is **not gas**.

No full-model on-chain deployment or execution cost has been measured. Historical LFM gas results describe a different model's single block and must not be assigned to FLAN-T5-small.

## Next implementation gate

The user-selected checkpoint remains the baseline. It needs a defined, narrow agent task and a substantially stronger checked adaptation dataset before a costly full smart-contract port. The quality target should cover short chat, exact action arguments, missing information, negation and state-dependent answers. These observed failures do not prove that adaptation cannot work, and adaptation success is not guaranteed.

Once quality is sufficient, the contract port must implement the original or explicitly adapted tokenizer, all encoder/decoder operations, caches, fixed-point numerics, decoding, conversation state and independently validated action execution. Offline training/export is compatible with the intended fully on-chain runtime; a caller must still submit transactions.

## Files and preserved work

- `selected-model.json`: accepted model identity, revision and runtime boundary.
- `flan-t5-baseline/benchmark.py`: no-training baseline and int8 weight sensitivity.
- `flan-t5-baseline/eval-*.json`: all prompts, expected answers, raw generations and token IDs.
- `flan-t5-baseline/inventory.json` and `operation-inventory.json`: tensor and analytic operation counts.
- `flan-t5-baseline/upstream-integrity.json` and `reference-runtime.json`: hashes and independent runtime check.
- Original upstream model card and Apache-2.0 license are included. Public original weights are referenced by exact revision and hash rather than duplicated into the archive.

The previous LFM work and distillation checkpoints are preserved. The stopped T5 training pilot remains stopped; it was not resumed to produce this report.

Source: https://huggingface.co/google/flan-t5-small . These local results, rather than the model card's general claims, determine the present readiness assessment.
