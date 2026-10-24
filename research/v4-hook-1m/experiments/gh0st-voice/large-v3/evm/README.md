# Large-v3: isolated local Uniswap v4 verification

This adapter is prepared for a new checkpoint. **No result is implied by the
presence of these files.** Run only after the training selection is complete,
the checkpoint is frozen, and its exact-Q12 free-generation report is reviewed.
The previous pilot and published research artifacts remain separate.

The default test executes 128 actual swaps against a fresh, unforked local
Uniswap v4 PoolManager. It checks token IDs, all 4,019-logit hashes, terminal flags,
context counters, emitted events, token settlement, and the 64-position attention
window against the independent Python reference. It also checks stale revisions,
forged contexts, malformed hook data, unauthorized callbacks, insufficient gas,
post-inference rollback, altered model/history code, and caller/pool isolation.

Both the copied hook and exported model reject construction outside chain 31337.
The runner uses only loopback, creates its own local Anvil, verifies its chain ID
and implementation before mutations, and stops it on completion or failure. It
accepts no RPC URL, key, fork, or public-broadcast option.

## Checkpoint export

From the research directory, with a final selected local checkpoint:

```sh
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/export/quantize_eval.py \
  --checkpoint PATH_TO_SELECTED_CHECKPOINT \
  --out experiments/gh0st-voice/large-v3/export/selected \
  --seeds 42,0,1,2,3,4,5,6,7,8 --tokens 150
```

The exporter is unchanged and shared with the earlier independent tests. A
complete output must include the Q12 comparison report, unchanged tokenizer,
signed12 matrix audit, observed signed17 activation audit, packed weights,
executable tiles, Relative64 tables, and patched local-only model source. A
150-token seed42 run covers the default 128 swaps. Export into a fresh directory
for each checkpoint so a long run cannot observe changing weights.

## Local benchmark after checkpoint approval

```sh
node experiments/gh0st-voice/large-v3/evm/run-local.mjs \
  --export-dir=../export/selected --turns=128 --port=18630 \
  --label=gh0st-voice-v3
```

Paths passed to `--export-dir` resolve relative to this adapter directory. The
compiler's project root is four levels above this deeper adapter, which keeps
imports pointing at the original research dependencies without moving them.

The transaction and local block limits are 32,000,000 gas. The inference call
budget remains 29,250,000 gas. Every successful swap must use strictly less than
32M gas. A run of at least 64 swaps must exercise the full attention window.
Model weights and executable tiles are installed only into the local node after
hash verification, so their deployment costs are excluded. These tests measure
execution gas units, not network fees or public deployment cost.

Numerical parity and gas fit do not establish good prose, 10,000 distinct
sentences, or readiness for mainnet. Save both the complete transcript and the
full result JSON, including failures, when judging the new model.
