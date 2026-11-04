# Watcher dip-recovery paper test

## Results

**The dip-recovery rule was less profitable than the breakout on the original sample and also lost money in the later check.** All ten dip-recovery signals across both periods received historical buy and sell quotes.

| Period (UTC) | Strategy | Signals | Priced | Profitable | Net ETH after estimated gas | Return on cumulative entry notional |
|---|---|---:|---:|---:|---:|---:|
| Original, through Nov 4 07:00 | Breakout | 24 | 20 | 8/20 (40%) | −0.00127077 | −1.27% |
| Original, through Nov 4 07:00 | Dip recovery | 8 | 8 | 2/8 (25%) | −0.00132624 | −3.32% |
| Next five hours, through Nov 4 12:00 | Breakout | 7 | 5 | 1/5 (20%) | −0.00046065 | −1.84% |
| Next five hours, through Nov 4 12:00 | Dip recovery | 2 | 2 | 0/2 (0%) | −0.00032488 | −3.25% |

The later dip rule lost less ETH in absolute terms because it traded less. On the amount put into trades it lost more. It also lost ETH in both periods before subtracting estimated gas. Four original breakout signals and two later breakout signals had USDG-paired routes outside the common direct ETH/WETH pricing model. The new rule had no such exclusions. The original sample had 45 missing-data decisions out of 170; the later interval had 14 out of 75 for both rules. Cash in ETH outperformed both modeled strategies over these windows. These small, retrospective samples do not establish live win rates.

[Original breakout evidence](../watcher-2026-11-04/results.json) · [Original dip-recovery evidence](main/results.json) · [Later breakout evidence](late-baseline/results.json) · [Later dip-recovery evidence](late-new/results.json)

## Frozen comparison protocol

Use the same 15 eligible pool identities and the original [dated Watcher universe](../watcher-2026-11-04/universe.json). This tests one alternative to the breakout without optimizing a threshold. At each eligible UTC hour take the five preceding consecutive, positive-volume, valid hourly USD candles in chronological order. Call their closes c1 through c5. Enter long only when c4 is below all of c1, c2 and c3, and c5 is strictly above c4 but still below c3. The fifth candle must have at least $1,000 of volume. Otherwise stay flat or abstain for missing data.

Compare both rules over the original 170 eligible token-hours ending November 4 at 07:00 UTC. After that, compare both without retuning on five additional decision hours, from 07:00 through 11:00 UTC inclusive, with the last exit at 12:00 UTC. This second period had already elapsed when the rule was recorded and is a retrospective check on newly examined data.

Keep the same 0.005 ETH entry, one-hour holding period, historical exact-input buy and sell, direct-route restrictions, and gas estimate as the [breakout baseline](../watcher-2026-11-04/README.md). Count every signal. Report positive net round trips divided by all successfully quoted round trips; show exclusions, total modeled net ETH, and return on cumulative entry notional separately. Holding ETH earns zero measured in ETH. Independent positions may overlap.

For a genuinely prospective comparison, keep both rules unchanged for entries November 4 at 13:00 UTC through November 11 at 12:00 UTC inclusive (final exit November 11 at 13:00 UTC). The original breakout's separately registered 09:00 UTC forward window also remains intact. This registration schedules no orders or background jobs.

## Reproduction

From the parent `paper-trading/` directory, run `python3 -m unittest -q`. The original and later candle manifests record provider URLs and SHA-256 hashes. For a replay from the original study cache, set `FIRST` to the directory containing its frozen `universe.json` and `candles/` and set `OUT` to a new output directory.

```sh
python3 dip_recovery.py collect --original-dir "$FIRST" --output-dir "$OUT"
python3 dip_recovery.py replay --original-dir "$FIRST" --output-dir "$OUT"
for period in main late-new late-baseline; do
  dir="$OUT/$period"
  node watcher_quote.mjs "$FIRST/universe.json" "$dir/signals.json" "$dir/v4-quotes.json"
  node watcher_legacy_quote.mjs "$dir/signals.json" > "$dir/legacy-quotes.json"
  python3 watcher_results.py "$dir/signals.json" "$dir/v4-quotes.json" "$dir/legacy-quotes.json"
done
```

For offline verification, use the saved signals and both quote files in each of this report's three period directories as inputs to `watcher_results.py`. Historical quotes include pool/hook behavior where the route is supported. Modeled gas uses 200,000 units on each side at the respective historical block's base fee, zero tip and an existing token allowance. Indexing delays, real transaction ordering, tips, approval and any separate data fee can affect actual execution.
