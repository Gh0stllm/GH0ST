# Robinhood Chain · Watcher universe

## Results

Of 18 Robinhood mainnet addresses in the captured Watcher feed, 15 had an eligible historical pool. From November 3 to November 4, those tokens supplied 170 post-observation hourly decisions. There were 101 flat decisions, 45 hours with insufficient consecutive trading history, and 24 long signals across eight pools. All eligible pools returned candle data. The GH0ST platform card, Jimothy and SPLIT had no eligible saved pool. One testnet entry was excluded.

**Eight of 20 priced round trips were profitable after estimated gas (40%).** The 20 independent 0.005 ETH entries lost a combined **0.00127077 ETH**, or **1.27% of 0.100 ETH of cumulative entry notional**. No eligible direct ETH/WETH quote was available for the other four signals because the saved PRIORS pool is paired with USDG. There were no unresolved exits among the 20 quoted trades. Keeping ETH returned 0% in ETH terms. This sample does not support a high-accuracy claim.

| Watched token | Signals | Priced | Wins | Net modeled ETH |
|---|---:|---:|---:|---:|
| CASHCAT | 2 | 2 | 1 | -0.00018862 |
| PONS | 2 | 2 | 0 | -0.00019469 |
| TENDIES | 4 | 4 | 2 | +0.00019329 |
| HARMONIC | 3 | 3 | 2 | +0.00032021 |
| PRIORS | 4 | 0 | — | — |
| STREET | 3 | 3 | 2 | -0.00003438 |
| FOREVER | 1 | 1 | 0 | -0.00010331 |
| GRIFT | 5 | 5 | 1 | -0.00126327 |

The USD price rose between the first and last reported trades in 14 of the 24 holding-hour candles. This directional statistic includes all eight signaling tokens and uses a different price series, times and unit from the ETH quotes. Its 58.3% is not the win rate on after-cost swaps.

The cost model uses 200,000 gas units per leg at the respective block's base fee, assumes existing approval and zero tip, and treats canonical ETH/WETH at par with wrapping included in modeled gas. Historical contracts supplied each route's swap fee and amount out. Approval, tips, any separate L1 charge, adverse ordering and actual fills can change the outcome. Per-pool buy-and-hold comparisons are in the results file. Since they are shown only for pools that signaled, their sum is not a passive portfolio comparison for all 15 pools.

[Every signal and benchmark](results.json) · [Candle windows](signals.json) · [V4 quotes and pool-key evidence](v4-quotes.json) · [V3 quotes and contract evidence](legacy-quotes.json)

## Test protocol

Apply the unchanged GH0ST breakout rule to the pool saved by Watcher for each Robinhood mainnet token. The comparison ends on November 4, 2026 at 07:00 UTC, the same cutoff as the original single-pool study. The outer seven-day window is shortened separately for each token. No trade may start until both its saved scan time and its market observation have passed. Earlier candles can supply the five-hour signal history. The lookback uses five consecutive, closed, positive-volume hourly candles with USD prices for the exact watched base token. The last candle must close above the prior four highs on at least $1,000 in volume. An eligible signal holds for one hour.

The [frozen universe](universe.json) is the public recent feed retrieved at 08:31 UTC. It contains 18 mainnet addresses, 15 with saved pool identities, and was retrieved after the comparison period. The results are retrospective. Re-opened and overwritten records, delisted pools and the recent feed's 24-entry limit can affect which contracts are visible. Today's deepest pool and current liquidity are never substituted for a missing historical choice.

Each signal requests a simulated buy worth 0.005 ETH, then a simulated sale of its exact output one hour later. Fixed-size signals across different pools are separate observations and may overlap. We report successful round trips, wins after estimated gas, unavailable entry or exit quotes, and performance by token. A missing or unverified quote cannot be counted as a win or a loss. If any signal lacks a round trip, a subset win rate covers only the priced observations. Holding ETH gives a zero return in these units. Sum of independently sampled trades is not a return on a single funded portfolio.

Only read-only data and historical contract calls are used. Actual order inclusion, price ordering, approvals, token transfer restrictions or taxes outside the simulated route, and router gas may differ. The quoted observations measure a rule over one captured universe and cannot establish live trading accuracy.

## Preregistered forward window

The forward comparison starts on November 4, 2026 at 09:00 UTC and ends November 11 at 09:00 UTC. Freeze the 15 eligible identities above and the same signal rule for all 168 hours. Score every eligible signal, including those whose route or exit cannot be priced. Report win count, attempted and completed counts, returns in ETH after estimated gas, and coverage. This is a precommitted observation window. It contains no realized forward results at registration time.

## Reproduce

Use the pinned dependencies and Node setup from the parent directory. From `paper-trading/` run:

```sh
python3 watcher_signals.py watcher-2026-11-04/universe.json --end 2026-11-04T07:00:00Z --output-dir replay
node watcher_quote.mjs watcher-2026-11-04/universe.json replay/signals.json replay/v4-quotes.json
node watcher_legacy_quote.mjs replay/signals.json > replay/legacy-quotes.json
python3 watcher_results.py replay/signals.json replay/v4-quotes.json replay/legacy-quotes.json
```

To reconcile the frozen evidence without a network request, run the last command with the three saved input files in this directory. A live replay can differ if the data provider revises historical candles or the archive RPC no longer serves a historical state.
