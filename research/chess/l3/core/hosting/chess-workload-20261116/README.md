# Full-strength chess hosting measurement

Status: measurement in progress, 16 November 2026. The user selected the **full-strength chess engine**, not the small language-model demo, for this sizing decision.

The immutable workload is Stockfish 19 at commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, the complete 98,511,183-byte NNUE with SHA256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`, 24,000,000 target nodes per Black decision, Hash128 MiB, one worker, skill20, strength limiting off, MultiPV1 and retained TT/search histories within each game. There is no smaller network, node reduction, time-limited substitute move or cross-game cache sharing.

The test will execute every Black search in the two previously completed 24m-vs-48m games, retaining the actual game state and verifying every move, actual node count and completed depth against their published records. White's recorded moves are replayed; these are complete Black inference workloads, **not new adversarial games**. A separate exact retained-state save/restore probe measures recovery overhead. A clean loopback Nitro node can be co-hosted as a capacity screen.

Native engine execution beside a node is not on-chain chess. The existing ICP Wasm engine, native Stockfish proxy and standard L3 have separate runtimes. Stockfish has not been integrated into the L3 state transition/replay/fraud prover. Measurements of those available components cannot certify the memory or cost of an unimplemented fully on-chain L3 engine.

Peak resident memory will be sampled over owned process trees and cross-checked with the operating system's lifetime peak. This Mac has24GiB RAM; fitting a16GB server requires a memory allowance for its OS, actual L3 execution/replay/proof path and backups. A low measured process peak is a capacity screen, not a rented16GB Linux-host acceptance test or a provider latency guarantee.

Server research will distinguish verified monthly billing, setup fees, tax and IPv4 from promotional or long-commitment starting prices. Shared CPU can preserve a fixed-node result while taking longer; equal model strength does not prove equal speed or availability. No hosting order or public financial action is part of the measurement.
