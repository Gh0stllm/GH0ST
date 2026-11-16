# GL3 · parallel acceptance results

[Acceptance notebook](README.md) · [Sequential history](../HISTORY.md) · [Remaining gates](../ROADMAP.md) · [Release packet](release/README.md)

Parallel work produced verified native withdrawal, recovery and challenge-path evidence while preserving the full engine. All builds and execution ran on Runpod. The native-parent observed-state flow also passed. After the original final-block guest failed, a bounded historical-code repair passed native acceptance; its guarded replacement interpreter replay is now running. The results remain narrower than a mainnet launch or a completed wrong-engine BoLD dispute.

| Lane | Verified result | Boundary still open |
| --- | --- | --- |
| Native GH0ST withdrawal | Two full adapted-fork runs: 4 GH0ST deposit/native credit, 1 GH0ST spend, 0.5 GH0ST burn and exact confirmed parent release; four strict negative cases | Adapted Ganache host, privileged finality and standard client; custom chess-STF pairing remains separate |
| Actual native-parent observed-state parity | Native Geth → Nitro parent 4663 → native child; all 82 parent transactions traced,7 token keys, 0 unmatched; exact native-gas withdrawal | Sparse observed clone, not complete canonical ledger/Merkle proof; privileged genuine-rollup confirmation, no chess proof |
| Native restart | Full unchanged decision through execution/consensus restarts at 64 and 2048, every canonical byte matched; 399.13 s fixture | Same OS process and graceful lifecycle, not crash/power-loss/separate-process daemon recovery |
| Mint controls | Ten strictly classified execution rejections around a short restart, actual exit 0 | Owner retains delayed configuration/upgrade powers; research balances remain artificial |
| Native artifact | Final ELF stack is non-executable and original 98,511,183-byte network matches | Final production client/machine/genesis and wider acceptance remain separate |
| Last-compute capture | Full native decision and 2.575 GB terminal input, actual parent batch 2469 and exit 0 | Independent final-block interpreter replay subsequently failed |
| Last-block interpreter replay | **Failed**, actual exit 1 after 2,153.854s; roughly 4 GB WASM32 guest heap exhausted while restoring historical deltas | Host not OOM, no timeout; expected end state not matched; preserved as the original d453 failure |
| Bounded restoration, native | Accessor/witness/recorder/journaling and 768-delta checks passed; exact terminal fields, header/state/receipt hashes, 12,306,935 gas and 163,085,439 canonical bytes | Native execution only; immutable delta storage remains live |
| Guarded guest replay | Root `0xc03c…16c00` built with guest-only 3 GiB soft limit; original terminal replay running | No completed replay or production acceptance |
| Isolated full lifecycle | Compiled fixture now running the full 24m decision, honest/false claims, actual history/OSP/assertion/refund | Untested; intended checks are not passed checks |
| BoLD start boundary | Real pinned loader/wrapper backend and later Solidity case passed; seven strict negative checks, both actual exits 0 | Wrapper initialization at step 0 / offset 1; fixture ancestor/history context, no engine search or full assertion lifecycle |
| Terminal challenge manager | Five authentic witnesses, 35 strict negative contract checks; correct edge confirmed and rivals excluded | Seeded ancestors/history/config; full bisection, assertion confirmation and stake settlement not established |

[Adapted-fork withdrawal reports](withdrawal/evidence/summary.json) · [native-parent parity](withdrawal/parent-parity/evidence/summary.json) · [failed guest replay](dispute/evidence/terminal-wavm-failure/replay-result.json) · [restart report](production/evidence/sequencer-lifecycle-recovery.json) · [strict mint report](production/evidence/strict-mint-classification-summary.json) · [terminal capture](production/evidence/terminal-input-manifest.json) · [terminal challenge checks](dispute/evidence/terminal-report.json) · [boundary backend](dispute/evidence/boundary-backend.json) · [later boundary Solidity run](dispute/evidence/boundary-solidity-report.json).

## Failures stay part of the evidence

Five withdrawal setup/fixture failures are preserved, including the inert parent ArbSys marker and gas-recipient role overlap. The passing runner uses distinct player/owner/batch-poster roles, strict execution-rejection classification, genuine parent contracts and final native genesis validation.

The restart collector used a missing cgroupv2 path on a cgroupv1 host, so its original exit code is unavailable and its precise sampled fixture peak is not known. The assertion report and Go-PASS log remain the evidence for the graceful restart; the independent terminal capture has a real exit 0. The short strict mint regression separately preserves an intrinsic-gas failure and does not reinterpret broad historical errors as successful policy enforcement.

The boundary backend report is the earlier pre-Solidity output and retains its false Solidity-verification field; the separate subsequent Solidity report establishes that later pass. An additional execution-cache probe remains an unlaunched prototype.

The actual native-parent follow-up separately traces82 committed parent transactions and checks all 7 observed token storage keys against the frozen source or independently confirmed zeros, with0 unmatched keys. Genuine parent ArbSys/ArbGasInfo and both native genesis checks remain intact. The clone and privileged confirmation boundaries remain explicit.

The final d453 guest replay failed during `StateDB.GetCode`/delta restoration after the native capture passed. Its roughly 4 GB guest heap, not 128 GB host capacity, was exhausted. Whole-pod peak 45.69 GB includes prior work. The bounded-restore repair now passes native accessor, witness, recorder, journaling, delta and exact terminal checks. Identical block/state/receipt hashes and consensus gas are preserved, as are all canonical engine bytes. Its new guarded interpreter root is running a fresh terminal replay and is not accepted yet; earlier cold-block passes and the new native passes do not establish that guest result. [Native repair and artifact evidence](production/bounded-restore/README.md).

The cache-only reference root was deliberately not long-replayed. The separate 3 GiB soft guest guard is motivated by the pinned GOGC=1000 native diagnostic, which is not an exact guest measurement; no engine quality or gas formula changes. The full-lifecycle candidate has compiled and is running on the same worker and remains unaccepted.

## Fixed strength and unfinished launch work

The network, 24 million search nodes, Hash 128 MiB, Threads 1, Skill 20, disabled strength limiting and retained per-game state remain fixed. Native metadata hardening leaves the dumped network bytes unchanged. No chess quality reduction or unreviewed production configuration is introduced by these tests.

Released-game immutable delta accounts remain live state; compaction is not reclamation. The old single-decision projection therefore cannot certify 20-game storage. Disabled native minting at genesis also leaves the chain owner's delayed activation/upgrade authority relevant to parent-token backing. Those storage and custody gates remain explicit.

## Current temporary resources

The earlier withdrawal worker has been removed. The native-parent fixture passed and its owned chain processes stopped; the final-block replay process failed and exited. The 32 GB production worker was deleted after completed transfers and idle-process checks, with its task-only transfer key removed first and deletion confirmed by a fresh provider 404. Only the 16-vCPU/128 GB proof allocation remains at **USD 1.04/hour compute plus disk** until cleanup or reassignment. The guarded terminal replay is running and the separate full-lifecycle candidate has compiled and is running on this worker. Native repair passes are recorded separately; no replacement guest or full-dispute pass is claimed.

Robinhood mainnet remains undeployed. Final operator addresses, production genesis, collateral/finality, fee pricing, parent ETH reserve, license path and accepted hosting/retention design are still reviewed through the [launch packet](release/README.md).
