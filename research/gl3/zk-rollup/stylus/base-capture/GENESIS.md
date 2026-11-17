# Genesis and the first ordinary transition

The captured ordinary transaction starts after the initialization message, at sequencer cursor `[1,0]`. Its full before state is:

| Field | Actual value |
| --- | --- |
| Block hash | `a6d1481bfa6554b4f800d042afb36257b9d37587c7411fc31e58907455336df7` |
| Send root | zero |
| MEL state and message hashes | both zero |
| Sequencer batch / position | `1 / 0` |
| Genesis state root | `69ba39dbc336e43a09ad934d8ed1e8171116de915826dca02c1ba2deec6e8bbc` |

The genesis header is an authenticated Keccak preimage in the captured input. Its number and timestamp are both zero and its nonce is one: initialization consumed delayed message zero. This is a private test genesis with allocated test balances, not a production launch state.

Canonical replay supports a separate true initialization transition. With a zero previous block root it reads the init message, parses the chain ID/config/initial data price, initializes ArbOS with no external allocation, then creates block zero. `ValidationInputsAt(0)` has an explicit zero-previous-result path; recording skips ordinary block recreation at index zero while retaining the initialization inbox data. This support is source evidence, not an executed initialization proof.

An ordinary launch can instead bind an explicitly reviewed, reproducible zero-allocation genesis as its trust anchor at cursor `[1,0]`. That choice must be labelled as a genesis anchor, not an initialization proof. Parent data registration still needs to include canonical initialization record zero before later ranges.

The header can be predetermined if all initialization data is fixed. In particular, a **nonzero fixed `dataCostEstimate`** makes the pinned `AbsRollupEventInbox` encode that exact estimate into the init payload. Estimate zero instead asks the parent contract for its current price and may depend on mined parent context. `ParseInitMessage` reads the payload, not the incoming header's timestamp, sender, block number or base fee. Both canonical replay and ordinary block-zero initialization use parent hash zero, number zero and timestamp zero. Exact serialized chain-config bytes, the fixed data price and absence of extra allocations/ArbOS overrides must agree across helper, factory and node.

Pinned source references:

- [Initialization input construction](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/staker/stateless_block_validator.go#L447).
- [Actual replay initialization](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/cmd/replay/main.go#L393).
- [Init payload parsing](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/arbos/arbostypes/incomingmessage.go#L345).
- [Canonical genesis fields](https://github.com/OffchainLabs/nitro/blob/5f02f3f03076343061f167e81b8e82ec5518064b/arbos/arbosState/initialize.go#L34).
- [Fixed versus live initial data cost](https://github.com/OffchainLabs/nitro-contracts/blob/4341b132cfbdcc980ead03765ca5224ff6cb5d97/src/rollup/AbsRollupEventInbox.sol#L51).
