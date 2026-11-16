# Chess without a single blocking search

Active implementation: preserve the full24m-node policy while committing a suspended search across small GL3 transactions. This lane is **not deployed** and has not yet passed the on-chain cadence/proof gates.

The full pinned Stockfish19 network, Hash128 MiB, one worker, skill20 and retained per-game state stay unchanged. The scheduling quantum is2,048 nodes; it does not reduce the24,000,000-node target. An unfinished search has no playable result. No external engine result is accepted.

Binaryen Asyncify turns the recursive search into a portable continuation. Its spill stack, engine stack, heap and mutable Wasm globals belong to the durable job state. Restoring a fresh instance must produce the same move, actual node count, depth and all163,085,439 canonical retained-state bytes as the monolithic reference.

## Acceptance gates

- [x] Isolated continuation module builds without modifying the old full-replay run.
- [ ] Consecutive complete24m searches match exact canonical checkpoints.
- [ ] A fresh instance resumes suspended recursion with identical results.
- [ ] GL3 commits bounded chunks and services ordinary transactions during a search.
- [ ] Retry, rollback, conflicting input, restart and corrupted snapshot rejection pass.
- [ ] Matching direct Wasm replay and Solidity proof witnesses pass.
- [ ] Measured cadence, storage growth and move latency fit the selected host.

The100 ms base block target is a measurement goal. Short engine calls alone do not prove it: snapshot persistence, model initialization, completion and cold recovery also need to fit. No latency or hosting claim is promoted before those costs are measured.
