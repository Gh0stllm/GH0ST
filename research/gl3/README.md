![GH0ST GL3](assets/gl3-cover.png)

# GH0ST L3 · GL3 research notebook

[Open the full overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md) · [Roadmap](ROADMAP.md)

GL3 now has repeated native GH0ST withdrawal rehearsals and a passing actual native-parent/child flow over an observed token-state clone: 82 parent transactions, seven token storage keys and zero unmatched keys. The unchanged chess engine also completed a decision across two graceful node restarts, and bounded challenge-manager/start-boundary checks passed.

**The historical-code retention repair now passes native acceptance.** The original terminal input produces the same four end-state fields, block/state/receipt hashes and 12,306,935 gas; all 163,085,439 canonical engine bytes remain identical. Optional code-accessor, witness, recorder, journaling and corruption checks also pass. The original d453 guest heap failure remains preserved.

The new guarded proof machine is running its independent terminal interpreter replay; it is **not yet accepted**. A separate complete BoLD lifecycle candidate has compiled and is running on the same Runpod worker and remains unaccepted. Full proof, production recovery/storage and operator configuration gates remain open. **Robinhood mainnet is not deployed.** All builds, engine work and tests run on Runpod.

[Native repair evidence and exact artifact identities](mainnet/production/bounded-restore/README.md)

[New: parallel acceptance results and exact boundaries](mainnet/PARALLEL-ACCEPTANCE.md)

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
