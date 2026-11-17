![GH0ST GL3](assets/gl3-cover.png)

# GH0ST L3 · GL3 research notebook

**R53 · Warm proof optimization passes.** The selected same-source native-CPU build proves the fixed sixteen-transfer EVM batch in215.09 seconds, versus360.96 seconds for the warm generic build:40.41% less full-call time and compute allocation. All three fresh proofs pass SDK and actual Solidity verification, including meaningful rejection checks. [Warm results and receipts](zk-batch/warm-optimization/README.md) · [Earlier cold/Nitro comparison](zk-batch/costs/README.md).

**The Nitro base launch remains at its separately tested R44 profile.** Its full private dispute, nonzero stake refund/replay rejection and11-case supervisor regression pass. Native-GH0ST recovery/withdrawal is a separate passed fixture. The user selected project-operated validators; exact custody/collateral, pricing and applicable license inputs remain unresolved. Public GL3 is not deployed, and the ZK benchmark does not yet cover production state/data coordination, withdrawals or Stylus/LLM proofs.

[Base-chain work](base/README.md) · [ZK cost experiment](zk-batch/README.md) · [Sequential history](HISTORY.md)

The prior2.59 TB projection belongs to deferred chess execution history. It is not a base-chain requirement.

<details>
<summary>Preserved R41 and earlier chess research snapshot</summary>

![GH0ST GL3](assets/gl3-cover.png)

# GH0ST L3 · GL3 research notebook

[Open the full overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md) · [Roadmap](ROADMAP.md)

**R41: ordinary source05 binaries and parser checks pass; the corrected candidate03 dispute and separate checkpoint progress replay are RUNNING_NOT_ACCEPTED. The 20-game storage and production gates remain open.**

[Ordinary binaries](mainnet/production/final-pairing/README.md) · [Checkpoint guest experiment](mainnet/storage/full-checkpoint-guest/README.md) · [Sequential R41 history](HISTORY.md#41--build-ordinary-operator-binaries-and-isolate-a-checkpoint-guest--17-november)

The R40 paragraphs below preserve that milestone’s scoped results. R41 adds builds and the isolated checkpoint experiment; it grants no deployment acceptance.

The corrected retry has now captured engine block **4905 / batch2438 / position0**, found **one exact target pair**, and started one retained interpreter execution. The [saved live observation](mainnet/dispute/host-cache-lifecycle/evidence/retry-current-observation.json) remains **RUNNING_NOT_ACCEPTED**.

The fixed candidate passes **24 top-level tests plus 25 subtests in each normal and Go race suite**. Actual one-minute renewal passes in **60.056 s** under a **300 s server TTL**; transport-first shutdown fallback passes normally and under race detection and is recovered by server idle expiry. The final fixture compiles in **21.416 s** and its actual parent getter/binding check exits 0 in **0.465 s**. These are scoped host and configuration passes, not a completed dispute. [Candidate03 evidence](mainnet/dispute/host-cache-integration/CANDIDATE-03.md).

Root reviewed and authorized only the private selected865 hierarchy `[8192,2048,2048,2048,1024]`, capacity `2^43`. Run `ed10d2cef02a471d9684dd390697c10c` is **STOPPED_NOT_ACCEPTED**, with actual **SIGTERM / exit −15 / 1,240.012 s** and all owned processes gone. Its unchanged native decision and capture pass: **e7e5 / 24,000,033 nodes / depth 38**, exact canonical state and engine block **4921**. The assertion ended at **batch 2470, position 0**, beyond the captured engine target at **batch 2469, position 2**. The strict auditor correctly found **zero exact target pairs**; no proof, target confirmation or edge-collateral refund is accepted. The corrected fixture changes only test batch sealing while preserving the auditor, engine, selected machine and cache. The corrected small seal profile now passes with actual **exit 0 / 11.1576956 s**: six useful messages stay held across multiple polls; batch 2 ends at message count 10 / terminal index 9; captured validation input matches the last transaction block at **batch 3, position 0**. A later posting-report block advances the child head to 10 while batch count stays 3 after 2.5 s. No engine runs. The initial missing-stateless-validator setup failure is preserved separately. Controller kit3 compiles with **exit 0 / 13.748695 s**. Its subsequent reviewed/authorized retry is recorded below; starting it grants no lifecycle acceptance. [Stopped receipt](mainnet/dispute/host-cache-lifecycle/evidence/stopped-ed10/root-stop-reason.json).

The corrected full retry **c1af59a6b57f48d3a268f8b4ec6ee2a4** is now **RUNNING_NOT_ACCEPTED**, with controller **191134** and named test **191190**. Root issued new content-bound private authorization after reviewing the corrected kit3 composition; the new ELF parent getter/binding check passes with **exit 0 / 0.4585583 s**. The eleven host-cache/auditor source files remain candidate03; only the test terminal fixture and batch helper differ. The strict auditor must still establish the exact terminal target, authentic one-step ancestry, honest assertion confirmation and nonzero collateral refund with receipts and reconciled balances. No full lifecycle pass or production authority follows from this launch.

The storage probe authenticates one completed decision, including full TT/history, but measures **1,618,883,770 new unique code bytes**, all still referenced. At that measured rate, **20 × 80 decisions project 2,590,479,821,224 code bytes before overhead**, so neither 512 GB nor 1 TB is accepted. This is planning arithmetic, not 1,600 searches. The canonical probe passed; the stricter metadata gate failed on the existing empty Pebble `LOCK` mtime and is preserved. A separate native bank prototype passes **6 top-level tests / 3 subtests** with **four pages across 20 allocator epochs**, retaining historical versions. It does not accept a complete VM, 20 games, a guest or a selected865 layout change. [Storage gate](mainnet/storage/twenty-game-capacity/README.md) · [Bounded bank prototype](mainnet/storage/fixed-bank-retention/README.md).

The production operator04 opt-in hook passes **7 top-level tests / 22 subtests in each normal and race suite**. Review found an RPC Start-failure transport-cleanup gap in source04. Source05 fixes it and passes **10 top-level tests / 24 subtests in each normal and race suite**, including actual loopback failed-handshake coverage. Ordinary activated-client build/genesis pairing remains pending; these focused tests do not accept complete chain startup or production. [Production pairing work](mainnet/production/final-pairing/README.md).

[Cache integration evidence](mainnet/dispute/host-cache-integration/README.md) · [Canonical input identity](mainnet/dispute/host-cache-identity/README.md).

**Completed R38 reference:** selected865 replay of one original captured terminal block is Finished with all four fields exact; eight inherited witness checks pass in fixture context. These earlier passes remain narrower than complete lifecycle acceptance; the stopped R40 experiment is recorded separately above.

The actual replay exits **0 / 9,011.040 seconds**, with raw **H = 1,444,459,006,817** and wrapped **F = H + 1 = 1,444,459,006,818 < 2^43**. Exact kernel maximum RSS is **25,492,628 KiB**. This uses the **original d453 capture context with candidate 865**, not every block of a complete 24m-node search or an accepted deployed-parent/production pairing. The complete 107,573,150-byte proof has a recorded SHA-256; the original run is unchanged. [Completed reference](mainnet/production/bounded-restore/scheduling/comparison/C-combined/interpreter/replay-result.json) · [actual exit](mainnet/production/bounded-restore/scheduling/comparison/C-combined/interpreter/exit.json).

The independent Solidity regression verifies **eight authentic witnesses / 56 strict negatives** under `[8192,2048,2048,2048,1024]`. Canonical Finished/global hashing equals the actual CLI end hash and pinned OSP result; the absorbing Finished witness verifies at F. The last sampled Running instruction is **59,006,817 steps before H**, not H−1. Ancestors/history/configuration are fixtures, so full assertion/bisection/confirmation/refund acceptance remains open. [Witness evidence](mainnet/dispute/selected865-steps/README.md).

The ordinary CLI passes a private cursor 64 **SIGKILL → restart → real advance to 65** with exact persisted state and the same physical databases. It is an acknowledged-head synchronous-Pebble/archive profile, not power-loss, arbitrary mid-write or full-decision acceptance. Separate geometry 43 compilation/configuration checks pass **173 normal / 173 optimized guards and 55 Go named cases**. The old 2^40 geometry stays rejected; final source/geometry review and root authorization cover only the R40 private experiment; production remains unapproved. [CLI recovery](mainnet/production/cli-recovery/README.md) · [geometry43 preflight](mainnet/dispute/full-lifecycle/geometry-2pow43/README.md).

**Guarded full-size transport now passes.** V3 exits 0 in 66.714 s, with 43.866 s for upload/initialization/close and 23,615,612 KiB maximum RSS. The actual 2,569,360,144-byte request fits the explicit 3 GiB cap; 402,818 preimages / 1,911,582,985 decoded bytes and canonical typed identity match. A real run registers, wrapped 0 is observed and close succeeds. Positive steps are prohibited and none are requested: this is no completed cache, replay or lifecycle result. Wire SHA remains separate from canonical identity; v1/v2 failures are preserved. [Transport v3](mainnet/dispute/full-lifecycle/large-input-preflight/README.md).

**Bounded host-cache correctness is accepted for the private experiment.** Candidate03 passes the scoped normal/race, health, admission and cleanup tests. Authentic tiny-machine memo reuse adds zero steps, and the unchanged native/cache prefix matches original selected865 hashes through raw 200M. Complete selected-engine repeated-work cost, memory and the full proof/confirmation/refund lifecycle remain unaccepted without an exact-target completed lifecycle and its receipts; the first R40 run is stopped without acceptance.

The native A15 checkpoint and unchanged cold full 24m continuation remain native-only passes. Historical d453/c03c failures and the stopped 48-edge trial remain preserved. A small native fixed-bank allocator now passes its bounded tests; production retention/storage, 20 games and an all-in USD 100/month host remain unaccepted. All builds, engine work and tests run on Runpod with unchanged strength. No public deployment, license acceptance or mainnet fund movement follows. [Native checkpoint](mainnet/storage/checkpoint-integration/README.md) · [parallel scope](mainnet/PARALLEL-ACCEPTANCE.md) · [retention design](mainnet/storage/retention-design/README.md).

| Notebook | Read for |
| --- | --- |
| [History](HISTORY.md) | Sequential decisions, failures and receipt-backed milestones |
| [Linux acceptance](mainnet/README.md) | Passed checks and unresolved launch gates |
| [Release packet](mainnet/release/README.md) | Candidate locks, hosting observations and operator decisions |
| [Findings](FINDINGS.md) | Measured resources and scope |
| [Roadmap](ROADMAP.md) | Achieved work and next testable gates |
| [Machine-readable status](status.json) | Current workload and deployment boundaries |
| [Append-only journal](journal.jsonl) | Ordered research events linked to evidence |

![GH0ST GL3 build update](assets/gl3-build-update-20261117.png)

*Creative build-update artwork; not execution proof. [Prompt/provenance](assets/gl3-build-update-20261117.prompt.txt).*

[Active full chess integration](chess/README.md) · [Hosting study](chess/HOSTING.md) · [Chess across fast blocks](chess/sliced/README.md)


</details>
