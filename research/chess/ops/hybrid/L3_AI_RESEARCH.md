# GH0ST L3 compute feasibility

A GH0ST chain settling on Robinhood would form Ethereum → Robinhood → GH0ST L3. GH0ST could be its native gas currency. This can change where computation runs and how it is paid for, but setting a low gas price does not remove CPU, memory, data availability or settlement costs.

The existing chess budget remains capped at100ICP total, including13ICP already converted and ledger fees. L3 infrastructure, licensing acceptance and deployment have not been authorized or provisioned.

## Robinhood and GH0ST gas

Robinhood identifies mainnet4663 as an Arbitrum L2 on Ethereum, using Ethereum blobs and ETH gas. A child chain would need its own chain ID and bridge configuration. [Robinhood network documentation](https://docs.robinhood.com/chain/connecting/).

Current Arbitrum documentation supports custom ERC20 gas tokens in both Rollup and AnyTrust modes. The token must exist on the parent chain and meet the documented transfer, approval, non-rebasing and no-fee requirements. GH0ST's18decimals, known runtime and simulated zero/self transfers support compatibility, but these checks do not establish every required token property. [Rollup gas configuration](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-rollup), [AnyTrust gas configuration](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/custom-gas-token-anytrust).

In the ordinary bridge design, parent GH0ST is escrowed and the child credits native GH0ST balances. The batch poster still pays Robinhood settlement fees in ETH. Rollup mode uses a fee-token pricer to reimburse that expenditure in GH0ST; token-denominated fees do not automatically produce the required ETH.

Robinhood is absent from the current canonical factory table. The documented noncanonical-factory route is unsupported, so the Robinhood tooling and support path needs confirmation before planning a production deployment. The zero-revenue-share license grant names Arbitrum One and Nova; other supported parents use AEP, whose current documentation specifies10% of defined net chain revenue. [Factory table](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts), [licensing](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license).

## Standard Stylus does not accept the current engine unchanged

The present ICP chess module is103,089,852bytes and the warm execution snapshot is about618MiB. Its full NNUE is98,511,183bytes, and it relies on Wasm SIMD.

Current standard Stylus deployment defaults are96KiB compressed and256KiB decompressed code. The Nitro v3.12.2 parser disables SIMD. Its initial-memory compiler bound is128Wasm pages, or8MiB. Later growth is separately metered, and owners can adjust several limits;8MiB should not be described as an absolute immutable limit on every custom chain. Raising one setting alone does not make the current module compatible. [Stylus overview](https://docs.arbitrum.io/stylus/gentle-introduction), [VM differences](https://docs.arbitrum.io/stylus/concepts/vm-differences#stylus-contracts), [pinned parser](https://github.com/OffchainLabs/nitro/blob/v3.12.2/crates/prover/src/binary.rs#L342-L357), [memory pricing](https://github.com/OffchainLabs/nitro/blob/v3.12.2/arbos/programs/memory.go#L24-L60).

Stylus retains compiled code between calls, but creates new mutable guest instances. The chess transposition table and histories therefore need committed chain storage or deterministic reconstruction between transactions. The same issue applies to an LLM's retained KV state. [Invocation implementation](https://github.com/OffchainLabs/nitro/blob/v3.12.2/crates/stylus/src/native.rs#L128-L139).

## Large models need a custom execution and proving design

A custom deterministic precompile or VM is the relevant research direction. Model data, inputs, retained state and outputs must be available to replay and validation. The implementation also needs matching replay and fraud-proving semantics. An external inference API called by a contract would be a different trust model. [Custom state transition requirements](https://developer.arbitrum.io/launch-arbitrum-chain/extend-the-protocol/stf).

For scale,70billion parameters already packed at4bits require35GB just for weights, before runtime memory and KV state. This is storage arithmetic, not a measured serving configuration or a recommendation to change model precision.

A viable prototype should first demonstrate a small model whose complete output can be independently replayed, including an intentionally wrong output being rejected. Measure native execution time, committed state, proof/replay behavior, parent batch fees and hardware cost per output token before extrapolating to large models. GPU acceleration would need the same deterministic semantics as the validating and proving path.

## Costs that remain

A chain needs sequencing, batch posting, a parent RPC, validation and monitoring; AnyTrust adds data-availability services and committee assumptions. The standard sequencer guide lists8cores,64GBRAM and NVMe, which is a published operating baseline rather than a measured minimum for a quiet GH0ST L3. [Sequencer guide](https://docs.arbitrum.io/run-a-node/sequencer/run-sequencer-node), [AnyTrust model](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/data-availability/anytrust-trust-model).

Moving only chess transactions to an L3 leaves ICP inference costs unchanged. Moving execution into the L3 could replace that bill with a different compute and proving system, but no measured ICP-to-L3 saving or100ICP launch price follows from configurable gas rates.

For the current chess build, [exact prefix reuse](../../engine/prefix-cache/CACHE_CERTIFICATE.md) keeps fresh searches on ICP and can let Robinhood reuse verified replies without another search or pair of signatures. Its savings depend on repeated histories. It is a separate near-term optimization from launching a new chain.
