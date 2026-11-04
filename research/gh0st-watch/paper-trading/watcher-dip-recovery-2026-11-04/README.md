# Watcher dip-recovery paper test

## Frozen comparison protocol

Use the same 15 eligible pool identities and the original [dated Watcher universe](../watcher-2026-11-04/universe.json). This tests one alternative to the breakout without optimizing a threshold. At each eligible UTC hour take the five preceding consecutive, positive-volume, valid hourly USD candles in chronological order. Call their closes c1 through c5. Enter long only when c4 is below all of c1, c2 and c3, and c5 is strictly above c4 but still below c3. The fifth candle must have at least $1,000 of volume. Otherwise stay flat or abstain for missing data.

Compare both rules over the original 170 eligible token-hours ending November 4 at 07:00 UTC. After that, compare both without retuning on five additional decision hours, from 07:00 through 11:00 UTC inclusive, with the last exit at 12:00 UTC. This second period had already elapsed when the rule was recorded and is a retrospective check on newly examined data.

Keep the same 0.005 ETH entry, one-hour holding period, historical exact-input buy and sell, direct-route restrictions, and gas estimate as the [breakout baseline](../watcher-2026-11-04/README.md). Count every signal. Report positive net round trips divided by all successfully quoted round trips; show exclusions, total modeled net ETH, and return on cumulative entry notional separately. Holding ETH earns zero measured in ETH. Independent positions may overlap.

For a genuinely prospective comparison, keep both rules unchanged for entries November 4 at 13:00 UTC through November 11 at 12:00 UTC inclusive (final exit November 11 at 13:00 UTC). The original breakout's separately registered 09:00 UTC forward window also remains intact. This registration schedules no orders or background jobs.
