# Exact prefix checkpoint prototype

This is **isolated research**, not an installed cache or a funded twenty-game service. The deployed `725dc0…f417b` engine, all existing canister source, contracts, identities and balances were untouched.

The prototype retains the complete Stockfish19 model,24m nodes,Hash128,one thread,maximum skill and per-game search state. It reuses a completed decision only when exact code/model/policy, full move prefix and incoming retained-state digest match. A board FEN or stored best move is insufficient. [`fen-counterexample.json`](evidence/fen-counterexample.json) gives two legal histories with the same full FEN and different prefix keys.

## What passed

[`native-equivalence.json`](evidence/native-equivalence.json) records a **163,086,838-byte** checkpoint after the standard-position `e2e4` search. The cached response is `e7e5 /24,000,033nodes /depth38`. Restoring into an independent engine reproduced the full retained-state SHA256 and then two consecutive native24m searches exactly:

| Future prefix | Best move | Actual nodes | Depth | Retained state |
| --- | --- | ---: | ---: | --- |
| `e4 e5 Nf3` | `Nc6` |24,000,311|39|Identical SHA256|
| `e4 e5 Nf3 Nc6 Bb5` | `Nf6` |24,000,558|37|Identical SHA256|

Five corruption/truncation/trailing-data/wrong-prefix/wrong-incoming-state cases failed before a retained byte changed. Saving took0.311s and restoration0.607s versus15.229s for the first native search on this host. **Native times are not ICP move times.** Five full searches ran: one initial search and two future decisions on each of the original and restored engines. After play, both new-game resets returned exactly to the original incoming retained-state digest.

The serializer accounts for every TT cluster and its five-bit generation, all local and shared histories including logical atomic values, correction history, Finny caches, and retained manager fields. New-game `Worker::clear()` already resets Finny caches, so matching first prefixes have canonical initial retained state. Scratch root moves, root/state pointers, recursive stacks, accumulator scratch, per-search counters and callback objects are rebuilt at the exact upstream boundary. No pointer, principal, game ID, authorization state, callback or canister journal is restored.

[`pocketic-synthetic-cost.json`](evidence/pocketic-synthetic-cost.json) separately executes **synthetic stable-memory snapshot reads, SHA256 checks and live copies** on a13-node local IC subnet:

- 160MiB snapshot seeding/debit:16,965,464,703cycles.
- 160MiB restore with two SHA256 passes:27,490,811,176cycles; repeated warm restore27,490,810,659.
- Corrupt stored data is rejected before the live copy; the live buffer remains intact.

The sampled restore used about27.484B instructions and fits40B by itself. **Do not append a28B search slice or an additional full-state hash to that same message.** A real implementation needs separate bounded checkpoint/restore phases and actual full-engine IC equality tests. This synthetic module contains no Stockfish and does not establish the complete cost of a production serializer.

## Why raw checkpoints do not guarantee twenty games under100ICP

Repeated first prefixes can skip expensive searches. A new human branch still requires the full search. Current per-turn verification and two threshold signatures remain payable even on a hypothetical free-search hit. A small opening book therefore cannot substantiate twenty arbitrary games within100ICP.

The [v3 certificate and native auto-reply proposal](CACHE_CERTIFICATE.md) removes ICP move/signature work on already certified prefixes. It is a more useful next architecture, but requires a new reviewed contract and API. It is not supported by the immutable deployed game.

## Reproduce

From `research/chess`:

```sh
python3 engine/prefix-cache/build_native.py
engine/.cache/prefix-cache-native/src/stockfish 24000000
engine/.cache/venv/bin/python engine/prefix-cache/build_cost.py
engine/.cache/venv/bin/python engine/prefix-cache/test_cost.py
node engine/prefix-cache/budget.mjs
```

Native build uses a separate source copy plus test-only friend access and exception-based validation. It cannot be deployed as a canister. The native64 little-endian encoding binds the exact executable SHA256; an IC implementation needs its own Wasm layout/schema binding and full restored-search equivalence proof. This test restores only into the matching incoming engine state. Authenticated direct restore into an arbitrary idle game engine is a required production test, not a completed capability. Large binaries, model files and captured snapshots remain under the ignored cache.

The synthetic `seed`, `corrupt` and `restore` endpoints are intentionally unrestricted cost probes. **Never deploy that test module as the game engine.** All owned test processes were stopped after completion. No production integration or mainnet action occurred in this lane.
