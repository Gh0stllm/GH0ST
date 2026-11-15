# Robinhood-native cost research

**No full Stockfish-in-Solidity engine exists in this project yet.** The native
match results measure the pinned Stockfish search configuration. The earlier ICP
port is separate. Depositing weights in EVM code is not a completed Solidity port,
and the existing reward-vault costs below do not include chess computation.

Everything here is read-only RPC, isolated local EVM receipts, or clearly labeled
arithmetic. No public transaction was broadcast and no funds were moved.

## Current Robinhood limits and fees

[The mainnet snapshot](mainnet-snapshot.json) first verifies chain **4663**, then
reads block and ArbGasInfo values. At block **114,805,674** on **2026-11-15
07:45:53 UTC**, the observed gas price was **0.02006 gwei**. `getMaxTxGasLimit()`
returned **32,000,000 gas** and the pricing speed target was **7,000,000 gas/s**.
The header's `gasLimit = 2^50` is not the per-transaction limit.

Robinhood's [official size documentation](https://docs.robinhood.com/chain/differences-from-ethereum/)
allows **96 KiB runtime** and **192 KiB initcode**. Our read-only RPC creation
simulation accepted a 98,304-byte runtime and rejected 98,305 bytes. The 96 KiB
representative data shard was estimated at **21,495,851 gas**, within the observed
transaction cap. See [complete estimates](shard-mainnet-estimates.json).

The [official fee documentation](https://docs.robinhood.com/chain/gas-and-fees/)
states that normal gas estimates already combine execution and parent data costs.
We also queried [NodeInterface's components](https://docs.arbitrum.io/arbitrum-essentials/nodeinterface/reference).
Its parent-fee component was **zero in these calls**. This is a current observation,
not a permanent promise. Do not add a separate parent charge to an estimate that
already includes it. Per-case estimates retain their own observed base fee.

## Publishing the neural weights

The full official NNUE file is **98,511,183 bytes**, stored in compressed LEB128
form. One possible data-only layout stores a STOP byte followed by up to **98,303
payload bytes** per immutable code shard. This would require **1,003 shards** for
the compressed file. Solidity would still need a correct decoder and engine.

[weight-deployment.json](weight-deployment.json) counts every actual NNUE byte,
verifies its SHA-256, and sums the minimal creation transaction costs for all
shards. Its Shanghai arithmetic exactly matched two fresh isolated deployment
receipts, at 24 KiB and 96 KiB runtime sizes.

| Data representation | Shards | Gas basis | ETH at the snapshot |
|---|---:|---:|---:|
| Original compressed NNUE file | 1,003 | 21,261,994,273, calculated Shanghai total | 0.426515605 |
| Fixed-width decoded parameters, 115,114,528 bytes | 1,172 | 24,743,045,945, calculated Shanghai total | 0.496345502 |

Both rows include contract-creation intrinsic gas, actual zero/nonzero input
bytes, initcode metering, constructor copying/memory, and 200 gas per runtime byte.
The raw-parameter counts come from the separate [source-verified extraction](../solidity-research/network-layout.json):
19,556,239 zero bytes and 95,558,289 nonzero bytes after lossless LEB128 decoding.
Its code-deposit-only floor is 23,023,140,000 gas (0.461844188 ETH at this snapshot).
The full fixed-width row assumes that raw layout; a different packed/SWAR layout
requires its own byte counts and can have a different storage cost.

Neither row is a quote for deploying the complete bot. Exclusions include the
search/rules engine, shard catalogs/hashes, decoding or alternative weight layout,
state setup, Nitro estimate padding, and any future nonzero parent fee. Bulk
publication can itself change gas pricing; a snapshot multiplication is not a
fixed-price quote for over a thousand future transactions. The observed pricing
speed target is a fee-control parameter, not a guaranteed deployment time.

For scale only, a supplied ETH/USD tool quote of **$1,777.09** around **07:48 UTC**
on 2026-11-15 converts the compressed-file row to about **$758**, and the raw
fixed-width row to about **$882**. ETH is the primary estimate; USD moves with
the market and these are data-storage costs only.

## Existing reward vault: separate legacy comparison

The current `RHChessChallengeVault` verifies an ICP attestor. Its fresh [local
receipt measurements](local-gas-receipts.json) and [read-only mainnet estimates](legacy-vault-mainnet-estimates.json)
are useful payment overhead references, **not native engine gameplay costs**.

| Action | Measured or estimated gas | Evidence |
|---|---:|---|
| Existing attested vault deployment | 1,573,283 | RH NodeInterface estimate; 0.000031616695168 ETH at its returned fee |
| Canonical GH0ST exact 25,000 approval | 46,355 | RH NodeInterface estimate; 0.00000093210634 ETH at its returned fee |
| Entry plus 100,000 prize reservation | 212,615 | Local EVM receipt, normal-mode hostile-token fixture |
| Signed human-checkmate settlement | 86,356 | Local EVM receipt, same mock token |
| Signed loss/draw settlement | 69,484 | Local EVM receipt, same mock token |
| Signed service-fault entry refund | 86,381 | Local EVM receipt, same mock token |

The mock token has extra hostile-token controls even when those controls are off;
its transfer/approval gas is not the canonical GH0ST gas. The local chain uses
Shanghai execution and enlarged-code switches only to test data-shard arithmetic.
Actual Robinhood size acceptance and fee estimates were checked separately by RPC.

## Native legal-move component comparison

The separate [native-rules benchmark](../native-rules/results.json) measures a
pinned third-party ChessFish move verifier and a small local rule-cost wrapper.
It cross-checks 43 plies, including both colors' mates, castling, en passant and
automatic queen promotion. Its **local** receipt costs are:

| Comparison component | Local gas |
|---|---:|
| Third-party move verifier deployment, 12,668-byte runtime | 2,792,775 |
| Per-game rule-cost wrapper deployment | 388,236 |
| Submitted legal move, observed range | 57,156–215,795 |
| Submitted legal move, mean of the tested plies | 71,005 |

This is a rules-cost component comparison, not GH0ST's completed engine, full FIDE
adjudication, escrow, neural evaluation or search. Those move costs cannot be used
as a complete bot-turn or whole-game price. See the component's own source and
validation limits before reusing it.

## Reproduce without spending

From `research/chess`, using the existing pinned Node dependencies:

```sh
node gas/local-measure.mjs
node gas/weight-deployment.mjs
node gas/snapshot.mjs
node gas/measure-shards.mjs
node gas/estimate-legacy-vault.mjs
```

RPC helpers use `ROBINHOOD_MAINNET_RPC_URL` if already present, or can read that
variable from an owner-only file selected by `GH0ST_RPC_ENV_FILE`. They do not
execute the environment file. The public Robinhood endpoint is the fallback.
Endpoints and provider error bodies are never printed or saved; only a source
category is recorded. The allowed RPC method list contains no transaction sender.

Gas constants are documented in [geth's protocol parameters](https://github.com/ethereum/go-ethereum/blob/master/params/protocol_params.go)
and [EIP-3860](https://eips.ethereum.org/EIPS/eip-3860). The arithmetic uses Robinhood's
larger code capacity while preserving those measured Shanghai gas rules. Current
Arbitrum component semantics are in [the official gas-estimation guide](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas).
