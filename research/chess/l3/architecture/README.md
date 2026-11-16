# GH0ST L3 engineering and launch requirements

The proposed chain settles on Robinhood Chain, uses GH0ST as native gas, and executes the unchanged chess engine as part of its deterministic state transition. **This is a design specification. No deployable custom engine, matching fraud prover or twenty-game budget proof exists yet.** Renting a server does not complete those components.

[`manifest.json`](manifest.json) pins the existing engine policy and leaves every production gate closed. It approves no server order, bond, transaction or token movement. The existing 100 ICP total cap, 0.003 ETH cap and fixed 1,000,000 GH0ST prize remain constraints.

## Architecture

| Component | Required behavior |
|---|---|
| Robinhood parent, chain 4663 | Stores rollup commitments, data and settlement contracts; batch posting still needs parent ETH. |
| GH0ST L3 sequencer and batch poster | Orders messages and posts compressed data. Its stock Nitro image can support a basic chain rehearsal but cannot execute the selected Stockfish module unchanged. |
| Custom chess state transition | Executes the full engine in deterministic, resumable work units. Native execution, independent replay and the fraud prover must agree on the same state transitions. |
| Validator and prover | Replays the chain, checks assertions and can defend/challenge them. The selected rehearsal may colocate these roles on one server. A separate failure domain is recommended for a public service; it is not asserted here as a protocol minimum. |
| Parent prize escrow | Proposed new Robinhood escrow accepts authenticated finalized L3 outbox messages. A raw RPC result or operator signature alone cannot release the reward. |

The existing immutable Robinhood chess contract implements a different ICP-signed-move design; it is not automatically an L3 settlement escrow. The exact entry-payment, bridge, child gas-funding and refund flow must be reviewed before implementing the replacement. Entry remains 25,000 GH0ST and a verified human checkmate pays the fixed total 1,000,000 GH0ST. Do not charge the entry twice or count bridged and unbridged tokens as two reserves.

The initial topology is one reliable server containing sequencer, batch-poster and validator/prover roles. It is not high availability: a host failure can interrupt every colocated role. The launch review must disclose this topology and its outage/refund behavior. A second independent validator host would improve public-service failure isolation, but this recommendation does not authorize an additional purchase.

Rollup data availability is the initial proposal because it does not require an additional AnyTrust committee. GH0ST native gas does not pay the server provider or remove parent ETH costs. Robinhood is absent from the current canonical factory table; the documented self-deployed factory route is unsupported. Confirm the exact deployment/support and licensing path before mainnet work. [Factory contracts](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts), [custom gas](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-rollup).

## Engine policy and implementation

The policy is Stockfish 19 commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`, full 98,511,183-byte NNUE with SHA256 `1a298aa575a085434d29027978dc36867fe9c5bcea9376654b7a8eba1e52dfc2`, 24 million nodes per Black decision, Hash128, Threads1, Skill20, no strength limit, MultiPV1, and retained TT and all search histories within each game. An explicit new-game reset is separate from a process restart.

The existing 103,089,852-byte ICP Wasm has SHA256 `725dc0c795262be21f1ffafec60f50aae3e9d00140add77e791a89eece0f417b`. Its ICP host calls and metering do not make it an L3 artifact. The manifest intentionally leaves the L3 executable hash, prover Wasm hash, module root and genesis commitment unset.

Genesis, admission and payout must bind the same policy and code epoch. An engine-policy upgrade cannot change an active game's search or remove the ability to replay its old history. The chain upgrade procedure, controller custody and retained artifact availability remain review items.

Standard Stylus code-size and SIMD defaults do not accept this engine unchanged. Raising a memory or gas setting alone is insufficient. The custom implementation must commit or deterministically reconstruct every future-affecting field: board and complete repetition history, root search state and recursive continuation, TT entries/generation, correction and continuation histories, NNUE accumulators/caches, counters and search-manager state. Private mutable server RAM cannot be the only copy of that state.

First implement a small deterministic custom transition and its matching fraud proof. Demonstrate that an intentionally wrong output loses a local challenge. Then integrate the complete engine with bounded continuations. Engine work remains node-based; a wall-clock timeout must fault/refund rather than return a weaker partial search. The state transition cannot call an external engine process or network API. [Custom execution and proving requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).

## Gates before spending and paid games

1. Resolve the Robinhood factory/support route, native gas-token compatibility and licensing.
2. Pin reproducible custom node, replay/prover and model artifacts. Validate the toy correct/incorrect challenge first.
3. Prove complete retained-state continuation and consecutive full-budget engine parity. Run complete games through native and replay paths; exercise corruption, restarts and stale continuations.
4. Test the new parent escrow, bridge accounting, authenticated outbox sender/child chain, finality, payout and refunds. No prize can depend only on sequencer confirmation.
5. Complete at least twenty normal-game workloads under the unchanged policy. The existing planning assumption is 80 Black decisions per game, not a universal maximum. Measure node/prover CPU, memory, disk growth, latency, settlement gas and operating headroom before claiming capacity or a 100 ICP total.
6. Review exact server, bond and deployment funding. Current SDK v3.2 defaults to a separate WETH stake token and base stake of 1 WETH; these are configurable defaults, not a universal minimum. GH0ST gas does not automatically set the bond currency. A lower/custom bond needs a security/economic review and explicit funding authorization, and cannot silently use the prize pool. [SDK defaults](https://github.com/OffchainLabs/arbitrum-chain-sdk/blob/main/src/createRollupPrepareDeploymentParamsConfig/v3.2.ts), [bond configuration](https://developer.arbitrum.io/launch-arbitrum-chain/chain-config/validation/bond-and-validator).
7. Review the availability, failure and refund model; rehearse an offsite restore and monitor the selected topology. An independent validator failure domain is recommended for public service. Keep state, RPC and an adequately funded prover/validator available through final assertion confirmation and disputes, including after the last game. Complete a closed, receipt-backed pilot before accepting an entry fee.

Permissioned validation can be reviewed as a separate custom-chain proposal, with named operators and explicit trust assumptions. It is unselected and disabled here. Do not silently substitute it, lower the bond, choose a custom bond token or enable fast confirmation to fit the budget. Those changes require their own security and funding review; none preserves the original assumptions merely because the chess search is unchanged. [BoLD deployment guidance](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/validation/bold).

The launch gate is conjunctive: every required item needs its own evidence. A generic running Nitro container, a healthy server, a legal chess move, or a fast native Stockfish benchmark alone cannot establish a fully verified onchain game.
