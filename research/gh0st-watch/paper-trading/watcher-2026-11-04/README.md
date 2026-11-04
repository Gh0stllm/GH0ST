# Robinhood Chain · Watcher universe

## Test protocol

Apply the unchanged GH0ST breakout rule to the pool saved by Watcher for each Robinhood mainnet token. The comparison ends on November 4, 2026 at 07:00 UTC, the same cutoff as the original single-pool study. The outer seven-day window is shortened separately for each token. No trade may start until both its saved scan time and its market observation have passed. Earlier candles can supply the five-hour signal history. The lookback uses five consecutive, closed, positive-volume hourly candles with USD prices for the exact watched base token. The last candle must close above the prior four highs on at least $1,000 in volume. An eligible signal holds for one hour.

The [frozen universe](universe.json) is the public recent feed retrieved at 08:31 UTC. It contains 18 mainnet addresses, 15 with saved pool identities, and was retrieved after the comparison period. The results are retrospective. Re-opened and overwritten records, delisted pools and the recent feed's 24-entry limit can affect which contracts are visible. Today's deepest pool and current liquidity are never substituted for a missing historical choice.

Each signal requests a simulated buy worth 0.005 ETH, then a simulated sale of its exact output one hour later. Fixed-size signals across different pools are separate observations and may overlap. We report successful round trips, wins after estimated gas, unavailable entry or exit quotes, and performance by token. A missing or unverified quote cannot be counted as a win or a loss. If any signal lacks a round trip, a subset win rate covers only the priced observations. Holding ETH gives a zero return in these units. Sum of independently sampled trades is not a return on a single funded portfolio.

Only read-only data and historical contract calls are used. Actual order inclusion, price ordering, approvals, token transfer restrictions or taxes outside the simulated route, and router gas may differ. The quoted observations measure a rule over one captured universe and cannot establish live trading accuracy.

## Preregistered forward window

The forward comparison starts on November 4, 2026 at 09:00 UTC and ends November 11 at 09:00 UTC. Freeze the 15 eligible identities above and the same signal rule for all 168 hours. Score every eligible signal, including those whose route or exit cannot be priced. Report win count, attempted and completed counts, returns in ETH after estimated gas, and coverage. This is a precommitted observation window. It contains no realized forward results at registration time.
