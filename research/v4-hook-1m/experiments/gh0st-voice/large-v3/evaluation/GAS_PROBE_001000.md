# Unselected checkpoint 1,000: local gas/parity result

The large-corpus checkpoint at step 1,000 completes the unchanged Relative64 hook path below the 32M gas cap. This is a technical probe, not selection of the checkpoint or approval of its language quality.

- **128/128 actual local PoolManager swaps passed**, producing 141 tokens with no context reset.
- Every swap matched the independent tuned Q12 reference on token IDs, terminal flags, and the complete final 4,019-logit hash.
- Whole-swap gas: **13,323,188–28,420,946**. The worst observed swap leaves **3,579,054 gas** below 32M.
- The 64-position attention window was reached at swap 51. The 78 full-window swaps used **28,214,535–28,420,946** gas.
- Invalid/stale data, unauthorized callback, insufficient gas, forced rollback, model/history tampering, caller isolation, and pool isolation checks passed.

The model keeps all 1,235,968 parameters and the original vocabulary. New weights require **283 executable tiles**, with the source's tile routing regenerated to match. All 545 data/table/tile runtimes were hash-checked before being installed on the isolated node. Data-contract deployment costs are excluded from these execution measurements.

The model, hook, PoolManager, router, context chunks, and swap settlement executed on a fresh unforked Anvil chain **31337**, bound only to loopback. No public-chain transaction was sent. The local node was stopped after the test.

Language remains unapproved. The exact on-chain-parity transcript includes malformed constructions such as “the door deserve a place for a place” and “i have a very look in my screen.” A gas result does not repair these failures.

Evidence:

- `../evm/large-corpus-probe-local.json`
- `../evm/large-corpus-probe-transcript.txt`
- `gas-probe-001000-independent-check.json`
- `../export/gas-probe-001000/quantization-report.json`
- `../export/gas-probe-001000/q12-continuity-comparison.json`

Checkpoint SHA-256: `53d7a1ca2d519e45345359b10cae5882ce4f49d55740f067c76f2da30e6db05c`.

Main report SHA-256: `f4746be0796d70d7bfa51ccba255fb75232a11676fe329266b08803162c3e91d`.

Independent Q12 reference SHA-256: `9d2e1298726063d9f276a80d3d55c14139f220404034fff9ffd207f7deeb8a18`.
