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

The native candidate has compiled and [replayed to the live safe head](FOLLOWER.md).
The corresponding [proof machine](proof-machine-evidence-20261118.json)
was assembled from that same source and pinned Stockfish image on the
same pod. The candidate module root is
`0x3fa7c973679f26bb83505afe1ee0b7509c354e9b3ddc3ef95ac43584683787a7`.
The native binary, replay and machine assets were saved in a separate
persistent directory and checked against their SHA-256 digests.

Replay across the activation boundary and coordinated activation remain
open. See the [live handoff and production proof limits](MAINNET.md).

The [read-only follower](FOLLOWER.md) replays existing GL3 batches while the
production sequencer continues to serve the chain.
