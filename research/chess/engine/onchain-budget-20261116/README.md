# Fully onchain chess under 100 ICP

Checked 16 November 2026 IST. **No tested design yet establishes twenty independent normal games within the 100 ICP total cap while preserving the reviewed bot.** The bot remains Stockfish 19 with the full 98,511,183-byte NNUE, 24 million nodes per move, Hash128, Threads1, maximum skill and retained per-game state. No paid entry, deployment, funding or weaker engine was enabled.

## Measured cost and required improvement

The freshly certified CMC rate is **1 ICP = 1.6124 trillion cycles**, timestamp 15 November 2026 18:54 UTC, or 16 November 00:24 IST. The certificate, hash-tree witness and exact returned rate leaf were verified against the SDK-pinned mainnet root. The representative saved local actual-IC search consumes 972.755 billion cycles. Position-dependent work and live-network latency remain unmeasured.

| Twenty-game scenario | Engine search only | Existing engine and orchestration |
|---|---:|---:|
| 40 Black decisions per game | 482.64 ICP | 517.09 ICP |
| 80 Black decisions per game | 965.27 ICP | 1,034.18 ICP |

These scenarios repeat the measured representative workload; they are neither full-game observations nor universal bounds. Even eliminating every cross-chain cost would require an additional **89.64% reduction in engine cost** for the 80-decision scenario before installation, storage, reserves and fees. The existing 13 ICP was converted into service balances, not all burned; count its useful cycles once rather than adding 13 ICP again to their consumption.

Current official [cycle charges](https://docs.internetcomputer.org/references/cycle-costs/) still charge one cycle per Wasm32 instruction. Wasm64 and the inspected public seven-node subnet do not provide a verified order-of-magnitude discount. Moving only game transactions to an L3 leaves this engine cost in place.

## New exact computation measurements

The [affine-input memoization probe](../exact-savings-20261116/README.md) computed every original NNUE evaluation and compared exact transformed inputs. At 400,080 test nodes, reference and instrumented searches matched the move, score, depth and complete principal variation. Only 260 of 209,226 evaluations reused the same full affine input, a **0.12427%** hit rate. This bounded result does not justify promoting the cache or projecting a large saving.

Exact full-state prefix caching remains useful for repeated complete histories, but players can select uncached moves. The earlier roughly 82 ICP shared-path scenario does not establish capacity for twenty independent games.

## Custom query quorum experiment

A possible alternative executes deterministic chunks on ICP nodes as queries, gathers matching authenticated replies from nine distinct members of the thirteen-node subnet, then verifies and commits exact state changes in an update. The transport performs no chess computation. This is an application-level quorum construction with consensus commits, **not standard consensus execution of the entire search**. Its security, membership rotation, code epochs, state availability and liveness require separate review.

The [official query signature format](https://docs.internetcomputer.org/references/ic-interface-spec/https-interface/#request-query-call) binds the response, timestamp and full request ID to a node key authenticated by subnet certificates. In a live **read-only light-query test**, the public gateway returned matching replies to one nonce-bearing request from **nine distinct authenticated current subnet members**. No engine search or quorum-committing update ran. [Raw transport evidence](public-query-probe.json).

The [local verifier prototype](../quorum-query-20261116/README.md) passes twenty security tests using synthetic Ed25519 keys, covering duplicate/unknown signers, altered requests/replies, stale epochs, replay and invalid patches. It has no production certificate importer or canister integration and is explicitly blocked from production use.

The [query instruction limit](https://docs.internetcomputer.org/references/resource-limits/) is five billion instructions. Allowing one billion for serialization and hashing leaves four billion for engine work, or about **244 sequential chunks per representative search**. Queries discard their memory changes, so the exact live search state must be committed between chunks.

An exact lossless retained-state probe produced **793,461 compressed bytes** after a 100,066-node test search, and **885,666 bytes** between independently completed 100k and 200k prefix states. Those checkpoints omit live recursive/Asyncify stacks and are not measured query continuations; completed-search bookkeeping also differs. They are indicators, not compression lower bounds.

If the first payload were representative, ingress reception alone at 2,000 cycles per byte would cost about **384.23 ICP** across twenty 80-decision games and 244 commits per decision. This explicitly hypothetical substitution excludes verification, capture/restore, orchestration and hosting. It prevents treating free queries as a demonstrated cheap solution. A substantially smaller real continuation format and a metered verifier would be required.

## Decision

Keep the existing game paused and the 100 ICP cap intact. Neither smaller networks/nodes, hosted inference, uncertified single-node queries nor repeated-game cache assumptions satisfy this requirement. The only new architectural candidate identified is the custom query quorum, and its measured state-transfer indicators are currently too large to qualify it.

No additional ICP was converted, ETH spent, GH0ST moved or service deployed. A funded twenty-game launch is **not established**. Further work must first demonstrate a genuine mid-search continuation, nine-node computation, certified membership verification, exact consecutive-search parity, actual cycle/latency measurements and an end-to-end budget with operating headroom.

## Reproduce

```sh
node research/chess/engine/quorum-query-20261116/test.mjs
node research/chess/engine/onchain-budget-20261116/analyze.mjs
```

`report.json` records input hashes and distinguishes measurements from assumptions. The public routing script performs only a read-only unknown-job query; it cannot deploy, start a search or convert funds. Its result demonstrates a transport primitive, not affordable chess execution.
