# GL3 · parallel acceptance results

[Acceptance notebook](README.md) · [Sequential history](../HISTORY.md) · [Roadmap](../ROADMAP.md) · [Release packet](release/README.md)

**R37: native A15 checkpoint/full 24m cold continuation and selected 865 initialization checks pass. The terminal interpreter is RUNNING_NOT_ACCEPTED, and its old 2^40 geometry is definitely too small.** Historical d453/c03c failures and the dependent STOPPED_NOT_ACCEPTED lifecycle remain preserved. Robinhood mainnet is undeployed. All execution runs on Runpod.

| Lane | Verified result | Boundary |
| --- | --- | --- |
| Native GH0ST withdrawal | Two adapted-fork native-child flows; separate genuine Nitro-parent observed-state flow,82 transactions/7 keys/0 unmatched | Private sparse clone, privileged confirmation, no complete canonical ledger/custom-STF acceptance |
| Native restart | Graceful lifecycle and separate-process full decision across SIGKILL 64 / 2048; exact canonical bytes | Private synchronousPebble/archive/save-every-block; production CLI/power-loss recovery separate |
| Native mint/ELF | Ten strict execution rejections; original network and non-executable stack | Owner powers and production pairing remain open |
| Native restoration repair | Exact four fields, block/state/receipt hashes and 12,306,935 gas; all 163,085,439 canonical bytes | Native only; does not accept guest |
| Combined C real-engine diagnostic | Exact four fields, exit 0; Go 2,000.5 MiB / C 711,655,424 bytes; 37.19 s guest / 61.08 s total | Exact unchanged C companion and original input; diagnostic host execution, not interpreter/OSP or whole-search replay |
| Combined C bounded interpreter | Saved raw sample ≥ 1,146,200,000,000 at 02:35:38 UTC | **RUNNING_NOT_ACCEPTED**; prior 2^40 capacity cannot fit; final H/exit/four fields pending |
| Selected 865 initialization/cap | Backend 0 / 6.62 s; Solidity 0 / 33.97 s; 2 authentic transitions / 14 negatives | Offset 1; synthetic near-cap units; no full terminal/lifecycle/root acceptance |
| Real A15 native checkpoint | 64 pieces / 162,059,912 body bytes; 28 PASS events/actual 0 | Exact completed memory/globals/TT/history; no matching guest or code reclamation |
| A15 cold next full 24m decision | b8c6 / 24,000,311 / depth 39; full canonical unchanged; exit 0 / 229.103 s | All VM caches destroyed; native-only continuation; engine unchanged |
| Retention | Source-backed fixed-page-bank and archive/retention design | Design only; no implementation/pruning/20-game capacity |
| d453 interpreter | Failed exit 1 after 2,153.854 s | Earlier guest heap failure preserved |
| c03c guarded interpreter | Failed exit 1 after 3,575.36 s; 4,227,235,840 guest bytes in use | Accessor reached; 3GiB soft limit insufficient; expected end mismatch |
| Exact-target lifecycle | Captured 48 edges and 13 block-bisection levels to 4920→4921 | Stopped exit −15; zero accepted one-step/target-confirmation/refund |
| Future selected 865 preflight |160 normal / 160 optimized Python guards; 55 Go named cases | Earlier 87 / 72 records preserved; no lifecycle launch/full integration |
| Future Go/auditor preflights | Cloud compile; two real ELF refusals; eight audit boundary units; auxiliary dependency preflight | No engine/proof pass; accepted real one-step-path positive uncompleted |
| Offline checkpoint study | Preterminal image round-trip all bytes; ~146 MB versus 1.619 GB delta code | No final checkpoint/STF cleanup, production or 20-game capacity |

[Guarded failure](production/bounded-restore/evidence/guarded-replay-failure/replay-result.json) · [actual exit](production/bounded-restore/evidence/guarded-replay-failure/exit.json) · [stopped audit](dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json) · [expanded guard evidence](dispute/full-lifecycle/controller-tests/transition-evidence/result.json) · [actual ELF checks](dispute/full-lifecycle/controller-tests/entrypoint-evidence/result.json) · [checkpoint study](storage/checkpoint-study/README.md).

[Final real-C comparison](diagnostics/aot-jit/evidence/combined-final/summary.json) · [selected root/machine/guest](production/bounded-restore/scheduling/comparison/C-combined/machine-manifest.json) · [interpreter launch](production/bounded-restore/scheduling/comparison/C-combined/interpreter/process.json) · [running snapshot](production/bounded-restore/scheduling/comparison/C-combined/interpreter/live-snapshot.json) · [7-step tiny-WASM counter smoke](diagnostics/aot-jit/evidence/counter-cli-smoke/counter-smoke.json).

The checkpoint continuation timing is a direct native-handler benchmark, not mined-block or public move latency.

## Preserved scope and required acceptance

Root preserved the dependent fixture after matching guest failure, then terminated it with actual SIGTERM exit −15 after 3,135.089 s. Its private Geth, main prover and observer were verified gone; all five auditors stopped. The stopped fresh input is 2,574,999,142 bytes, SHA-256 `c419b88eec6e62cffc6afed5c6a38b7bce26e13512ab8ed7982ffb793f781f48`. The failed independent guest used distinct original input `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`. Exact rival claims and native capture remain evidence, not a completed dispute.

A fresh acceptance run must bind the exact honest terminal transition to one-step ancestry, then the exact assertion confirmation and nonzero edge-collateral refund with successful receipts, exact transfer and reconciled balances. Broad pass flags cannot substitute. This refund scope excludes withdrawal of assertion stakes. [Exact stopped identities](README.md#strict-lifecycle-acceptance-and-separate-inputs).

The earlier STOP-based restore diagnostics remain historical, not engine passes. The later full real-C diagnostic selected combined C, Go guest SHA-256 `8d18145460e5f4c649895728fa089a52a04ead2c3fa5e7d10789d72d7de42fbd`, with unchanged companion `b481f92a852a685411db42c8b51abd3a3f2c8cd8c5d0c1c8eed2962d986f5555` and original input `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`. Its native and diagnostic passes do not replace the new interpreter. Selected root is `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`; actual exit is persisted through direct-child `os.wait4` before optional processing. No lifecycle restarts until interpreter completion and reviewed final H/H+1 geometry. The prior 1024^4=2^40 capacity is already insufficient from the saved lower-bound sample; a separate 2^43 variant remains unaccepted/unlaunched. [Overflow](production/bounded-restore/scheduling/comparison/C-combined/interpreter/overflow-observation.json) · [selected boundary](production/selected865-boundary/README.md).

Earlier real-manager 5-witness/35-negative checks and the BoLD start-boundary 1-case/7-negative checks retain fixture boundaries. Earlier withdrawal setup and intrinsic-gas failures, null collection exits and both guest failures remain preserved. Native minting disabled at genesis does not remove delayed owner powers. Immutable delta history requires a reviewed checkpoint/retention design; compaction is not reclamation.

## Current temporary resources

The withdrawal and 32 GB production workers were removed after evidence preservation. Only the temporary 128 GB allocation remains at **USD 1.04/hour compute plus disk**, now running the single bounded C interpreter. No prior failed prover, dependent lifecycle/private parent, observer or auditor from the stopped case is active. Strength remains the original full network/24m nodes/Hash 128 MiB/Threads 1/Skill 20 with retained state. The native A15 checkpoint and full 24m cold continuation now pass separately; inherited cold-work, matching guest, retained history, physical pruning and 20-game capacity remain unaccepted. [Native A15](storage/checkpoint-integration/README.md) · [Retention design only](storage/retention-design/README.md). No public launch or movement of existing mainnet funds occurred.
