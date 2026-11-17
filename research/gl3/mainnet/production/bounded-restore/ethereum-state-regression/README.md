# Selected code-cache repair · upstream state regression

The selected C native tree passes the **complete non-short `core/state` package invocation** on the Linux Runpod worker, with actual process exit **0**. This includes the three GL3 code-cache tests and upstream dirty-state, copy, journal, commit and revert checks.

| Observation | Result |
| --- | --- |
| Named test/subtest pass events | 70 |
| Top-level pass events, including the fuzz seed harness | 65 |
| Skipped test | `TestStateChanges` (upstream Arbitrum unsupported-operation skip; retained in the JSON log) |
| Fail events | 0 |
| Direct child elapsed time | 6.001 seconds |
| Required source/module identities unchanged | Yes |
| Execution location | Runpod; Go parallelism capped at 2 |

[Exact command and before hashes](evidence/process.json) · [Direct child exit](evidence/exit.json) · [Result and named cases](evidence/result.json) · [Complete JSON event log](evidence/go-test.jsonl) · [Reproducer](run-linux.py)

The test uses `-count=1`, no `-short`, and `-mod=readonly`. It executes every ordinary test and built-in fuzz seed in this package that the upstream suite does not skip. It is not a fuzz campaign, the full Geth suite, an engine replay, separate-process node crash recovery, or proof/mainnet acceptance. No selected source, engine, machine, model or search setting was modified.
