![GH0ST GL3](assets/gl3-cover.png)

# GH0ST L3 · GL3 research notebook

[Open the full overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md) · [Roadmap](ROADMAP.md)

GL3 now has repeated native GH0ST withdrawal rehearsals and a passing actual native-parent/child flow over an observed token-state clone: 82 parent transactions, seven token storage keys and zero unmatched keys. The unchanged chess engine also completed a decision across two graceful node restarts, and bounded challenge-manager/start-boundary checks passed.

**The combined C candidate now passes native equivalence and a real-engine WASM32 diagnostic.** Native output preserves all four end-state fields, block/state/receipt hashes, **12,306,935 gas** and all 163,085,439 canonical bytes. Under the separately linked diagnostic JIT, the exact real C companion also produces all four expected fields: **2,000.5 MiB Go linear memory**, 711,655,424 bytes of C linear memory, 37.19 seconds guest / 61.08 seconds total. Engine bytes and strength remain unchanged. These are native and diagnostic results, not a proof pass. [Exact combined diagnostic](mainnet/diagnostics/aot-jit/evidence/combined-final/summary.json).

**One four-hour-bounded interpreter replay is RUNNING_NOT_ACCEPTED.** Selected root `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086` started on Runpod at 2026-11-17 00:35:20 UTC, using the exact-counter prover. Actual exit, finished state, four-field match and raw step count remain pending. Raw-counter-plus-one and BoLD kickoff geometry must be reviewed before a new lifecycle starts. [Locked machine](mainnet/production/bounded-restore/scheduling/comparison/C-combined/machine-manifest.json) · [Launch record](mainnet/production/bounded-restore/scheduling/comparison/C-combined/interpreter/process.json).

The selected future dispute fixture now compiles and passes **160 guard regressions normally and under Python optimization**, plus **55 Go named cases**. Its exact-target independent audit handshake is tested; the full lifecycle remains unlaunched. [Selected865 preflight](mainnet/dispute/full-lifecycle/preflight-selected865/README.md).

A real separate-process full-decision test also passes SIGKILL/reopen at **cursors 64 and 2048**, with exact retained canonical state and unchanged `e7e5 / 24,000,033 nodes / depth 38`. This uses synchronous Pebble, archive and save-every-block settings; it does not establish power-loss or production daemon recovery. The [selected native CLI build](mainnet/production/selected-cli/README.md) is separately frozen as a candidate. [Full process recovery](mainnet/production/process-recovery/full-decision/README.md).

The earlier d453 and guarded c03c failures remain historical evidence. The c03c attempt exited 1 after 3,575.36 seconds despite reaching the uncached accessor; its native passes did not accept that guest. [Exact failed replay](mainnet/production/bounded-restore/evidence/guarded-replay-failure/replay-result.json).

The c03c-dependent lifecycle was stopped and frozen as **STOPPED_NOT_ACCEPTED**. Its exact rival claims and 48 edges were captured after 13 real block-bisection levels, with **zero** accepted one-step events, target confirmations or collateral refunds. [Stopped audit](mainnet/dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json). It has not been restarted. **Robinhood mainnet is not deployed.** All builds, engine work, diagnostics and tests run on Runpod; only the temporary 128 GB worker remains at USD 1.04/hour compute plus disk.

The separate [checkpoint study](mainnet/storage/checkpoint-study/README.md) restored an authenticated **preterminal** image offline: roughly 146 MB of standalone genesis differences versus 1.619 GB of delta code, with every decoded byte preserved. It implements no STF cleanup and establishes no production or 20-game capacity.

A separate [checkpoint prototype](mainnet/storage/checkpoint-prototype/README.md) passed 53 codec/emulator/harness tests on Runpod. Actual native integration is separate work; this establishes neither production storage nor 20-game capacity.

[Native repair evidence and exact artifact identities](mainnet/production/bounded-restore/README.md)

[New: acceptance guard evidence](mainnet/dispute/full-lifecycle/controller-tests/README.md) · [Stopped live audit](mainnet/dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json) · [Parallel results and exact boundaries](mainnet/PARALLEL-ACCEPTANCE.md)

| Notebook | Read for |
| --- | --- |
| [History](HISTORY.md) | Sequential decisions, failures and receipt-backed milestones |
| [Linux acceptance](mainnet/README.md) | Passed checks, failed replay and unresolved launch gates |
| [Release packet](mainnet/release/README.md) | Candidate artifact locks, hosting observations and operator decisions |
| [Findings](FINDINGS.md) | Measured resources, scope and unresolved questions |
| [Roadmap](ROADMAP.md) | Achieved work and next testable gates |
| [Machine-readable status](status.json) | Current workload and verified deployment boundaries |
| [Append-only journal](journal.jsonl) | Ordered research events linked to evidence |
| [Chess memory study](../chess/l3/core/hosting/chess-workload-20261116/README.md) | Original full-network, 24m-node and retained-state measurements |

[Active full chess integration](chess/README.md) · [Hosting study](chess/HOSTING.md) · [Chess across fast blocks](chess/sliced/README.md)
