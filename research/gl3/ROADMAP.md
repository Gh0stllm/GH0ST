# GL3 roadmap

[Overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md)

## Completed locally

- [x] Define Robinhood-parent / GH0ST-gas direction and preserve fixed chess strength policy.
- [x] Pin standard Nitro, SDK, source, official machine root and reproducible build artifacts.
- [x] Verify ordinary Solidity/Stylus execution on the clean base.
- [x] Measure 100 ms-profile lightweight receipt latency.
- [x] Validate both actual local Nitro genesis assertions.
- [x] Verify native mock-token deposit, child spending and exact parent-batch inclusion.
- [x] Separate the deployable child footprint from test-only Ethereum/RH-like parents.
- [x] Create the dedicated GL3 research branch, notebook and visual identity.

## Completed workload study

- [x] Complete unchanged 24m-node Black inference across two whole published game histories.
- [x] Measure peak process memory, simultaneous searches and exact-state recovery.
- [x] Compare current low-cost hosting quotes with their real terms.
- [x] Record whether 16 GB is supported by measured engine demand and which end-to-end workloads remain untested.

## Before public base deployment

- [ ] Finalize host, availability/recovery design and Linux acceptance test.
- [ ] Review real GH0ST compatibility, fee-token pricer, parent ETH reserve and operator custody.
- [ ] Select/review validator collateral, challenge/finality parameters and license path.
- [ ] Build/accept the reviewed Linux artifact and rehearse production configuration.
- [ ] Promote only the reviewed engine extension; leave development-only precompiles disabled.
- [ ] Deploy only the concrete reviewed contracts and verify public receipts.

## Active: full chess integration and proofs

- [x] Integrate full deterministic engine execution and authenticated retained state into the experimental custom STF.
- [x] Match four complete native/scalar-Wasm decisions and canonical state; generate the complete custom WAVM machine.
- [x] Mine an actual full-strength block, post it in a real local parent batch and independently replay the complete native block.
- [x] Verify initialization/common-point and actual Stockfish search-loop/memory/arithmetic OSP witnesses, with corruption rejection.
- [x] Complete one corrected sliced block in the frozen eager WAVM machine and match all four global-state fields.
- [x] Verify five distinct eager-machine Solidity witnesses, including corruption rejection.
- [x] Complete the newer lazy-copy machine’s independent Linux first-block replay and five Solidity witnesses.
- [x] Complete its next consecutive recorded-block replay and five independent witness checks.
- [x] Mine a complete unchanged Linux decision alongside 2,464 ordinary transfers.
- [x] Recover its terminal retained state from disk in a separate OS process.
- [x] Complete the standard inbox BoLD dispute through actual challenge contracts.
- [x] Complete real-GH0ST deposit, native child spend/burn and genuine-rollup-confirmed parent release twice on an explicitly adapted private fork.
- [x] Pass actual native Nitro-parent/child GH0ST observed-state parity: 82 parent transactions, 7 token storage keys, 0 unmatched. The sparse-clone and privileged-confirmation scope remains explicit.
- [x] Complete an unchanged decision across graceful execution/consensus restarts at cursors 64 and 2048, with cold VM destruction and exact canonical state.
- [x] Verify ten strict native-mint execution rejections around a separate short restart, with actual exit 0.
- [x] Remove executable-stack metadata while preserving exact original network bytes and fixed engine policy.
- [x] Capture the actual last computing block and parent batch 2469, with a 2.575 GB hash-verified input and actual exit 0.
- [x] Pass the bounded historical-code repair natively: optional accessor/witness/recorder/journaling checks, exact terminal four-field result, identical block/state/receipt hashes and 12,306,935 gas, and all 163,085,439 canonical bytes.
- [x] Generate the guarded matching proof root with a guest-only 3 GiB soft limit, leaving engine quality and consensus gas unchanged.
- [x] Preserve both d453 and c03c guest address-space failures and the stopped dependent lifecycle without upgrading their native results into proof acceptance.
- [x] Pass real unchanged-C WASM32 diagnostics and select combined C: exact four fields, Go 2,000.5 MiB / C 711,655,424 bytes; native header/gas/canonical equivalence and seed-negative/witness checks pass.
- [x] Build a separate exact-final-step host CLI and verify its 7-step tiny-WASM counter smoke; no chess step count follows from that smoke.
- [x] Complete the selected 865 reference replay of one original d453-capture terminal block: exit 0/Finished/all 4 exact, H 1,444,459,006,817 and F 1,444,459,006,818; no all 24m-block/deployed-parent claim.
- [x] Verify selected 865 kickoff offset 1 and two authentic initialization transitions through the pinned backend/inherited OSP, with 14 strict negative checks; synthetic cap units remain separate.
- [x] Reject the prior 1024^4 =2^40 private geometry: the sampled running raw count already exceeds it.
- [x] Verify strict F<2^43/H<=2^43−2 arithmetic and 8 authentic terminal witnesses/56 strict negatives under candidate hierarchy; absorbing Finished is not the preceding naturalH−1 transition.
- [x] Pass geometry 43 compile/config preflight: 173 normal/173 optimized guards, 55 Go cases and actual private contract/root readback.
- [x] Pass guarded full-size typed transport initialization and payload-safe logging; no positive steps/cache/replay/lifecycle acceptance.
- [ ] Freeze/test host-cache shared lifetime/coarse recording/refinement and canonical identity; final source/geometry/root launch authorization remain false.
- [x] Verify five authentic witnesses through the inherited terminal challenge manager and reject 35 negative contract cases (fixture ancestors/history/config).
- [x] Verify the real BoLD finished-to-running start boundary at step 0 / offset 1, then its separate Solidity case and seven strict negative checks (fixture context only).
- [ ] Complete the original monolithic 24m-move WAVM reference; the incomplete local run was stopped when the user moved all tests to Runpod.
- [x] Preserve prior 160 / 87 / 72 guard packets separately from latest geometry 43 preflight; none alone establishes full lifecycle acceptance.
- [x] Cloud-compile the future nonce-bearing Go candidate and reject missing-ID/no-matching-test entry points before any engine work.
- [ ] Complete a fresh exact-target controller/auditor/Go lifecycle after transport/cache/source review and root authorization; preflights do not establish it.
- [ ] Complete the exact-target incorrect-result dispute. Historical stopped case remains 48 edges/13 block-bisection levels andzero accepted OSP/confirmation/refund; no fresh lifecycle has started.
- [x] Complete the separate offline preterminal checkpoint study: exact all-byte round-trip at about 146 MB versus 1.619 GB of delta code.
- [x] Pass isolated A15 native checkpoint: 64 pieces / 162,059,912 body bytes, exact completed image, actual handler/revert/cache/namespace tests, and unchanged full 24m cold continuation.
- [ ] Accept a matching checkpoint guest/profile, inherited cold-work and gas bounds; native pass is not production acceptance.
- [x] Prepare the source-backed reusable-page-bank/current-state and historical-retention design; design only, no cleanup/pruning.
- [ ] Implement and accept retirement or fixed-bank migration with challenge-safe historical availability and measured disk bounds; no 20-game capacity follows from active-head compaction.
- [x] Preserve the earlier 53-test checkpoint codec/emulator prototype separately from the real A15 native integration; neither is a production storage pass.
- [ ] Measure actual end-to-end memory, disk growth, move latency and parent posting costs.
- [ ] Wire the reviewed game/reward path and prove complete legal play and payouts.

Checks represent achieved local/private-cloud evidence or explicit remaining work. Graceful same-process restart, adapted-fork withdrawal and seeded terminal challenge checks retain their stated boundaries. This is not a launch-date promise.

## Mainnet direction

The user requested Robinhood mainnet deployment after acceptance. R38 completes the selected 865 **one-terminal-block reference** with exact end state andH/F; it does not replay every 24m computing block or accept the recorded d453 parent context as candidate 865 production deployment. Eight inherited contract witness checks pass under fixture ancestors/history/configuration. Old 2^40 capacity stays rejected; strict 2^43 arithmetic and 173 / 173 / 55 configuration preflights pass, but final geometry/source review and root authorization remain false. Guarded full-size transport initialization now passes after the old 2.57 GB/32 MiB mismatch; unguarded runtime cache reuse and final source review remain open. No fresh lifecycle, public deployment or mainnet fund movement occurs. Only the temporary 128 GB worker remains at USD 1.04/hour compute plus disk. All builds/tests run on Runpod.

The new graceful restart and repeated native withdrawal results close bounded acceptance tasks. A pilot still needs matching production client/machine/genesis, full wrong-engine-result dispute, repaired late-state guest replay, production token/parent configuration, production CLI recovery and long-history storage/resource bounds, reviewed fee/ETH reserve and validator/upgrade controls, and the applicable license path. The current proof path has not met the preferred 24 GB server target, and no complete all-in USD 100/month production configuration or 20-game capacity is accepted. Public receipts and working endpoints will establish a launch when it occurs.

## R37 evidence

[Native A15 checkpoint/continuation](mainnet/storage/checkpoint-integration/README.md) · [Selected865 initialization boundary](mainnet/production/selected865-boundary/README.md) · [Old geometry overflow](mainnet/production/bounded-restore/scheduling/comparison/C-combined/interpreter/overflow-observation.json) · [Retention design only](mainnet/storage/retention-design/README.md). These links record R37 as it stood then; completed terminal reference/CLI 64 and geometry 43 preflight are linked below without changing earlier history.

## R38 evidence

[Completed terminal reference](mainnet/production/bounded-restore/scheduling/comparison/C-combined/interpreter/replay-result.json) · [eight authentic witnesses](mainnet/dispute/selected865-steps/README.md) · [ordinary CLI64 crash profile](mainnet/production/cli-recovery/README.md) · [geometry43 compile/config preflight](mainnet/dispute/full-lifecycle/geometry-2pow43/README.md) · [transport v3 initialization only](mainnet/dispute/full-lifecycle/large-input-preflight/README.md). Native A15 and retention boundaries remain unchanged.
