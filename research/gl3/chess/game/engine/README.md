# A14 Stockfish game admission

`stage_overlay.py` writes two Go sources to a fresh directory. It accepts
only the pinned `ArbGhostChessSlices.go` source with SHA-256
`43196fa745e0a7cbb03cc02c8a88a7747c654be156ac4345073e8030d9d99cd2`.
The output belongs in the Nitro `precompiles` package of both matching
execution and proof builds. The original A14 source and evidence stay in
their original checkout.

```sh
python3 stage_overlay.py /path/to/ArbGhostChessSlices.go /path/to/new-source-overlay
```

| A14 method | Role |
| --- | --- |
| `gameCoordinator()` | Return the contract authorized to reserve the engine or the zero address before configuration. |
| `engineStatus()` | Read the module SHA-256 and seed root from validated A14 metadata. `seedAvailable` also requires the sealed runtime profile. |
| `setGameCoordinator(address)` | Chain owners may authorize one deployed contract or revoke with zero while the engine has no active reservation. |

The registered coordinator is the immediate caller of `newGame`, `begin`,
`advance`, `inspect` and `releaseGame`. Job namespaces remain derived from
that caller and the job ID. `newGame` requires the registered coordinator,
a sealed profile, and valid initial seed metadata. The other search methods
keep their existing ABI and execution behavior.

The [activation candidate](ACTIVATION.md) stages a separate Nitro and Geth
profile which keeps A14 out of historical blocks. The [seed migration](SEED-MIGRATION.md)
installs the exact initialized engine after activation. The same unchanged
Stockfish module is used for native execution and proving.

```sh
python3 research/gl3/chess/build_replay.py --sliced --game-coordinator --candidate-arbos-version 62
```

The candidate source has no scheduled activation. Compilation, replay over
the upgrade boundary and approval of a matching production proof root remain
open. See the [mainnet observation and handoff constraints](MAINNET.md).
