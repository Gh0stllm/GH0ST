# Host counter CLI smoke

The separately built host tool has SHA-256 `cc5c9de07b2a739978e383cd4ac4baee3a1d49761c5c75ad414e12056cd7ab27`. `host-cli.patch` adds only a final `mach.get_steps()` print; the original `/root/prover` stayed unchanged.

`result.json` is the earlier build/`--help` receipt and correctly records that no step execution had occurred at that moment. The subsequent `counter-smoke.json` and raw log record a real, successful **7-step tiny-WASM** run, with 7 per-step witnesses plus the finished state. Its module, witness output and SHA-256 member manifest are retained here.

No chess engine ran in this smoke. It does not supply the terminal chess replay's final step count or accept a one-step proof/lifecycle; those require the later bounded interpreter run and protocol gates.
