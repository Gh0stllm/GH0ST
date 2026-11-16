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
- [ ] Complete native GH0ST child burn and confirmed parent withdrawal (the real-token bridge unit uses a test-confirmed root).
- [ ] Complete the original monolithic24m-move WAVM reference; the incomplete local run was stopped when the user moved all tests to Runpod.
- [ ] Execute a complete incorrect-result dispute through the actual challenge contracts.
- [ ] Measure actual end-to-end memory, disk growth, move latency and parent posting costs.
- [ ] Wire the reviewed game/reward path and prove complete legal play and payouts.

Checks represent achieved local evidence or explicit remaining work. This is not a launch-date promise.

## Mainnet direction

The user requested Robinhood mainnet deployment after testing. The working planning estimate for a restricted pilot is3–7 days, conditional on the remaining gates; it is not a launch commitment. The temporary Linux workers are for testing and are not a permanent hosting selection. The paired 64 GB experiment exceeded its memory limit; a single next-block proof completed separately on 128 GB, peaking at 39.05 GB of cgroup memory. The preferred 24 GB production target remains unaccepted. Those disposable test workers have been removed. Every further build, engine test, replay, proof and deployment rehearsal runs on Runpod. Local work is limited to editing, transfers, research and publication.

A pilot still needs an accepted Linux image and matching genesis/module root, long-history cold recovery and storage bounds, reviewed GH0ST deposits/withdrawals and fee pricing, validator/upgrade controls, a complete deliberately incorrect-result dispute rehearsal, verified parent compatibility and the applicable license path. Passing one replay is one gate. Public receipts and working endpoints will establish a launch when it actually happens.
