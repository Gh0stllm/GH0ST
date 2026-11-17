![GH0ST GL3](assets/gl3-cover.png)

# GH0ST L3 · GL3 research notebook

[Open the full overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md) · [Roadmap](ROADMAP.md)

GL3 now has repeated native GH0ST withdrawal rehearsals and a passing actual native-parent/child flow over an observed token-state clone: 82 parent transactions, seven token storage keys and zero unmatched keys. The unchanged chess engine also completed a decision across two graceful node restarts, and bounded challenge-manager/start-boundary checks passed.

**The historical-code retention repair now passes native acceptance.** The original terminal input produces the same four end-state fields, block/state/receipt hashes and 12,306,935 gas; all 163,085,439 canonical engine bytes remain identical. Optional code-accessor, witness, recorder, journaling and corruption checks also pass. The original d453 guest heap failure remains preserved.

The future acceptance controller now passes **87 false-pass guard regressions**, plus the same 87 with Python optimization enabled, and syntax checks on Runpod. These test the controller predicates; its changed Go nonce source now compiles and rejects missing-ID/no-test entry points, while a complete future integration remains unaccepted.

**The guarded replacement also failed independent replay:** actual exit 1 after 3,575.36 seconds, again exhausting the guest address space. The new accessor was used; its native passes do not accept the guest. [Exact failed replay](mainnet/production/bounded-restore/evidence/guarded-replay-failure/replay-result.json).

The dependent lifecycle was stopped and frozen as **STOPPED_NOT_ACCEPTED**. Its exact rival claims and 48 edges were captured after 13 real block-bisection levels, with **zero** accepted one-step events, target confirmations or collateral refunds. [Stopped audit](mainnet/dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json). Fast real-WASM32 restore/GC diagnostics are now being used before another full proof; they are not engine/proof passes. **Robinhood mainnet is not deployed.** All builds, engine work and tests run on Runpod.

The separate [checkpoint study](mainnet/storage/checkpoint-study/README.md) restored an authenticated **preterminal** image offline: roughly 146 MB of standalone genesis differences versus 1.619 GB of delta code, with every decoded byte preserved. It implements no STF cleanup and establishes no production or 20-game capacity.

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
