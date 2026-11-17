# GL3 roadmap

[Overview](../../README.md) · [History](HISTORY.md) · [Findings](FINDINGS.md)

## Completed locally

- [x] Define Robinhood-parent / GH0ST-gas direction and preserve fixed chess strength policy.
- [x] Pin standard Nitro, SDK, source, official machine root and reproducible build artifacts.
- [x] Verify ordinary Solidity/Stylus execution on the clean base.
- [x] Measure100 ms-profile lightweight receipt latency.
- [x] Validate both actual local Nitro genesis assertions.
- [x] Verify native mock-token deposit, child spending and exact parent-batch inclusion.
- [x] Separate the deployable child footprint from test-only Ethereum/RH-like parents.
- [x] Create the dedicated GL3 research branch, notebook and visual identity.

## Completed workload study

- [x] Complete unchanged 24m-node Black inference across two whole published game histories.
- [x] Measure peak process memory, simultaneous searches and exact-state recovery.
- [x] Compare current low-cost hosting quotes with their real terms.
- [x] Record whether16 GB is supported by measured engine demand and which end-to-end workloads remain untested.

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
- [x] Pass actual native Nitro-parent/child GH0ST observed-state parity:82 parent transactions, 7 token storage keys, 0 unmatched. The sparse-clone and privileged-confirmation scope remains explicit.
- [x] Complete an unchanged decision across graceful execution/consensus restarts at cursors 64 and 2048, with cold VM destruction and exact canonical state.
- [x] Verify ten strict native-mint execution rejections around a separate short restart, with actual exit 0.
- [x] Remove executable-stack metadata while preserving exact original network bytes and fixed engine policy.
- [x] Capture the actual last computing block and parent batch 2469, with a 2.575 GB hash-verified input and actual exit 0.
- [x] Pass the bounded historical-code repair natively: optional accessor/witness/recorder/journaling checks, exact terminal four-field result, identical block/state/receipt hashes and 12,306,935 gas, and all 163,085,439 canonical bytes.
- [x] Generate the guarded matching proof root with a guest-only 3 GiB soft limit, leaving engine quality and consensus gas unchanged.
- [x] Preserve both d453 and c03c guest address-space failures and the stopped dependent lifecycle without upgrading their native results into proof acceptance.
- [x] Pass real unchanged-C WASM32 diagnostics and select combined C: exact four fields, Go 2,000.5 MiB / C 711,655,424 bytes; native header/gas/canonical equivalence and seed-negative/witness checks pass.
- [x] Build a separate exact-final-step host CLI and verify its 7-step tiny-WASM counter smoke; no chess step count follows from that smoke.
- [ ] Complete the one four-hour-bounded combined-C interpreter replay, currently **RUNNING_NOT_ACCEPTED** under root `0x865168ea04ee58578a710a5270c22495c90b1c0f2226d39fecbb9eac4ea3f086`; require actual exit, finished state, all four fields and raw exact counter.
- [ ] Review raw-counter-plus-one and the real BoLD kickoff/start offset against challenge geometry before restarting the exact-target lifecycle.
- [x] Verify five authentic witnesses through the inherited terminal challenge manager and reject 35 negative contract cases (fixture ancestors/history/config).
- [x] Verify the real BoLD finished-to-running start boundary at step 0 / offset 1, then its separate Solidity case and seven strict negative checks (fixture context only).
- [ ] Complete the original monolithic24m-move WAVM reference; the incomplete local run was stopped when the user moved all tests to Runpod.
- [x] Pass future-controller syntax and 87 false-pass guard regressions, repeated under Python `-O`, on Runpod without changing the active fixture.
- [x] Cloud-compile the future nonce-bearing Go candidate and reject missing-ID/no-matching-test entry points before any engine work.
- [ ] Complete a fresh UUID-bearing controller/auditor/Go lifecycle integration; pure guards and refusal checks do not establish this full integration.
- [ ] Complete the exact-target incorrect-result dispute: bound honest/false claims and 13 real block-bisection levels reach 4920→4921; the dependent fixture is STOPPED_NOT_ACCEPTED with zero accepted one-step/confirmation/refund results. A new exact-target run is required after guest repair.
- [x] Complete the separate offline preterminal checkpoint study: exact all-byte round-trip at about 146 MB versus 1.619 GB of delta code.
- [ ] Implement and accept bounded checkpoints/retirement with challenge-safe historical retention; offline savings establish no production or 20-game capacity.
- [ ] Promote any separate checkpoint codec/emulator/harness prototype only after real STF, authentication, rollback, retention and capacity acceptance; source work alone is not production integration.
- [ ] Measure actual end-to-end memory, disk growth, move latency and parent posting costs.
- [ ] Wire the reviewed game/reward path and prove complete legal play and payouts.

Checks represent achieved local/private-cloud evidence or explicit remaining work. Graceful same-process restart, adapted-fork withdrawal and seeded terminal challenge checks retain their stated boundaries. This is not a launch-date promise.

## Mainnet direction

The user requested Robinhood mainnet deployment after testing. No launch date is certified by these results. Historical d453/c03c failures and the stopped 48-edge trial remain preserved; its prover, fixture/private parent, observer and five auditors are stopped. Combined C now passes native equivalence and a full real-C **terminal-block diagnostic**, while one new four-hour-bounded exact-counter interpreter is **RUNNING_NOT_ACCEPTED**. No lifecycle has restarted and no raw step/BoLD geometry is accepted. The completed withdrawal and 32 GB production workers were removed after evidence preservation; only the temporary 128 GB allocation remains at USD 1.04/hour compute plus disk. Future-controller guard/refusal checks retain their narrow scope. Every build, engine test, replay, proof and deployment rehearsal runs on Runpod; local work remains editing, transfers, research and publication. [Selected machine and launch](mainnet/production/bounded-restore/scheduling/comparison/C-combined/machine-manifest.json) · [Diagnostic comparison](mainnet/diagnostics/aot-jit/evidence/combined-final/summary.json).

The new graceful restart and repeated native withdrawal results close bounded acceptance tasks. A pilot still needs matching production client/machine/genesis, full wrong-engine-result dispute, repaired late-state guest replay, production token/parent configuration, process-level recovery and long-history storage/resource bounds, reviewed fee/ETH reserve and validator/upgrade controls, and the applicable license path. The current proof path has not met the preferred 24 GB server target, and no complete all-in USD 100/month production configuration or 20-game capacity is accepted. Public receipts and working endpoints will establish a launch when it occurs.
