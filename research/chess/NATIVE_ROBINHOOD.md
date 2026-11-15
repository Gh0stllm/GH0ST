# Native Robinhood chess target

The user has selected **the game and engine natively in Solidity on Robinhood
Chain**, with 25,000 GH0ST entry and 100,000 GH0ST total payout for checkmating
the bot. Pool top-ups remain manual. No paid public launch or spending has been
performed by this research.

## What is being tested

1. [Full games against stronger challengers](benchmarks/README.md) use an optimized
   native CPU proxy that first exactly matched the current full-network Stockfish
   19 / 3m-node configuration. Challengers receive larger node budgets and retain
   normal search caches. This measures the search policy's strength; it cannot
   establish the strength or correctness of an unfinished Solidity port.
2. [Native Solidity neural components](solidity-research/) measure actual Stockfish
   weights and integer arithmetic against upstream C++ traces, including packed
   alternatives. Component gas is separate from complete board evaluation, move
   generation, alpha-beta/quiescence search and persisted search state.
3. [Live Robinhood read-only gas/deployment research](gas/README.md) verifies
   chain identity, current fee information, per-transaction and code-size limits,
   representative shard estimates and lossless weight-publication arithmetic.
4. [Native rule-cost receipts](native-rules/README.md) measure a pinned third-party
   rules component plus state writes. This is a comparison with explicit rule
   omissions, not the production GH0ST game.

## Evidence boundary

The earlier [ICP implementation](engine/README.md) has real local execution
evidence, including a test-only exact continuation beyond one message's limit.
Its Wasm binary and compute counters do not translate directly into Solidity
deployment bytes or EVM gas. The 98,511,183-byte NNUE file is compressed; lossless
fixed-width parameter storage needs 115,114,528 bytes before engine/catalog code.

No complete native Solidity Stockfish engine currently exists in this repository.
There is no measured full-native deployment transaction set or complete game gas.
Weight deployment, native rules, dense arithmetic and the existing ICP-attested
reward vault are distinct components. No quote for one is a quote for the whole
requested product. Future full-search estimates must identify measured parts,
conditional extrapolations and missing costs separately.

The existing frontend and attested vault remain disabled staging. Their ICP
attestor path is preserved as prior work; it is not represented as native Solidity
search or used to bypass the user's new target.

## Before prizes

Finish the adversarial full-game sample, retain all PGNs and unfinished records,
and distinguish legal challenger checkmates from draws and resource stops. An
observed fraction in a deterministic opening suite is not a public win probability
or a guarantee about external engine assistance. Any changed GH0ST policy needs
separate matches and, if implemented on-chain, exact execution equivalence.

The native product additionally needs complete legal chess, exact evaluation and
search, transaction-bounded continuation, capacity and retry semantics, canonical
GH0ST custody/reservations and direct legally verified checkmate settlement.
Deployment gas and whole-game gas can be measured once those contracts execute.
Paid deployment/funding remains a separate reviewable step.
