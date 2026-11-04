# GH0ST paper signal research

This experiment checks whether a simple GH0ST momentum signal would have covered the cost of a buy and sell on Robinhood Chain. It uses a public pool on Pons, read-only historical contract calls, and no wallet. The agent spending policy and live Watcher service are separate.

## First result

Between October 28 and November 4, 2026 at 07:00 UTC, the test produced **seven long signals**. One of the seven historical round trips gained ETH after estimated gas (14.3%). Of the other 161 hourly windows, 116 produced no signal and 45 lacked five consecutive traded candles. All seven buy and sell pairs were available. The same historical pool registration reported 100 hook basis points and 150 creator basis points on both sides of all seven pairs.

| Portfolio, starting with 0.0100 ETH | Closing ETH | Return in ETH |
|---|---:|---:|
| Breakout, 0.005 ETH per signal | 0.00775048 | −22.50% |
| Buy GH0ST once with 0.005 ETH, keep the balance in ETH | 0.00666513 | −33.35% |
| Keep all capital in ETH | 0.01000000 | 0% |

Estimated gas across the seven round trips was 0.0000569292 ETH. Only three signal windows had higher next-hour USD opening prices in the candle series. Those marks use a different denomination and timestamp convention from the block quotes. The result covers one known pool and one retrospective week. A high win rate, persistent edge and live fill quality remain unproven. [All entry and exit quotes with block hashes](quotes-2026-11-04.json).

## Fixed first test

At each UTC hour, take a long signal only if the previous closed hourly USD candle closes above the highs of the four preceding hourly candles and its volume is at least $1,000. All five candles must exist, be consecutive and have traded volume. Missing hours produce no decision. Otherwise the strategy holds cash. Each long lasts one hour. Each quote uses 0.005 ETH of starting capital per entry and the test portfolio starts with 0.01 ETH. The strategy has no fitted parameters. It was specified before inspecting its returns.

The entry is a historical exact-input buy quote in the GH0ST Pons pool at the first block at or after the hour. The exit sells the quoted token amount at the first block at or after the following hour. The two calls include the pool and hook behavior at their respective blocks. A quote is a simulation of the route, so the paper order never changes subsequent market state. The signal assumes the prior candle was available as soon as the hour closed. An indexer delay or a later fill can change the result.

Gas is estimated using 200,000 units per leg and each block's base fee, with an existing token allowance and zero tip. Actual router gas, approval costs, any separate L1 data charges and transaction ordering are unknown. The benchmark buys the same 0.005 ETH of GH0ST at the start and sells it at the end, leaving the other 0.005 ETH in cash. A cash-only portfolio stays at 0.01 ETH. The unit of account is ETH.

## Reproduce the first window

Install the Watcher frontend's locked Node dependencies with `npm ci` in `../icp-checker/frontend`. In this directory run the following commands. The timestamp is the end of the seven-day window.

```sh
python3 signals.py --end 2026-11-04T07:00:00Z --save-candles candles.json > windows.json
python3 - <<'PY'
import json
from pathlib import Path
x = json.loads(Path('windows.json').read_text())
pairs = [dict(w, kind='signal') for w in x['windows']]
pairs.append(dict(entry=x['start'], exit=x['end'], kind='buy-and-hold'))
Path('pairs.json').write_text(json.dumps(pairs))
PY
node quote.mjs --file pairs.json > quotes.json
python3 -m unittest -q
```

The original candle response is identified by SHA-256 `89b1fef53277e8b3e4bc24d1bd9ad27690fc5e157859e94025a63f94ab51c76b`. Provider backfills may change a later download. The contract calls verify the pinned pool key, code hashes and historical block headers. The hourly pool series is available from [GeckoTerminal](https://api.geckoterminal.com/api/v2/networks/robinhood/pools/0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01/ohlcv/hour?aggregate=1&limit=240&currency=usd&token=base&before_timestamp=1793775600). The quote method is documented by [Uniswap](https://developers.uniswap.org/docs/sdks/v4/guides/swapping/quoting).

The same rule was subsequently tested on [the Robinhood Chain Watcher universe](watcher-2026-11-04/README.md).
