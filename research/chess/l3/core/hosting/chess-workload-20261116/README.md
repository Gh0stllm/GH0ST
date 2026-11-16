# Full-strength chess hosting measurement

Status: native full-strength workload measurement passed, 16 November 2026. The user selected the **full-strength chess engine**, not the small language-model demo, for this sizing decision.

The immutable workload is Stockfish 19 at commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, the complete 98,511,183-byte NNUE with SHA256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`, 24,000,000 target nodes per Black decision, Hash 128 MiB, one worker, skill20, strength limiting off, MultiPV1 and retained TT/search histories within each game. There is no smaller network, node reduction, time-limited substitute move or cross-game cache sharing.

The test executes every Black search in the two previously completed 24m-vs-48m games, retaining the actual game state and verifying every move, actual node count and completed depth against their published records. White's recorded moves are replayed; these are complete Black inference workloads, **not new adversarial games**. A separate exact retained-state save/restore probe measures recovery overhead. A clean loopback Nitro node can be co-hosted as a capacity screen.

Native engine execution beside a node is not on-chain chess. The existing ICP Wasm engine, native Stockfish proxy and standard L3 have separate runtimes. Stockfish has not been integrated into the L3 state transition/replay/fraud prover. Measurements of those available components cannot certify the memory or cost of an unimplemented fully on-chain L3 engine.

Peak resident memory is sampled over owned process trees and cross-checked with the operating system's lifetime peak. This Mac has24 GiB RAM; fitting a16 GB server requires a memory allowance for its OS, actual L3 execution/replay/proof path and backups. A low measured process peak is a capacity screen, not a rented16 GB Linux-host acceptance test or a provider latency guarantee.

Server research will distinguish verified monthly billing, setup fees, tax and IPv4 from promotional or long-commitment starting prices. Shared CPU can preserve a fixed-node result while taking longer; equal model strength does not prove equal speed or availability. No hosting order or public financial action is part of the measurement.


## Completed measurement

All **72 full-budget Black decisions** across both complete recorded game histories matched the previously published **move, actual node count and depth exactly**. Every decision reached at least24m nodes. These 72 decisions searched1,728,021,558 actual nodes. Five additional full24m searches passed the exact retained-state recovery test, including two restored future decisions, five corrupt/wrong-key rejection cases and a canonical new-game reset.

| Workload | Decisions / plies | OS lifetime peak RSS |
| --- | --- | ---: |
| Larsen history |32 Black decisions /65 plies |470.19 MiB |
| King-pawn history |40 Black decisions /81 plies |490.14 MiB |
| Exact-state checkpoint/recovery probe |5 full24m searches;163,086,838-byte checkpoint |1.46 GiB |
| Both histories + recovery concurrently, including harness |1290 process-tree samples,0.5s interval |**2.463 GiB sampled aggregate peak** |

The complete run took671.14seconds on the24 GiB AppleM5 host. Black decision p50 was16.47seconds, p95 was20.49seconds, range12.02–21.65seconds while the workloads ran concurrently. These are native local measurements, not cheap-server, Wasm, L3 receipt or proof-generation latency.

**16 GB is supported as a memory capacity screen for the unchanged native engine workload.**16 GB decimal is about14.90GiB, well above the observed2.463 GiB aggregate. The run did not enforce a16 GB OS limit, rent a16 GB Linux server, co-host Nitro, or execute the unimplemented L3 Stockfish state transition/replay/prover. Its conclusion is not an end-to-end public GL3 memory certification. The base node's separate179.25MiB result must not be silently added and called a tested complete deployment.

[Exact per-move results and identities](evidence/results.json) · [Memory samples](evidence/memory-samples.csv) · [Server comparison](HOSTING.md)

## Reproduce

Prepare the pinned official native Stockfish binary and the [retained checkpoint prototype](../../../../engine/prefix-cache/README.md), then run from the repository root on the tested macOS environment:

```sh
research/chess/benchmarks/.cache/venv/bin/python \
  research/chess/l3/core/hosting/chess-workload-20261116/profile_games.py
```

The source verifies the network, native binary, source commit and published game policies before execution, then verifies the outputs and records Darwin lifetime peaks plus sampled process-tree RSS. The installed `python-chess` manages MultiPV1 and Ponder=false through its play interface; the test configures the remaining fixed options once per game. Generated process logs and raw caches stay ignored. No engine source, search policy or running service was modified.
