# GL3 · Linux acceptance notebook

[GL3 overview](../README.md) · [Sequential history](../HISTORY.md) · [Roadmap](../ROADMAP.md) · [Release packet](release/README.md)

**Native-flow and recovery checks passed; the final-block guest replay failed. Robinhood mainnet is not deployed.** Every build, engine run, replay and contract test in this milestone ran on Runpod. Local work is limited to editing, evidence transfers, research and publication.

## Evidence snapshot

| Result | Measurement / evidence | Exact boundary |
| --- | --- | --- |
| Real-GH0ST native withdrawal flow, repeated twice | Deposit 4 GH0ST, spend 1 GH0ST, burn/withdraw 0.5 GH0ST; exact child debit including gas and exact parent recipient/bridge changes | Actual native official Nitro child on an adapted Ganache fork; privileged genuine-rollup confirmation; not actual Robinhood-parent semantics or custom chess-STF acceptance |
| Actual native-parent GH0ST observed-state parity | Geth → native Nitro parent 4663 → native Nitro child;4 GH0ST deposit,1spend, 0.5burn/release;82 parent transactions traced,7 storage keys, 0 unmatched | Observed sparse clone, not complete canonical ledger or Merkle-proof reconstruction; privileged genuine Rollup confirmation; no chess-STF or permissionless-finality claim |
| Graceful execution/consensus recovery | Full decision completed in 399.13 s with restarts at cursors 64 and 2048; complete 163,085,439-byte canonical state matched | Same OS process and Pebble database; not a daemon crash, power loss or separate-process production reboot |
| Strict native-mint rejection regression | Ten classified execution rejections before/after a short restart; actual exit 0 | Eight EVM reverts and two exact pinned access-control errors; transport/deadline/internal errors cannot count as passes |
| Native artifact hardening | Original 98,511,183-byte NNUE unchanged; final ELF GNU_STACK=RW | Metadata repair; production artifact/genesis acceptance remains separate |
| Complete terminal decision capture | Full 24m decision, actual terminal compute receipt and parent batch 2469; input 2,574,999,906 bytes, recorded exit 0 | Native capture passed; independent terminal-block interpreter replay subsequently failed |
| Independent last-block interpreter replay | **Failed** after 2,153.854s, actual exit 1; guest heap exhausted during historical delta restoration | Expected four-field result not matched; no host OOM or timeout; bounded-restore candidate untested |
| Inherited challenge-manager terminal proof path | Five authentic witnesses; 35 strict negative contract checks reject | Fixture ancestors, history siblings and predecessor config; not complete assertion creation, bisection, stake settlement or assertion confirmation |
| Real BoLD start boundary | Pinned Go backend at step 0 / offset 1; one subsequent inherited-manager/OSP case and seven strict negative checks; both actual exits 0 | Finished-to-running wrapper initialization only, with fixture context; no engine search or full dispute |
| Two consecutive initial lazy-machine block replays | All four expected fields matched; five actual Solidity witness checks per block | Captured initial/progress blocks; not every computing transaction in a complete move |
| Earlier actual mixed-traffic full decision | 2,464 compute operations and 2,464 ordinary transfers; ordinary confirmations 141.60 ms median / 160.91 ms p95 | Private native parent/child test under 100 ms target; receipt latency, not a public block-time or inference SLA |
| Earlier separate-process disk reconstruction | 8.63 s; every canonical retained byte matched | One terminal retained-state fixture; not a complete sequencer daemon restart or long-history capacity test |
| Standard inbox BoLD challenge | Both recorder cases passed; honest validator won | Standard inbox dispute, not a wrong chess-result dispute |

[Adapted-fork withdrawal summary](withdrawal/evidence/summary.json) · [actual native-parent parity](withdrawal/parent-parity/evidence/summary.json) · [graceful restart](production/evidence/sequencer-lifecycle-recovery.json) · [strict rejection classification](production/evidence/strict-mint-classification-summary.json) · [native artifact](production/evidence/native-acceptance-build.json) · [terminal input](production/evidence/terminal-input-manifest.json) · [challenge-manager regression](dispute/evidence/terminal-report.json) · [BoLD boundary backend](dispute/evidence/boundary-backend.json) · [boundary Solidity verification](dispute/evidence/boundary-solidity-report.json).

## Strength stays fixed

Stockfish commit, complete network, 24 million nodes, Hash 128 MiB, Threads 1, Skill 20, disabled strength limiting and retained per-game state remain fixed. The full reference decision is **e7e5 /24,000,033 nodes /depth 38**, with canonical SHA-256 `5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6`.

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

## Terminal replay and dispute scope

A separate native run completed the same full decision and captured its last computing block, not just an early progress block. Parent batch 2469 and all four expected end-state fields accompany the 2.575 GB input. Its actual process exit is 0; the observer's late attachment and whole-pod memory scope are preserved. The raw input is hash-checked and retained privately rather than uploaded as a multi-gigabyte Git blob.

The matching `0xd453…4613b` interpreter replay subsequently **failed**, with actual exit 1 after 2,153.854086seconds and no timeout. The WASM32 guest exhausted its roughly 4 GB heap in `StateDB.GetCode` / `sliceReadDelta` / `sliceRestoreSeed`: 4,223,369,216 bytes were in use when another 4,194,304-byte allocation failed. The machine ended errored and did not match the expected four-field result. Whole-pod host peak was45,688,385,536bytes and includes prior work; the 128 GB host did not run out of memory.

[Exact failed replay](dispute/evidence/terminal-wavm-failure/replay-result.json) · [failure classification](dispute/evidence/terminal-wavm-failure/failure-classification.json) · [actual exit](dispute/evidence/terminal-wavm-failure/exit.json).

The native decision and capture still passed, but they do not accept this guest module for production. Earlier initial/next-block replay passes do not supersede this late-state failure. A bounded historical-code restoration candidate under development is **untested and unaccepted**; it needs fresh native/guest and matching-machine acceptance without changing the engine policy. Neither a future final-block replay nor the current capture would constitute interpreter execution of all2,464compute transactions or a complete BoLD dispute.

Five witnesses from the previously completed next block already pass the inherited real `EdgeChallengeManager.confirmEdgeByOneStepProof` path. Correct edges become confirmed, conflicting rivals cannot replace them, and all 35 negative checks reject through contract execution. The ancestor/history/config fixtures leave full automatic bisection, assertion confirmation and stake settlement open.

The real pinned Arbitrator loader and BoLD wrapper also passed the finished-to-running boundary at proof step 0, with the one-step offset set to 1. Its 478-byte witness subsequently passed the inherited manager/pinned Solidity verifier in one case with seven strict negative checks; backend and Solidity processes both returned actual exit 0. The original backend report retains `SolidityVerified=false` because it was written before the separate later Solidity run. This initialization check does not execute engine search or close full history/assertion dispute acceptance. The execution-cache probe is an unlaunched prototype, not a passing cache or challenge test.

## Resource and storage boundaries

The earlier paired eager/lazy experiment exceeded its 64 GB memory limit; the eager job was killed and the lazy job completed. There is no completed paired Linux speed comparison. The isolated next-block lazy proof later peaked at 39,053,127,680 bytes cgroup memory on 128 GB without OOM. That is not an accepted 24 GB configuration or a hard-limit 64 GB production coexistence test.

First-decision raw deltas total 1,617,883,940 bytes. The earlier disk fixture observed about 577 MB initially, 3.216 GB at terminal commit/close and 1.586 GB after compaction/reopen. These are fixture measurements, not a steady-state growth forecast. A simple 20 games × 80 decisions projection exceeds 2.5 TB raw before overhead; it does not establish measured 20-game capacity.

`ReleaseGame` clears admission/live-cache metadata but does not erase immutable delta accounts. Ordinary database compaction therefore cannot establish reclamation. Long-history recovery, challenge-safe retention and actual resource bounds remain required. The [release packet](release/README.md) records a live budget-screen host candidate; no complete all-in USD 100/month production setup has been accepted.

## Remaining mainnet gates

- Freeze production GH0ST backing, token/parent contract configuration and operator controls. Actual native-parent observed-state parity passed; no public deployment or complete canonical-ledger clone is implied.
- Repair and independently accept the failed late-state guest restoration/replay, then execute the complete deliberately incorrect engine-result dispute through the actual assertion/challenge lifecycle. The bounded-restore candidate is not yet tested.
- Accept process-level/crash recovery, long-history capacity, challenge-safe retention and resource rejection/coexistence.
- Freeze the matching native client, custom machine, production genesis/allocation, parent contracts and validator configuration. The custom A14 client cannot be paired with an unrelated official standard root.
- Review fee pricing/parent ETH reserves, validator collateral/finality, operator/upgrade/native-mint authority, hosting and the applicable license path. Production configuration and addresses remain unset.
- Deploy only the reviewed configuration and establish the launch with public receipts and working endpoints.

The earlier withdrawal worker was removed after evidence collection. The native-parent fixture has finished and its owned chain processes are stopped; the failed replay process has exited. The 32 GB production worker was deleted after completed transfers and idle-process checks; its task-only transfer key was removed first and a fresh provider 404 confirms deletion. Only the 128 GB proof allocation remains at **USD 1.04/hour compute plus disk** until cleanup or reassignment. Bounded-restore work is in progress, not accepted production hosting or a passing replay.
