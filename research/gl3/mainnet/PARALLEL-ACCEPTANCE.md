# GL3 · parallel acceptance results

[Acceptance notebook](README.md) · [Sequential history](../HISTORY.md) · [Roadmap](../ROADMAP.md) · [Release packet](release/README.md)

**Both late-state guest candidates failed; the dependent lifecycle is STOPPED_NOT_ACCEPTED.** Native flow/recovery/byte-parity and narrow guard checks remain valid within their stated scopes. Robinhood mainnet is undeployed. All execution ran on Runpod.

| Lane | Verified result | Boundary |
| --- | --- | --- |
| Native GH0ST withdrawal | Two adapted-fork native-child flows; separate genuine Nitro-parent observed-state flow,82 transactions/7 keys/0 unmatched | Private sparse clone, privileged confirmation, no complete canonical ledger/custom-STF acceptance |
| Native restart | Full unchanged decision across graceful restarts64/2048; exact canonical bytes | Same-process lifecycle, not crash/daemon recovery |
| Native mint/ELF | Ten strict execution rejections; original network and non-executable stack | Owner powers and production pairing remain open |
| Native restoration repair | Exact four fields, block/state/receipt hashes and 12,306,935 gas; all 163,085,439 canonical bytes | Native only; does not accept guest |
| d453 interpreter | Failed exit 1 after 2,153.854s | Earlier guest heap failure preserved |
| c03c guarded interpreter | Failed exit 1 after 3,575.36s;4,227,235,840 guest bytes in use | Accessor reached;3GiB soft limit insufficient; expected end mismatch |
| Exact-target lifecycle | Captured48 edges and 13 block-bisection levels to 4920→4921 | Stopped exit −15; zero accepted one-step/target-confirmation/refund |
| Future controller guards | Syntax;87 normal and 87 optimized pure regressions | Earlier72 records preserved; not full future integration |
| Future Go/auditor preflights | Cloud compile;two real ELF refusals;eight audit boundary units;auxiliary dependency preflight | No engine/proof pass; accepted real one-step-path positive uncompleted |
| Offline checkpoint study | Preterminal image round-trip all bytes;~146 MB versus1.619 GB delta code | No final checkpoint/STF cleanup, production or 20-game capacity |

[Guarded failure](production/bounded-restore/evidence/guarded-replay-failure/replay-result.json) · [actual exit](production/bounded-restore/evidence/guarded-replay-failure/exit.json) · [stopped audit](dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json) · [expanded guard evidence](dispute/full-lifecycle/controller-tests/transition-evidence/result.json) · [actual ELF checks](dispute/full-lifecycle/controller-tests/entrypoint-evidence/result.json) · [checkpoint study](storage/checkpoint-study/README.md).

## Preserved scope and required acceptance

Root preserved the dependent fixture after matching guest failure, then terminated it with actual SIGTERM exit −15 after 3,135.089s. Its private Geth, main prover and observer were verified gone; all five auditors stopped. The stopped fresh input is 2,574,999,142 bytes, SHA-256 `c419b88eec6e62cffc6afed5c6a38b7bce26e13512ab8ed7982ffb793f781f48`. The failed independent guest used distinct original input `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`. Exact rival claims and native capture remain evidence, not a completed dispute.

A fresh acceptance run must bind the exact honest terminal transition to one-step ancestry, then the exact assertion confirmation and nonzero edge-collateral refund with successful receipts, exact transfer and reconciled balances. Broad pass flags cannot substitute. This refund scope excludes withdrawal of assertion stakes. [Exact stopped identities](README.md#strict-lifecycle-acceptance-and-separate-inputs).

Fast WASM32 restore/GC diagnostics are investigations. Forced GC every 64 restores reaches the exact historical image root and deliberately stops before engine execution; it is not a full-engine/proof pass. The unchanged-C linking diagnostic is also not a replacement proof. No replacement guest is accepted.

Earlier real-manager5-witness/35-negative checks and the BoLD start-boundary1-case/7-negative checks retain fixture boundaries. Earlier withdrawal setup and intrinsic-gas failures, null collection exits and both guest failures remain preserved. Native minting disabled at genesis does not remove delayed owner powers. Immutable delta history requires a reviewed checkpoint/retention design; compaction is not reclamation.

## Current temporary resources

The withdrawal and32 GB production workers were removed after evidence preservation. Only the temporary 128 GB allocation remains at **USD 1.04/hour compute plus disk**, for diagnostics. No prior prover, dependent lifecycle/private parent, observer or auditor from the stopped case is active. Strength remains the original full network/24m nodes/Hash 128 MiB/Threads 1/Skill 20 with retained state. No public launch or token movement occurred.
