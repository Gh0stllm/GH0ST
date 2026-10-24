# Local tuned-voice v4 verification

This adapter tests a tuned GH0ST checkpoint with the existing Relative64 model architecture and a real local Uniswap v4 PoolManager. It does not contain a public RPC URL, wallet key, fork option, or public broadcast option. The copied hook requires chain ID 31337. Before every local state mutation, the runner checks both chain ID and Anvil identity.

## Inputs

Point `--export-dir` at one complete output from `../export/quantize_eval.py` that also contains the model patched by the exporter:

- `quantization-report.json`
- `q12-continuity-comparison.json`, with the independently calculated tuned seed-42 stream and full-logit hashes
- `packed-swar8/manifest.json` and `weights.bin`
- `codeweights/tile-manifest.json` and tile binaries
- `model/tables-relative64.bin`
- `evm/GH0STVoiceRelative64Model.sol`

The generated contract must keep the constructor `(address[] weights, address[] tables, address[] tiles, uint16 promptToken)` and existing Relative64 interface. The model's data and code commitments must be updated to the tuned exports. Executable tile ranges must match the generated binaries. The runner independently verifies binary hashes, tile commitment, unchanged numerical table, tensor bounds reported by the reference, and the reference's sampler configuration.

## Run

From the research directory:

```sh
node experiments/gh0st-voice/evm/run-local.mjs --export-dir=../export/selected --turns=80 --port=18610 --label=gh0st-voice-smoke
```

`--export-dir` is resolved relative to this directory. The runner starts its own unforked local Anvil, then always stops it on exit. Its block and transaction cap is 32,000,000 gas. The hook forwards at most 29,250,000 gas to inference. Local blocks have zero artificial fees; gas units are not live network prices.

## Evidence

Every successful swap must match the independent tuned Q12 reference on token IDs, terminal flags, all 4,019 final logits, and processed positions. Preview must match the committed execution. Token balances must change through actual PoolManager settlement. At least 80 swaps normally reaches and passes the 64-position attention window.

The runner also checks stale revision/context rejection, malformed input, unauthorized callbacks, low gas, post-inference rollback, changed model/runtime rejection, history tampering, and isolation between callers and pools.

Model weight, table, and executable tile code are installed into the isolated chain after hash verification to save setup time. Model, hook, PoolManager, router, test tokens, context chunks, and every swap execute normally. This measures swap execution gas; it does not measure the cost of deploying all data contracts to a public chain.

The adapter is derived from the frozen Relative64 benchmark, with outputs and compilation caches kept here. It does not modify the published model or reports. Successful gas and parity checks do not establish good language quality, 10,000 distinct sentences, or readiness to deploy.
