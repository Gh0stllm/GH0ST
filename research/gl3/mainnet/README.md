# GL3 · Linux acceptance notebook

[GL3 overview](../README.md) · [Sequential history](../HISTORY.md) · [Roadmap](../ROADMAP.md) · [Release packet](release/README.md)

**R38: selected 865 passes the one-terminal-block reference replay and eight authentic OSP/manager witnesses. Ordinary CLI 64 recovery and geometry 43 preflight also pass. Guarded full-size transport initialization passes; host-cache reuse and final source review are pending; no fresh lifecycle or Robinhood mainnet deployment has started.** Historical failures and stopped-trial snapshots remain unchanged. All execution runs on Runpod.

The checkpoint continuation timing is a direct native-handler benchmark, not mined-block or public move latency.

## Evidence snapshot

| Result | Measurement / evidence | Exact boundary |
| --- | --- | --- |
| Real-GH0ST native withdrawal flow, repeated twice | Deposit 4 GH0ST, spend 1 GH0ST, burn/withdraw 0.5 GH0ST; exact child debit including gas and exact parent recipient/bridge changes | Actual native official Nitro child on an adapted Ganache fork; privileged genuine-rollup confirmation; not actual Robinhood-parent semantics or custom chess-STF acceptance |
| Actual native-parent GH0ST observed-state parity | Geth → native Nitro parent 4663 → native Nitro child; 4 GH0ST deposit, 1spend, 0.5burn/release; 82 parent transactions traced, 7 storage keys, 0 unmatched | Observed sparse clone, not complete canonical ledger or Merkle-proof reconstruction; privileged genuine Rollup confirmation; no chess-STF or permissionless-finality claim |
| Graceful execution/consensus recovery | Full decision completed in 399.13 s with restarts at cursors 64 and 2048; complete 163,085,439-byte canonical state matched | Same OS process and Pebble database; not a daemon crash, power loss or separate-process production reboot |
| Strict native-mint rejection regression | Ten classified execution rejections before/after a short restart; actual exit 0 | Eight EVM reverts and two exact pinned access-control errors; transport/deadline/internal errors cannot count as passes |
| Native artifact hardening | Original 98,511,183-byte NNUE unchanged; final ELF GNU_STACK=RW | Metadata repair; production artifact/genesis acceptance remains separate |
| Complete terminal decision capture | Full 24m decision, actual terminal compute receipt and parent batch 2469; input 2,574,999,906 bytes, recorded exit 0 | Native capture passed; independent terminal-block interpreter replay subsequently failed |
| Original d453 last-block interpreter replay | **Failed** after 2,153.854 s, actual exit 1; historical delta restoration exhausted the guest heap | Preserved historical failure; no host OOM or timeout |
| Bounded historical-code repair, native | Accessor/witness/recorder/journaling and 768-delta checks pass; all four terminal fields, identical hashes and 12,306,935 gas; exact 163,085,439 canonical bytes | Native acceptance only; not a completed interpreter replay or full dispute |
| Selected combined C, real-C WASM32 diagnostic | Actual exit 0; exact four fields; Go peak 2,000.5 MiB / C 711,655,424 bytes; 37.19 s guest / 61.08 s total | Same sealed engine companion/input; native header/gas/canonical and seed checks pass; diagnostic host execution, not interpreter/OSP or whole-move proof |
| Selected 865 terminal reference | Exit 0 / 9,011.040 s; Finished/all 4 exact; H 1,444,459,006,817/F 1,444,459,006,818; max RSS 25,492,628 KiB | One original d453-capture terminal block under candidate 865; not all 24m blocks or deployed-parent acceptance |
| Selected 865 kickoff/cap checks | Backend exit 0 / 6.62 s; Solidity exit 0 / 33.97 s; 2 authentic initialization transitions / 14 negatives | Offset 1 and synthetic near-cap behavior only; not terminal replay, root authorization or full dispute |
| Isolated native A15 checkpoint | 2,464 links → 64 pieces / 162,059,912 body bytes; 28 PASS events, actual 0 / 31.878 s | Full 466,157,568-byte completed image retained; only Head/Deltas switched; no guest/pruning/production acceptance |
| Native cold continuation after checkpoint | b8c6 / 24,000,311 / depth 39; entire 163,085,439-byte canonical matches; actual 0 / 229.103 s | All VM caches destroyed; unchanged engine; native-only next-decision acceptance |
| Selected 865 authentic terminal witnesses |8 authentic witnesses/56 negatives; exit 0 / 49.858 s; canonical Finished==CLI==OSP | Seeded ancestor/history/config fixtures; no full lifecycle or natural H−1 claim |
| Ordinary CLI 64 crash recovery | Actual SIGKILL/restart; exact persisted state; successful advance to 65; exit 0 / 24.865 s | Same-host acknowledged-head sync/archive profile; no power-loss/mid-write/full-decision acceptance |
| Guarded transport v3 | Exit 0 / 66.714 s; 2,569,360,144-byte request below 3 GiB; exact typed input; run/wrapped 0/close | No positive steps, completed cache, replay or lifecycle acceptance |
| Guarded c03c interpreter | Actual exit 1 after 3,575.36 s; guest allocation OOM; expected end mismatch | Failed, not accepted; native all-four/header/canonical passes remain separate |
| Stopped exact-target lifecycle | 48 edges; exact claims/input; 13 block-bisection levels to 4920→4921 | STOPPED_NOT_ACCEPTED, fixture exit −15; zero accepted OSP/confirmation/refund |
| Geometry 43 controller/config preflight |173 normal/173 optimized guards; 55 Go cases; actual private contract/root readback | Final source/transport/cache review and authorization false; no lifecycle |
| Inherited challenge-manager terminal proof path | Five authentic witnesses; 35 strict negative contract checks reject | Fixture ancestors, history siblings and predecessor config; not complete assertion creation, bisection, stake settlement or assertion confirmation |
| Real BoLD start boundary | Pinned Go backend at step 0 / offset 1; one subsequent inherited-manager/OSP case and seven strict negative checks; both actual exits 0 | Finished-to-running wrapper initialization only, with fixture context; no engine search or full dispute |
| Two consecutive initial lazy-machine block replays | All four expected fields matched; five actual Solidity witness checks per block | Captured initial/progress blocks; not every computing transaction in a complete move |
| Earlier actual mixed-traffic full decision | 2,464 compute operations and 2,464 ordinary transfers; ordinary confirmations 141.60 ms median / 160.91 ms p95 | Private native parent/child test under 100 ms target; receipt latency, not a public block-time or inference SLA |
| Earlier separate-process disk reconstruction | 8.63 s; every canonical retained byte matched | One terminal retained-state fixture; not a complete sequencer daemon restart or long-history capacity test |
| Standard inbox BoLD challenge | Both recorder cases passed; honest validator won | Standard inbox dispute, not a wrong chess-result dispute |

[Adapted-fork withdrawal summary](withdrawal/evidence/summary.json) · [actual native-parent parity](withdrawal/parent-parity/evidence/summary.json) · [graceful restart](production/evidence/sequencer-lifecycle-recovery.json) · [strict rejection classification](production/evidence/strict-mint-classification-summary.json) · [native artifact](production/evidence/native-acceptance-build.json) · [terminal input](production/evidence/terminal-input-manifest.json) · [challenge-manager regression](dispute/evidence/terminal-report.json) · [BoLD boundary backend](dispute/evidence/boundary-backend.json) · [boundary Solidity verification](dispute/evidence/boundary-solidity-report.json).

## Strength stays fixed

Stockfish commit, complete network, 24 million nodes, Hash 128 MiB, Threads 1, Skill 20, disabled strength limiting and retained per-game state remain fixed. The full reference decision is **e7e5 /24,000,033 nodes  / depth 38**, with canonical SHA-256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6`.

Four exact continuations share each computing transaction, with one computing transaction admitted per block. The decision uses 2,464 compute transactions. At the 100 ms target, scheduling alone requires at least 246.4 seconds. The earlier 365.91 s mined fixture and new 399.13 s restart fixture include their own setup/recording/recovery work; neither is a 100 ms move claim.

## Native withdrawals: adapted fork and actual native parent

The two passing runs use real GH0ST bytecode/state at pinned Robinhood snapshots, a clean official client paired with its standard `0xc10c…dc97` machine, an empty native genesis allocation and final genesis-assertion validation enabled. An auxiliary zero-funded native-node calculation determines genesis; the final fresh rollup must reproduce both its exact header hash and state root.

The official native child processes a 4 GH0ST parent deposit, an ordinary 1 GH0ST child transfer and a 0.5 GH0ST ArbSys burn. Genuine Rollup confirmation updates the real Outbox root; a real proof releases exactly 0.5 GH0ST from parent escrow. Unconfirmed roots, non-rollup root registration, altered amount/proof and repeated withdrawal reject. Player, chain owner/fee recipient and batch poster are distinct so fee recycling cannot hide a wrong gas-debit calculation.

The parent remains a private Ganache fork. Its inherited inert ArbSys marker `0xfe` is explicitly removed because Ganache cannot execute native ArbOS; a genuine Reader4844 artifact supports the calldata-only parent path. This adapter is recorded, not a synthetic replacement of the child's precompiles. Fast confirmation is privileged, and the test does not verify a complete execution-history commitment or normal challenge-period finality. The earlier GHMOCK and adapted-fork results remain separate from the actual native-parent follow-up below.

The separate actual native-parent follow-up **passed**: private native Geth 1337 → official native Nitro parent 4663 → official native Nitro child 4663007. Genuine parent ArbSys/ArbGasInfo remain active, without clearing or replacing precompile markers; both native genesis hashes and state roots validate. The same deposit/spend/burn/release path has exact balances and genuine Rollup/Outbox receipts.

Its token is an observed sparse account clone from a pinned read-only Robinhood source, not the complete canonical token ledger or an authenticated Merkle-proof reconstruction. The fixed-endpoint witness traces all 82 committed parent transactions, including 5 token-call transactions, across 7 distinct token storage keys. Every initial value matches the frozen observed source or an independently source-confirmed zero; 6 previously uncopied mappings are zero and no keys are unmatched. This establishes the tested native-host path while retaining the clone, fake-parent-ETH, privileged-fast-confirmation and unverified execution-history/finality boundaries. It does not execute or certify the custom chess STF. [Exact scope and evidence](withdrawal/parent-parity/README.md).

## Recovery, strict errors and preserved failures

The graceful fixture closes/reopens both execution and consensus over the same Pebble database, destroys the live engine VM at each restart and checks persisted head/state/cursor before resuming. Cursors 64 and 2048 both recovered, and the completed decision matches every canonical byte. The original collector lost its process exit status and failed to sample resources on a cgroupv1 host; its exit remains null. The Go-PASS log and assertion report establish this bounded result, not a fabricated exit 0 or a precise fixture peak.

The older full-decision fixture's broad error assertions are not retroactively strengthened. A separate short native mint-control regression rejects eight actual EVM executions and two exact access-controlled precompile executions, with actual exit 0. It also checks disabled management, an empty mint-owner list and unchanged head/root across its restart. The earlier strict attempt failed on intrinsic gas; its failed exit/log is preserved rather than counted as an access-control pass.

[Restart resource limits](production/evidence/restart-resources-summary.json) · [strict mint verification](production/evidence/strict-mint-verification.json) · [preserved intrinsic-gas failure](production/evidence/strict-mint-intrinsic-gas-failure-exit.json).

## Selected combined C: completed terminal reference

The earlier real-C diagnostic and native comparison retain their scopes: exact four end fields, native block/state/receipt hashes, 12,306,935 gas and canonical SHA-256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6`. The separate interpreter now finishes the **one recorded terminal block** with actual direct-child exit 0 in **9,011.040 seconds**, no timeout, all four fields exact and kernel maximum RSS **25,492,628 KiB**. [Completed result](production/bounded-restore/scheduling/comparison/C-combined/interpreter/replay-result.json) · [actual exit](production/bounded-restore/scheduling/comparison/C-combined/interpreter/exit.json).

Selected root is `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`; machine SHA-256 is `4bf7fe54c28ad0b6f2620df3ee6b4c6d87452f9ab76ec8be294eb7d4c934770e`. The original input is `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90`, captured under d453. Replaying it with candidate 865 does not change that recorded parent/module context or accept a deployed parent. This is not an interpreter replay of all computing blocks in the full 24m decision, and it does not freeze a production client/machine/genesis pair.

Raw **H = 1,444,459,006,817** gives wrapped **F = H + 1 = 1,444,459,006,818**. The earlier 2^40 geometry cannot fit; strict **F < 2^43** and **H <= 2^43−2** satisfy the candidate cap arithmetic. The complete proof is **107,573,150 bytes**, SHA-256 `74473cd9a4e149aa8230baf8cefca1736a0201d7111a5c00bc20ecb93397a448`. Raw logs, machine, guest, C companion and proof identities remain frozen.

The [eight-witness regression](dispute/selected865-steps/README.md) passes inherited Solidity OSP/manager checks and 56 strict negatives with the exact candidate hierarchy `[8192,2048,2048,2048,1024]`. Canonical Finished hash `c95f77e1ef8681eb1a95321c3368298240ec3bf65bf3169e91c374fa989259cd` matches the actual CLI, selected Finished before/after and pinned OSP result. The absorbing proof verifies at F. The sampled Running witness is59,006,817 steps before H, not H−1; it is not renamed as the natural terminal transition. C routines remain individually unnamed. Fixture ancestors/history/configuration keep this separate from a full dispute.

## Current validation transport gate

A read-only [logging/transport review](dispute/full-lifecycle/logging-transport-review/README.md) found two roughly 2.57 GB `validation_createExecutionRun` failure log lines in the old c03c run and the pinned test server's32 MiB request cap. Actual connection resets are preserved; no separate server-side read-limit error was recovered. A positive log truncation limit alone still fully formats the input before slicing, so bounded payload-safe logging and real typed transport need separate checks.

[Guarded full-size transport v3](dispute/full-lifecycle/large-input-preflight/README.md) now passes actual exit 0 / 66.714 s: 43.866 s upload/init/close, 23,615,612 KiB max RSS, actual 2,569,360,144-byte request under 3 GiB, 402,818 preimages / 1,911,582,985 decoded bytes and exact canonical typed identity. A real execution run registers, wrapped 0 is observed and closure is verified. A test-only guard prohibits positive steps and none occur. This is initialization only, not full replay or completed-cache acceptance. V1/v2 failures remain; equivalent map encodings need not share wire SHA.

The future unguarded helper/controller compiles, but the [read-only host-cache review](production/bold-cache-review/README.md) finds eager full scans and fresh/deferred-close runs per query. Shared lifetime, coarse-hash repeat avoidance, refined snapshots, canonical identity, cancellation and memory/latency require an independently tested host-only enhancement now in development. Root final source/geometry authorization remains false. **No lifecycle has started** and the completed original 150-minute reference is unchanged.

## Historical terminal failures and stopped lifecycle

The full native decision/capture and cache-fixed native all-four/header/canonical checks remain passes. Both historical late-state guests failed: the original d453 machine after 2,153.854 seconds and guarded c03c after **3,575.3639305480756 seconds**, each actual exit 1. The c03c guest had **4,227,235,840 bytes** in use when another 4,194,304-byte allocation failed. It reached the uncached accessor, did not finish and did not match all four end-state fields. Its 3 GiB soft limit did not prevent address-space exhaustion. Native parity does not accept either guest. [Guarded failure](production/bounded-restore/evidence/guarded-replay-failure/replay-result.json), [actual exit](production/bounded-restore/evidence/guarded-replay-failure/exit.json), [earlier failure](dispute/evidence/terminal-wavm-failure/replay-result.json).

Root preserved the dependent fixture and stopped it with **SIGTERM, actual exit −15 after 3,135.089 seconds**. Its private Geth, prover and observer were verified gone; all five read-only auditors stopped. The final classification is **STOPPED_NOT_ACCEPTED**, with 48 captured edges and zero accepted one-step events, exact target confirmations or collateral refunds. Actual native full-decision capture, exact claims and 13 block-bisection levels remain narrow evidence. [Final stopped audit](dispute/full-lifecycle/audit/evidence/stopped-current/stopped-summary.json).

## Strict lifecycle acceptance and separate inputs

The stopped fresh case verified 2,574,999,142 bytes, SHA-256 `c419b88eec6e62cffc6afed5c6a38b7bce26e13512ab8ed7982ffb793f781f48`, and terminal block 4921 `0xb9d894b0b7bbc21e1542ea094ee9ce9b3709869265b2885fb152b8933ad976aa`. Its honest assertion `0xdc83571fb1729f533d9e1823c2ddb0bfa0489cadc99ea97fdadc26a5be1e6abd` and false assertion `0x11bb3d6e02ae7d91ee4cef22273b8659d66f348e0e351f621efa705ca80433f5` share parent `0x1508a5bdad74a95c183f82cbde3ac594d965c5bbd7a2e992a849b2b72f2e9900`. Thirteen real block-bisection levels reach 4920→4921, but the machine-hash path stopped without accepted proof/settlement. These identities are distinct from the original failed replay input `bd81988d132f689a5efd3e6aa08a542d7ddf630cc227f56a10b340ff8cc08e90` (2,574,999,906 bytes).

A broad fixture report is insufficient. Acceptance needs a successful one-step event descended from the exact honest terminal block-to-machine transition, confirmation of that exact assertion afterward, and exact nonzero edge-collateral refund with successful receipt, transfer and independently reconciled balances. This does not cover withdrawal of assertion stakes. [Strict audit rules](dispute/full-lifecycle/audit/README.md).

The separate [geometry43 preflight](dispute/full-lifecycle/geometry-2pow43/README.md) passes compilation, **173 normal/173 optimized guards and 55 Go named cases**, plus actual private contract/root/height readback. The configured vector is `[8192,2048,2048,2048,1024]`; the block height does not multiply per-block machine capacity. Prior 160 / 87 / 72-case packets and audit/refusal evidence remain preserved. Final geometry/source review and root authorization remain false pending the new large-input transport/cache review. No fresh proof/confirmation/refund lifecycle has started.

The earlier restore-only diagnostics deliberately stopped before engine execution and remain separate. The later unchanged-C linker now runs the real companion and selected combined C passes the full terminal diagnostic; it supplies a fast gate, not an interpreter/proof substitute. The completed interpreter is accepted only as the selected one-terminal-block reference; source/geometry/transport review and a fresh full lifecycle remain separate.

Earlier bounded contract checks remain separate: five authentic witnesses and 35 strict negatives pass the inherited terminal manager with seeded ancestor/history/config fixtures; the step-0/offset-1 BoLD start boundary passes its Go backend and later single Solidity case/seven negatives. The original pre-Solidity backend report remains unchanged. These checks do not close complete bisection/assertion/settlement acceptance.


## Resource and storage boundaries

The earlier paired eager/lazy experiment exceeded its 64 GB memory limit; the eager job was killed and the lazy job completed. There is no completed paired Linux speed comparison. The isolated next-block lazy proof later peaked at 39,053,127,680 bytes cgroup memory on 128 GB without OOM. That is not an accepted 24 GB configuration or a hard-limit 64 GB production coexistence test.

First-decision raw deltas total 1,617,883,940 bytes. The earlier disk fixture observed about 577 MB initially, 3.216 GB at terminal commit/close and 1.586 GB after compaction/reopen. These are fixture measurements, not a steady-state growth forecast. A simple 20 games × 80 decisions projection exceeds 2.5 TB raw before overhead; it does not establish measured 20-game capacity.

The separate [checkpoint study](storage/checkpoint-study/README.md) restored the authenticated preterminal image offline and round-tripped every byte: about 146 MB of standalone genesis differences versus 1.619 GB of delta code. It installs no checkpoint/cleanup and certifies no production or 20-game capacity.

The earlier 53-test codec/emulator prototype is now followed by [real isolated A15 native integration](storage/checkpoint-integration/README.md). Its completed-state checkpoint preserves every byte/global/root and full canonical state; after cold cache destruction, the next unchanged full 24m decision matches b8c6 / 24,000,311 / depth 39 and the complete frozen canonical hash. Actual namespace, admission, OOG/outer rollback, stale-cache, corrupt backing and nonzero nonce/balance sharing regressions pass. New-piece scan/writes and Finalize are bounded, but inherited whole-source cold/recording restoration is not bounded by a piece. No production tariff, matching checkpoint guest, cleanup or physical disk bound is accepted.

The separate [retention design](storage/retention-design/README.md) proposes a reusable page bank to bound current protocol storage. It implements no bank, retirement, archive service or pruner. Compacted active ancestry is not total disk reclamation; historical challenge/reorg/recovery availability remains a separate gate.

`ReleaseGame` clears admission/live-cache metadata but does not erase immutable delta accounts. Ordinary database compaction therefore cannot establish reclamation. Long-history recovery, challenge-safe retention and actual resource bounds remain required. The [release packet](release/README.md) records a live budget-screen host candidate; no complete all-in USD 100/month production setup has been accepted.

## Remaining mainnet gates

- Freeze production GH0ST backing, token/parent contract configuration and operator controls. Actual native-parent observed-state parity passed; no public deployment or complete canonical-ledger clone is implied.
- Integrate the passed guarded transport/logging with independently tested host-cache reuse and final source/geometry review before root-authorized private lifecycle. The terminal reference passes; all 24m-block/deployed-parent and full settlement acceptance remain open.
- Accept production CLI/container recovery and power-loss/durability bounds separately from the passing private two-SIGKILL decision; accept long-history capacity, challenge-safe retention and resource rejection/coexistence.
- Freeze the matching native client, custom machine, production genesis/allocation, parent contracts and validator configuration. The custom A14 client cannot be paired with an unrelated official standard root.
- Review fee pricing/parent ETH reserves, validator collateral/finality, operator/upgrade/native-mint authority, hosting and the applicable license path. Production configuration and addresses remain unset.
- Deploy only the reviewed configuration and establish the launch with public receipts and working endpoints.

The earlier withdrawal worker was removed after evidence collection. The native-parent fixture finished and stopped its owned chains. The 32 GB production worker was deleted after completed transfers and idle-process checks; its task-only transfer key was removed first and a fresh provider 404 confirmed deletion. Only the temporary 128 GB allocation remains at **USD 1.04/hour compute plus disk**. The old failed prover, stopped lifecycle/private parent, observer and five auditors remain stopped; the completed selected-C interpreter is preserved while host-cache enhancement/review proceeds. No production-proof-pair or full-lifecycle acceptance, production hosting order, mainnet deployment or movement of existing mainnet funds follows.

**Current gate:** completed one-terminal-block reference replay and 8 / 56 sampled-witness checks pass. The old 2^40 geometry is rejected; 2^43 arithmetic/config preflight fits, but final geometry/source review and root authorization remain false pending host-cache integration and final source review. No fresh lifecycle or public launch has started. [Reference replay](production/bounded-restore/scheduling/comparison/C-combined/interpreter/replay-result.json) · [transport review](dispute/full-lifecycle/logging-transport-review/README.md).
