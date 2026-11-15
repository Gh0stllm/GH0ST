# Twenty-game operating plan

> Superseded proposal: the user rejected these larger caps and set a100ICP total maximum. See [the current100ICP plan](BUDGET_100.md). This historical scenario is not authorization.

**Twenty sequential full-strength games need substantially more than the approved 40 ICP launch cap.** The reviewable 80-decision scenario proposes **1,250 ICP total and 0.01 ETH total**, with the existing **1,000,000 GH0ST prize pool**. These larger caps are **not approved**. The earlier paused pilot remains bounded by its original approval.

Full Stockfish 19, its complete pinned NNUE, 24m nodes, Hash128, maximum skill and retained state are preserved. Only one game runs at a time. This is twenty games total, not twenty concurrent games or twenty games per day.

## Measured basis

The certified saved rate is **1 ICP=1.6389T cycles**, timestamp **2026-11-15T14:29:00.000Z**. Refresh before funding. One representative Black decision combines **972754508186 engine cycles**, **32095715090 coordinator/signature cycles** and **37343176982 separately measured relay cycles**: **1042193400258 cycles, about 0.635910 ICP**. Add 5535903987 cycles for cold retained-state initialization once per game.

The engine/coordinator proof performs fresh full Stockfish inference. The relay's separate 23-check trace consumes a frozen genuine result and includes conservative fault/recovery work. Twenty full ICP games have not been measured; node count fixes search policy, not instructions per position. The relay's latest extended trace cannot be compared with an older shorter trace as a matched net-burn saving.

| Black decisions per game | Decisions across 20 games | Representative workload | Capital with stated allowances | Rounded planning cap |
|---:|---:|---:|---:|---:|
| 40 | 800 | 508.80 ICP | 628.12 ICP | 650 ICP |
| 60 | 1,200 | 763.16 ICP | 933.36 ICP | 950 ICP |
| 80 | 1,600 | 1,017.52 ICP | 1,238.60 ICP | 1250 ICP |
| 100 | 2,000 | 1,271.89 ICP | 1,543.83 ICP | 1550 ICP |

Capital adds **20% workload contingency**, **1.5T creation cycles**, **7.5T operating reserves** (engine 3.5T, coordinator 2T, relay 2T), a **30-day conservative idle HTTP prepayment allowance**, and **1.25 GiB total resident storage for 30 days**. Reserves are held capital, not immediate burn. Idle bookings deliberately overcount full-idle polling in addition to gameplay and are not measured net burn. The rounded cap leaves unassigned upload/install/fee cushion. Position variance, retries, peak memory and future rates remain uncalibrated; 20% is an example, not a proven bound.

The [official pricing](https://docs.internetcomputer.org/references/cycle-costs/) uses 13-node Application placement and 0% reserved compute here. Actual placement and storage reservation must verify. 1.25 GiB costs about 0.251 ICP per 30 days; paid reserved compute adds a separate recurring charge.

## Capital already allocated and remaining funding

Saved mainnet progress at **2026-11-15T14:43:16.450635+00:00** records **3 dedicated canisters**, **13 ICP already converted**, **0.0003 ICP ledger fees**, and **2.13166820 ICP remaining** in the deployment account. Existing service balances and the existing cycles ledger remain separate.

The proposed **1,250 ICP total includes the already converted 13 ICP**. Do not add that amount again. Remaining external funding is about **1234.86833180 ICP**, before future fees, or **1235.86833180 ICP** to retain 1 ICP outside the allocation. Already paid and future ledger fees count against the spending cap; fees reduce the unassigned cushion, not increase authority. The remaining authority under the original 40 ICP approval is **26.99970000 ICP**. Refresh balances before any action.

- Suggested total allocations: engine 1,140 ICP, coordinator 45 ICP, relay 60 ICP, creation/uploads/unallocated 5 ICP. No automatic top-ups.
- Proposed **0.01 ETH total includes the earlier 0.003 ETH cap**: relay gas up to 0.0095 ETH, other deployment/pilot/manual-funding gas allowance 0.0005 ETH. The source supports both locally tested immutable profiles, but the initial approved launch profile remains 0.0025 ETH lifetime gas authority. The larger profile still requires explicit approval.
- The existing **1,000,000 GH0ST prize** and bounded **25,000 GH0ST pilot entry** remain unchanged. No extra token spending is inferred.

The RH quote is 0.020268 gwei at 2026-11-15T14:05:01.397Z. Across 72 saved local Black-move receipts, mean gas is 216,988.68. For 1,600 such moves, the modeled bot gas is 0.007037 ETH; 20% plus 0.0005 ETH for other gas is 0.008944 ETH. This is local replay priced by a mainnet snapshot, not a mainnet full-game bill or worst-case gas bound.

## Capacity, quotas and admission

The native contract and retained engine allow **one active game**. Canonical terminal release erases old engine jobs and prunes coordinator jobs. The selected coordinator proof also covers durable cleanup after a lost release acknowledgement; no twenty-engine deployment is required for twenty sequential games.

The selected relay's daily HTTP booking limit is **2T/day**, with **645.990B/day** conservative full-idle allowance. The remaining quota fits **66 complete saved fault-heavy trace copies**, or **155 copies through first broadcast**. The full saved trace booking is 20.242B per copy. 1,600 complete copies plus full-idle polling every day project about **23.9 quota days**. This is arithmetic on the saved trace, not an arbitrary-game/mainnet throughput guarantee. Twenty total games can span quota days. Coordinator public verification and protected signing have separate 1T/day and 2T/day limits that also need validation at the intended pace. Funding does not bypass quotas; quota exhaustion never permits weaker search.

The native entry method checks the prize and open slot, but cannot itself verify ICP cycles. The coordinator's engine floor of 3.5T cycles is **not a whole-game reserve**. Protected relay-only admission prevents outsiders spending the relay's search/signing lane; it does not turn a frontend readiness check into onchain compute escrow. Before opening paid entries, use an enforceable reviewed funding/admission policy or owner-controlled reopening after terminal games. Direct contract callers must be considered.

## Game length and prize limits

40/60/80/100 Black decisions are scenarios, not legal maxima. The adapter currently accepts **1,024 plies** and **512 engine/coordinator jobs per game**. This is an implementation ceiling, not a proven maximum from the draw rules. Repeating the representative cost even at that ceiling gives about **6,512 ICP** for twenty games before contingency and overhead. Arbitrary full-game coverage is not established by the 80-decision plan. Longer-history support or an explicitly approved challenge variant needs separate review; silently weakening the bot is not an option.

The 1M GH0ST pool funds **one checkmate payout**. Human checkmate automatically pauses entries for review and replenishment. Twenty wins would need 20M GH0ST, which is not authorized here. Twenty entry fees total 500,000 GH0ST; they do not automatically become ICP or ETH.

## Reproduce

After final passing engine/coordinator/relay evidence and the saved certified rate are frozen, run from research/chess:

```sh
node ops/hybrid/costs.mjs --write
node ops/hybrid/twenty-games.mjs --write
```

The calculator makes no network or financial calls. It rejects stale cost inputs or mismatched release evidence, then writes only this document and [twenty-games.json](twenty-games.json). The JSON records exact cycle arithmetic, source SHA256 input snapshots, release hashes and funding reconciliation. A hash snapshot is not a claim that a future upgrade uses those bytes.
