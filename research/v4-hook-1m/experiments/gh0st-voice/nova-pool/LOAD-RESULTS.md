# N0VA concurrent-order local test

**44/44 real-model swaps passed. Up to 16 orders were accepted before mining began.**

| Orders submitted before mining | Direction | Successful | Failed | Blocks containing swaps |
| ---: | --- | ---: | ---: | ---: |
| 4 | BUY | 4 | 0 | 4 |
| 8 | BUY | 8 | 0 | 8 |
| 16 | BUY | 16 | 0 | 16 |
| 16 | SELL | 16 | 0 | 16 |

Each swap emitted one validated neural word. Sequences advanced without gaps or duplication, and the LP liquidity and total supply stayed unchanged. Typical execution used 22,743,274 gas; the observed range was 22,705,038–23,581,964.

**One swap fit per 32M-gas local block.** Sixteen simultaneous submissions mean sixteen queued transactions, not sixteen parallel inference executions. The EVM and shared neural state process them sequentially. Sixteen is the largest queue tested here; this does not establish a maximum possible queue size.

The earlier read-only Robinhood snapshot reports a target of 7M gas/second. Dividing that by the measured mean gives approximately **18.5 swaps/minute** if this pool used the entire network gas target. Competing transactions, congestion, sequencing and fee changes can reduce that. This is a calculation, not a mainnet measurement or latency promise.

All tests used 32M local transaction/block limits and an unforked local chain. Buys in each batch shared a quote with 1% slippage tolerance, so the test also checked order execution without caller-supplied neural-state synchronization. Limits remain necessary; arbitrarily stale price quotes can still fail.

Local CPU wall times are recorded only for reproducibility and must not be read as chain throughput. No mainnet transaction, signing or deployment occurred.

Reproduce: `node experiments/gh0st-voice/nova-pool/test-local.mjs --load-only` from the research directory. See [raw burst report](load-test-results.json.gz), [summary](LOAD-RESULTS.json) and [capacity assumptions](CAPACITY-NOTES.md).
