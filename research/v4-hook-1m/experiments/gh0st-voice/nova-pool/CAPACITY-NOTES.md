# N0VA concurrent submissions and sustainable throughput

**Concurrent users can submit orders, but the shared pool and recurrent model execute those swaps in sequence.** Every successful swap changes the price and advances the same neural state. Pending transactions are a queue, not parallel inference jobs. A local burst test demonstrates whether orders can be accepted and processed correctly; it does not establish a mainnet swaps-per-second rate.

## Measured gas and saved network configuration

The completed 32-swap local integration used **22,707,498–23,581,932 gas** per swap, averaging **22,752,229.9375 gas**. These are real-model local receipts, not mainnet measurements. See `integration-results.json` and `RESULTS.json`.

The saved read-only Robinhood snapshot in `../voice-v8/deployment-cost/fee-snapshot.json` was collected at **2026-10-24 09:23:02 UTC**, block **96,658,901**, chain **4663**. At the ArbGasInfo precompile `0x000000000000000000000000000000000000006c`, `getGasAccountingParams()` returned:

| Named parameter | Saved value |
|---|---:|
| `speedLimitPerSecond` | 7,000,000 gas per second |
| `gasPoolMax` | 32,000,000 gas |
| `maxBlockGasLimit` | 32,000,000 gas |

The same block header reports a much larger raw `gasLimit`. It must not be substituted for ArbGasInfo's execution accounting parameters to advertise throughput. The snapshot is a dated observation, not a promise that mainnet settings remain unchanged. No network call or mainnet transaction was made for this analysis.

## Capacity implied by the snapshot

The simple calculation is:

```
network budget per minute = 7,000,000 * 60 = 420,000,000 gas
N0VA swaps per minute = network budget / measured gas per N0VA swap
```

| Assumption | Theoretical throughput |
|---|---:|
| All network execution capacity, measured average swap | approximately 18.46 swaps/minute |
| All network execution capacity, largest observed swap | approximately 17.81 swaps/minute |
| One average swap's share of the chain's one-minute budget | approximately 5.42% |
| Ten average swaps per minute | approximately 54.17% of the budget |
| Twenty average swaps per minute | approximately 108.34% of the budget |

Thus **about 18 swaps per minute is a network-budget upper estimate, not a measured or reserved N0VA capacity**. Other applications share the network. Sequencer policies, ordering, contention, gas-price changes, future protocol changes and transactions that revert reduce usable throughput. The speed limit is sustained accounting capacity, not a guarantee that each consecutive second processes exactly 7M gas. A temporary burst can create a backlog and fee pressure.

Under the saved **32M block execution cap**, two observed N0VA swaps cannot fit together in one block: even two minimum-cost swaps exceed 45.4M gas. Other smaller transactions may fit alongside a single N0VA swap. A sequencer may emit more than one block per second, so "one per block" does not independently establish "one per second."

A queue of 16 average swaps consumes about **52 seconds of the entire saved network gas budget**; using the largest measured swap gives about **54 seconds**. This is an execution-budget equivalent, not a latency forecast. Real waiting time can be longer. Local CPU runtime and local instant block production cannot be used as a mainnet confirmation-time estimate.

## What concurrent testing should verify

1. Every funded, valid transaction is accepted or fails with a clear reason; no order is silently lost.
2. Committed swap order yields a strictly advancing neural sequence, one new word per successful swap, without stale off-chain state being required.
3. Buys and immediate sells preserve fixed supply and locked LP ownership.
4. Each block obeys the 32M local cap; actual measured block placement is recorded rather than inferred from submission timing.
5. A queued order may fail its minimum-output or deadline check after earlier swaps move the price. That is expected protection, not an inference-concurrency fault.

The whole trade remains atomic: an inference failure reverts the swap. Increasing user concurrency does not create a second model state or add compute capacity.
