# Portable local runtime fixtures

These files remove the historical benchmark dependency on the unpublished
`mainnet/unsigned-plan.json` and `mainnet/deployed-runtimes.json` files. They are
local test fixtures, not deployment instructions.

`local-runtime-fixtures.json` is a compact manifest containing the original local
addresses, source-file paths, slice offsets, lengths, prefixes, runtime hashes,
and constructor groups. It contains no embedded bytecode, transaction requests,
RPC credentials, wallet settings, or signing path.

`runtime-fixtures.mjs` reads existing published files under
`full-sentence/codeweights/`, verifies their SHA256 hashes, reconstructs the
runtime bytes, verifies every runtime's Keccak hash, and checks constructor order:

- 261 weight data shards, each prefixed with `STOP`.
- One original table data shard, prefixed with `STOP`.
- 282 executable tiles, with their raw code preserved.

The 544 reconstructed byte arrays and all three constructor-address groups match
the original fixtures exactly. `runtime-fixture-parity.json` records the comparison.
The loader itself performs no network requests or writes. Addresses have meaning
only after the guarded test runner installs them on its isolated local chain.

## Reproduce

Run from `research/v4-hook-1m` with the repository's pinned Node dependencies
installed. EVM tests also require Anvil in `PATH`, or an explicit executable path
in `ANVIL_BINARY`.

```sh
node experiments/simplestories-v2/optimization/varied-sentence/portable/runtime-fixtures.test.mjs

node experiments/simplestories-v2/optimization/varied-sentence/benchmark/verify-catalog-portable.mjs \
  --count 1 --port 18597 --label portable-smoke

GH0ST_MODEL_MAX_POSITIONS=64 node \
  experiments/simplestories-v2/optimization/varied-sentence/continuity/test-relative64-portable.mjs
```

The loader test verifies all 544 runtimes and rejects seven malformed manifests:
wrong runtime hash, wrong source hash, duplicate address, invalid slice bounds,
wrong tile prefix, absolute source path, and reordered constructor addresses.

The catalog smoke creates the real model and all 64 numerical prefix caches on
Anvil, then verifies one entry from the final v2 catalog with bounded gas. For
the full catalog, use `--count 10000` and a fresh output label. It writes its own
report and JSONL evidence; historical measured reports are preserved.

The Relative64 portable test uses the final cutoff-26 reference and checks each
generated token and full-logit hash. The default is 150 processed positions;
`GH0ST_MODEL_MAX_POSITIONS` can select 64 through 150. The minimum supports the
inherited counter-relocation control, which requires an already full attention
window. The test also checks stale-context rejection, caller isolation, modified
chunk rejection, and position independence after relocating local counters and
chunk headers. `GH0ST_LOCAL_PORT` changes its default local port 18596.

Both EVM runners start their own unforked loopback Anvil node and require chain
ID 31337. Weight and tile installation uses local `anvil_setCode`; actual model
constructors and inference execute in the EVM. This setup excludes the deployment
cost of all data contracts and does not perform mainnet transactions.

## Provenance

`runners-provenance.json` pins the original measured scripts and describes the
new copies. The originals are unchanged. The portable Relative64 copy uses the
final reference and explicitly asserts its per-turn outputs; this is a new test
run, not a claim that an older report used the new script.

The original benchmark reports retain their original hashes. The new smoke
reports demonstrate that the published-file reconstruction works without the
private deployment-plan files. They do not replace the full catalog verification
or the long PoolManager continuity benchmark.
