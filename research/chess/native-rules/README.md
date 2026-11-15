# Native Solidity rule-cost comparison

This is an isolated local EVM measurement of a pinned third-party move verifier
and a small state-writing wrapper. **It is not the GH0ST Stockfish engine, a
complete FIDE implementation, or the production prize contract.** No public
deployment, wallet signing, funding, entry fee or reward occurs here.

The unchanged [ChessFish MoveVerification source](vendor/MoveVerification.sol)
comes from [commit 97f9a0e8579da597fe07a71b5a7419ae76899249](https://github.com/Chess-Fish/v1-core/blob/97f9a0e8579da597fe07a71b5a7419ae76899249/contracts/MoveVerification.sol),
Git blob `61cc22012af502e56a4b52a298f74bd071ef27c9`, under its MIT license and
preserved author notices. The source imports OpenZeppelin Math but uses only
`uint256 min/max`; the compilation supplies the explicitly documented local
[two-function stand-in](contracts/BenchmarkMath.sol). This comparison does not
claim an audit of the upstream rules.

## Measured local receipts

Solidity 0.8.30, optimizer 200, viaIR, Shanghai EVM, isolated chain 31337:

| Component | Receipt gas |
|---|---:|
| Move verifier deployment, 12,668-byte runtime | 2,792,775 |
| Per-game wrapper deployment, 1,317-byte runtime | 388,236 |
| One move, including legality, endgame check and stored board | 57,156–215,795 |
| Mean across the 43 tested plies | 71,005 |

The wrapper uses an external call to the verifier and records board, castling/
en-passant state, turn, ply count and result. These costs exclude bot search,
neural inference, GH0ST approval/entry/reward handling, production game metadata,
search checkpoints and Robinhood parent-chain data fees. They cannot be summed
into an exact full-game quote without implementing the actual game/engine.

[results.json](results.json) contains **50 local transaction receipts**: seven
deployments and 43 played plies. Every resulting board and turn matched the
independent pinned `chess.js` reference. Cases cover legal White/Black checkmates,
both castlings, en passant and both queen promotions. An illegal opening pawn
move was rejected. This sample is not exhaustive rule validation.

The upstream code autoqueens and does not implement underpromotion. This wrapper
also has no threefold/50-move claim journal, player authentication, concurrent-game
storage, chess search or escrow. Those limitations prevent production use as the
requested GH0ST challenge. Its role here is to measure a concrete native rules
component independently of the much larger Stockfish search cost.

Run from `research/chess` after installing the project lockfile dependencies:

```sh
node native-rules/benchmark.mjs
```

The command checks the exact upstream blob, compiles locally, creates an in-process
Ganache chain with artificial funds, verifies each board against `chess.js`, saves
receipts, and closes the provider. It has no public RPC endpoint or deployment key.
