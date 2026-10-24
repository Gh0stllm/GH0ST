# Local reproduction

Run Python commands from `research/v4-hook-1m/experiments/gh0st-voice` with the
project's existing PyTorch/NumPy/safetensors environment. Checkpoints and binary
exports are local development artifacts, not replacement release weights.
Published JSON/text artifacts larger than 50 KB may have a `.gz` suffix.
Decompress those to their original names before reproducing data preparation.
Use a new output directory for each run; the scripts reject overwriting results.

## Narrative inputs

The sources and their license notices are retained in `voice-v10/narrative/`.
`prepare_narrative.py` rebuilds encoded narrative, grammar, and original-voice
rows with the frozen vocabulary. It consumes the existing licensed grammar
replay files referenced in its manifest. `split-audit.json` records the split
checks and their scope. Test rows are not used to choose training checkpoints.

## Export and exact language evaluation

```sh
python voice-v10/export_checkpoint.py \
  --checkpoint voice-v10/runs/narrative-language-2500/checkpoint-001000 \
  --data voice-v10/encoded-narrative \
  --out voice-v10/exports/my-export

python voice-v10/evaluation/audit.py \
  --model-dir voice-v10/exports/my-export \
  --out voice-v10/evaluation/my-audit

python voice-v10/evaluation/training_overlap.py \
  --train voice-v10/encoded-narrative/train.jsonl \
  --raw-output voice-v10/evaluation/my-audit/raw-outputs.json \
  --vocabulary voice-v10/encoded-narrative/vocabulary.json \
  --out voice-v10/evaluation/my-audit/training-overlap.json \
  --prefix-index
```

Read every full stream against the stored rubric. Surface counters and
validation loss are not substitutes for grammar, continuity, and copying
review. The different feature modes use four shared seeds and are not eight
independent language samples.

## Actual local PoolManager smoke test

Run the following Node command from `research/v4-hook-1m` with installed project
dependencies. The harness checks chain ID 31337 and an unforked local network.
It injects model data code locally; it neither estimates deployment cost nor
connects to a public chain.

```sh
node experiments/gh0st-voice/nova-fast-market/evm32/test-text.mjs \
  --source=evm32-round2/model/GRU2PackedModel.sol \
  --hook=evm32-round2/decoder/NovaPackedBatchTextHookTuned.sol \
  --budget=26000000 \
  --export=../voice-v10/exports/broad-language-1000 \
  --swaps=8 \
  --out=evm32-voice-v10/my-smoke
```

Then, from the Python working directory above:

```sh
python voice-v10/evaluation/verify-evm.py \
  --model-dir voice-v10/exports/broad-language-1000 \
  --report nova-fast-market/evm32-voice-v10/my-smoke/text-results.json \
  --out nova-fast-market/evm32-voice-v10/my-smoke/independent-reference.json
```

The replay rejects a checkpoint hash mismatch and checks every measured word,
768-value final hidden state, and state hash. This is a finite integration test,
not a guarantee for all possible future model states or an external audit.
