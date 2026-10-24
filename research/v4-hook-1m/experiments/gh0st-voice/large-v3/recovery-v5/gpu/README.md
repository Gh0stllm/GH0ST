# Local GPU voice trainer

This isolated copy of the unlikelihood trainer adds device-aware training. It does not modify the original trainers, model architecture, inference, decoder or chain code.

- `--device cpu|mps`, default `cpu`; inputs, attention masks, optional penalty masks and trainable model parameters stay on that device.
- `--trainable all|top2|body`, default `all`. `top2` trains only `model.layers.2` and `model.layers.3` (360,704 parameters). `body` trains all four transformer layers (721,408 parameters). Both modes freeze embeddings, the tied output head and the final norm; `top2` also freezes layers 0–1.
- `--unlikelihood-alpha 0` uses ordinary cross-entropy and supports the original BPE tokenizer. Nonzero unlikelihood requires the existing WordLevel tokenizer and its explicit word exemptions.
- Validation always uses plain cross-entropy. Every new validation minimum, requested periodic checkpoint and final checkpoint is saved.
- A fresh AdamW optimizer starts each run; optimizer state is not resumed. Reports identify the source checkpoint, device, batch size and tuning mode.
- Checkpointing and free generation use a new FP32 CPU model copy. The active model and optimizer tensors are never moved back and forth between devices.
- Parameter bounds are enforced on device, with counts transferred to the host only for logging/checkpoints. This leaves the Q12 architecture and export bounds unchanged.

## Smoke verification

`smoke-verification.json` records the successful two-step MPS run from the original BPE model and teacher cache, batch 128 and top-two-layer tuning. It processed 20,164 supervised targets, preserved all 20 frozen tensors exactly, changed only the 18 tensors in layers 2–3 and saved all 38 tensors as FP32. No parameter clipping occurred. The final checkpoint at step 2 was also the new plain-CE validation minimum.

The smoke verifies execution and checkpoint mechanics only. Two updates, tiny validation blocks and eight-token probes cannot establish language quality, training speed over a full run, or on-chain gas. No full training run or blockchain operation was launched by this test.

On this host, MPS is visible in the authorized unsandboxed runtime; the restricted runtime reports it unavailable.

`verify_frozen.py --source SOURCE --candidate CANDIDATE --trainable body --output REPORT.json` reads both checkpoint files without modifying them and checks exact equality for every frozen tensor, key coverage, shapes and dtypes. It reports which permitted tensors changed. A passing equality report is not a language-quality test.
