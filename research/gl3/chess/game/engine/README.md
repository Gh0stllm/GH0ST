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

The pinned seed is currently installed by the A14 genesis importer. A live
GL3 upgrade needs a deterministic way to install that same seed while
preserving the chain's existing state. This overlay has no seed installer,
activation height, or proof-machine update. Generating these sources does
not change the live chain.
