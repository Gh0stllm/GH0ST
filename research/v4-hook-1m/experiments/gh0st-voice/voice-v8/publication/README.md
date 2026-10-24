# V7/V8 local research publication snapshot

This snapshot contains source, curriculum, encoded training data, and completed
reports for the V7/V8 experiments. V7 failures are retained as evidence; none of
the data counts, conversions, training losses, or gas reports alone establishes
usable language quality. The offline compositional curriculum is synthetic
training material. The runtime remains neural word and punctuation generation.

Active training-run folders, unfinished reports, cached files, random fixtures,
optimizers, old number-parser revisions, and all unselected checkpoint weights
are excluded. No files are deleted from the repository by this snapshot.
Selected float/runtime weights are included only when explicitly passed as a
matching checkpoint/export pair. Selection does not imply language approval.

JSONL files and selected large fused binaries are stored as deterministic gzip.
From the repository root, restore them with:

```sh
python3 research/v4-hook-1m/experiments/gh0st-voice/voice-v8/publication/restore.py --root .
```

The restore tool verifies compressed and original hashes and never overwrites
a different existing file. Use the existing research Python environment for
PyTorch/safetensors and the repository's pinned Node/Hardhat/Uniswap dependencies
for local EVM harnesses. Shared harnesses in `tests/evm/` and
`experiments/gh0st-voice/recurrent-v1/evm/` remain repository prerequisites.
V7 data preparation also references previously published V6 source/license
records. This stage does not republish raw upstream books or models.

All work represented here is local research. There are no mainnet actions or
GitHub mutations in the staging script. Exact source selection, exclusions,
hashes, and compression information are recorded in the external stage manifest.
