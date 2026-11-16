# GL3 · custom-machine challenge checks

[Acceptance notebook](../README.md) · [Captured terminal block](../production/TERMINAL.md)

**The terminal challenge-manager regression passed. A complete incorrect-engine-result BoLD dispute remains open.**

Five authentic witnesses from the independently completed next recorded block pass the pinned inherited `EdgeChallengeManager.confirmEdgeByOneStepProof` path. The expected edge becomes confirmed, its conflicting rival remains pending and cannot replace it, and all35negative checks reject through contract execution. These cover incorrect terminal claims, altered witnesses, wrong prestates/configuration/history and repeated confirmation.

The harness seeds ancestor edges, history siblings and predecessor configuration. It therefore exercises the real final challenge path and real one-step verifier; it does not establish full assertion creation, automatic history bisection, stake settlement or assertion confirmation.

## Final-block replay failed; acceptance remains blocked

The captured last-compute block failed independent replay under machine root `0xd45324627b0b3118dfdf1ad585769024cfa6008da8cdcaa745de32edc724613b`. The actual process exited 1 after 2,153.85 seconds, without a timeout. The WASM32 guest exhausted its roughly 4 GB heap while restoring historical delta code through `StateDB.GetCode`: 4,223,369,216 bytes were in use when another 4,194,304-byte allocation failed. The machine ended errored and did not match the expected four-field result. The host had 128 GB; this was not host memory exhaustion.

[Exact result](evidence/terminal-wavm-failure/replay-result.json) · [Classification](evidence/terminal-wavm-failure/failure-classification.json) · [Exit](evidence/terminal-wavm-failure/exit.json) · [Full compressed log](evidence/terminal-wavm-failure/prover.log.gz).

The native full decision and its recording passed, but that does not accept this guest module for production. A cache-only historical-read fix is under development with a new machine root and fresh regressions required. No engine setting or network is changed. The older first/next-block passes do not supersede this late-state failure.

## Reproduction and source locks

All compilation and tests run on Linux Runpod workers. The actual five-case run is preserved in [frozen/next-block/run.mjs](frozen/next-block/run.mjs) with its exact harness and [report](evidence/terminal-report.json). The report's runner/harness digests match those preserved files. Dependencies and original Solidity sources are checked against the pinned contract compilation manifest; the source compiler is exactly0.8.17. The underlying one-step verifier artifacts retain their recorded SHA-256 values.

The general runner separately passed the actual BoLD start boundary through the manager and verifier with seven negative checks; its backend output remains distinct from the subsequent Solidity report. `probe-boundary.go` uses the real pinned Arbitrator machine loader and the BoLD one-step offset. `replay-terminal.py` runs one captured block which completes the unchanged search; it must match all four expected global-state fields and return a real successful process exit. It is not an interpreter replay of all2,464compute transactions or a completed dispute. `probe-execution.go` is an unexecuted API prototype, not an accepted test.

No public contract or real token is involved in these checks. Engine network, node count, search settings and retained state policy remain unchanged.
