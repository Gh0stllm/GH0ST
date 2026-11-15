# Native Robinhood chess target

The user has selected **the game and engine natively in Solidity on Robinhood
Chain**, with 25,000 GH0ST entry and 100,000 GH0ST total payout for checkmating
the bot. Pool top-ups remain manual. No paid public launch or spending has been
performed by this research.

The additional [ICP comparison](icp-costs/) was requested after the native costs
were measured. It prices the already tested ICP mechanism and stronger search
budgets; it is an option under comparison, not approval to replace the native
target or spend existing project funds.

## Completed baseline finding

The corrected full-game baseline completed all six 12m-node White challenges
against 3m-node Black with per-decision cache clearing: five legal draws and one
White checkmate, after 195 plies in the Larsen opening. White never elected an
optional draw claim. Both independent python-chess and chess.js replays agree
with the completed results. The six 24m-node jobs were stopped unfinished to
prioritize a repair and contribute no wins or draws to the completed fraction.

The unchanged reference has a known winning transcript and is unsuitable for
automatic repeat prizes. Separate candidates test 10m-node defence and retaining
search state within one game. A changed early move is not proof of a fixed game;
the candidate must finish against the stronger challenger. Full results and
uncompleted records remain separate in the [benchmark evidence](benchmarks/results/).

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

## Measured native cost findings

At the saved 2026-11-15 fee snapshot of 0.02006 gwei:

| Component and evidence | Gas | Snapshot ETH |
|---|---:|---:|
| Lossless decoded weight data only, 1,172 shards; calculated creation total checked against local shard receipts | 24,743,045,945 | 0.49635 |
| Rules plus board write, third-party comparison across 43 plies; local receipts | 57,156–215,795 per move | about 0.00000115–0.00000433 |
| Dense evaluation alone, sixteen actual search vectors; local receipts | 702,424–742,525 per standalone transaction | about 0.00001409–0.00001490 |
| Repeating those sample costs for the 1,576,430 evaluations observed in one 3m-node reference search; conditional scenario | 1.107–1.171 trillion | 22.21–23.48 |

The last row is **not a measured complete move or a universal bound**. A real
batched engine could share or remove standalone transaction/calldata/model-copy
overhead; it also needs the missing board features and search/state operations.
The full-game price is unknown. The [reproducible scenario and exclusions](gas/playing-scenario.json)
make these assumptions explicit. Weight publication also excludes engine/catalog
code, alternative layouts and future fee changes.

The preferred kernels preserve exact upstream outputs. Packed dense arithmetic
and 16-lane accumulator updates improved the measured baseline; a second dense
variant was tested and rejected because it cost more on actual search samples.
Even after those changes, the current component approach does not establish an
economical native full-Stockfish product. Treat this as feasibility evidence
before committing funds or advertising a gameplay price.

## Before prizes

Finish the adversarial full-game sample, retain all PGNs and unfinished records,
and distinguish legal challenger checkmates from draws and resource stops. An
observed fraction in a deterministic opening suite is not a public win probability
or a guarantee about external engine assistance. Any changed GH0ST policy needs
separate matches and, if implemented on-chain, exact execution equivalence.

Because the reference search is deterministic, a known winning transcript could
be replayed against the same policy for further prizes. Finding even one such line
requires a policy repair and fresh full-game testing; a low suite-average mate
fraction does not make a published repeatable win safe for an open prize pool.

The native product additionally needs complete legal chess, exact evaluation and
search, transaction-bounded continuation, capacity and retry semantics, canonical
GH0ST custody/reservations and direct legally verified checkmate settlement.
Deployment gas and whole-game gas can be measured once those contracts execute.
Paid deployment/funding remains a separate reviewable step.
