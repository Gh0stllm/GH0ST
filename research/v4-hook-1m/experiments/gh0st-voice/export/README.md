# GH0ST voice: local integer export and comparison

`quantize_eval.py` accepts a locally fine-tuned Hugging Face checkpoint, preserving
the existing SimpleStories V2 architecture and tokenizer. It performs no network
or chain calls and never clips weights during export.

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/export/quantize_eval.py \
  --checkpoint experiments/gh0st-voice/runs/NAME/checkpoint-best \
  --out experiments/gh0st-voice/export/NAME
```

By default this compares ten seeds, 150 generated tokens per seed, against the
original checkpoint with the same integer sampler, initial quote token, 64-token
rolling attention window, and two-token-then-one-token swap policy. The script
retains generated tokens across every turn, including sentence boundaries and
EOS. It does not insert punctuation or reset the story.

Outputs:

- `quantization-report.json`: exact source and exported hashes, rounding error,
  changed parameter count, architecture/tokenizer checks, and signed12 matrix
  bounds required by the existing SWAR8 fast path.
- `model/weights.bin`: original tensor order, big-endian int16 Q12 (2,471,936 bytes).
- `model/tables-relative64.bin`: the same deterministic 64-position tables.
- `q12-continuity-comparison.json` and `q12-transcripts.txt`: original and tuned
  text, every generated token, per-turn chunks, full-logit hashes, and observed
  signed17 activation bounds.
- `packed-swar8/`: lossless packed weights and offsets when every matrix weight
  meets the original signed12 bound.
- `codeweights/`: lossless executable matrix tiles and their code commitment.
- `evm/GH0STVoiceRelative64Model.sol` and `evm/model-manifest.json`: a separately
  named model with the tuned commitments and tile routing. Its constructor
  explicitly rejects chain IDs other than 31337. The manifest includes each
  injected runtime hash for an isolated local EVM test.
- `evm-artifact-report.json`: artifact status, clearly separate from an EVM test.

The integer forward pass is independently implemented in this file. With the
initial quote prompt and seed 42, every generated token and every full 4019-logit
hash is checked against the frozen published baseline. The self-test in
`baseline-self-test/` used 150 tokens, passed this equality check, and reproduced
all 282 frozen executable weight tiles byte-for-byte.

Successful export does **not** establish gas use for new weights. The resulting
checkpoint still needs local EVM parity, safety/rollback checks, and whole-swap
gas measurement. A few hundred sampled tokens do not establish 10,000 distinct,
coherent sentences or reliable long-range narrative continuity.
