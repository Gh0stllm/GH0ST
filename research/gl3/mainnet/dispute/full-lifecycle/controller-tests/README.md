# Future lifecycle controller · false-pass regressions

**Passed on Runpod Linux:** syntax checks, 72 unit regressions and the same 72 regressions with Python optimization enabled. Every subprocess has a recorded actual exit **0**. This verifies the future controller's pure acceptance predicates; it does not execute the engine, run a chain or establish a completed BoLD dispute.

The regressions reject changed native/engine sources, compiler settings and binaries during build reuse; stale fixture/audit reports; absent, skipped, failed or incomplete named tests despite exit zero; and missing or mismatched run, input, module, terminal-target, proof, confirmation and exact collateral-refund bindings. The accepted refund scope is confirmed-edge collateral, not withdrawal of rollup assertion stakes.

The future controller freezes its auditor and guard sources per fresh UUID run. Reuse requires a completed compiler manifest with exact compiled inputs and binary identity; older manifests without that success record require an explicit rebuild.

| Evidence | Result |
| --- | --- |
| [Syntax exit](evidence/syntax-exit.json) | Actual exit 0; controller was compiled for syntax only, never launched |
| [Unit log](evidence/unit.log) · [actual exit](evidence/unit-exit.json) | 72 passed |
| [Optimized unit log](evidence/optimized-unit.log) · [actual exit](evidence/optimized-unit-exit.json) | Same 72 passed under `python3 -O`; guards do not disappear with assertions disabled |
| [Source manifest](evidence/source-manifest.json) | Exact tested source SHA-256 values, Linux/Python versions and isolated directory |
| [Protected processes](evidence/protected-processes.json) | Prover 30481 and native fixture 39353 retained their original start identities; zero signals and zero active-case writes |
| [Remote controller exit](evidence/remote-controller-exit.json) · [bounded result](evidence/result.json) | Actual runner/helper exit 0; engine not executed |

Only `/root/lifecycle-controller-tests/9896c0bf6fcb47db9c6637faf2fd583a` was staged and tested. No file was uploaded to the active `/root/full-lifecycle` fixture, and no existing process was restarted or replaced.

To reproduce, stage `run-linux.py`, `acceptance_guards.py` and these two test scripts in a **fresh** subdirectory of `/root/lifecycle-controller-tests/`, then run `python3 <fresh-directory>/controller-tests/run-tests-linux.py` on the Runpod Linux worker. The verification runner refuses the Mac and refuses a directory outside that isolated test root.
