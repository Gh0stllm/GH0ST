# Hard 100 ICP optimization budget

**100 ICP is the total limit, including the 13 ICP already converted.** The ETH limit remains **0.003 ETH total**, including the relay's **0.0025 ETH lifetime gas profile**. The fixed 1M GH0ST prize and bounded 25,000 GH0ST pilot entry remain unchanged. The earlier 1,250 ICP/0.01 ETH proposal is rejected. No automatic top-ups or external hosting bills are authorized by this report.

The saved account balance is 2.13166820 ICP after 13 ICP conversion and 0.0003 ICP fees. Remaining spending authority is **86.9997 ICP**; funding that remaining authority would need about **84.86803180 additional ICP**, before future fees. Fees reduce the amount convertible within the cap. Existing service balances and the existing cycles ledger remain separate.

## Pricing audit

The selected engine is actually **Wasm32**: its installed-source artifact has one memory, limits flags0 and no memory64 flag. Its SHA256 remains `725dc0c795262be21f1ffafec60f50aae3e9d00140add77e791a89eece0f417b`.

The selected subnet's canonical registry record reports replica revision `620b81c4bf6c59aa1065fe7412afcaf49e51503e`. In [that exact replica source](https://github.com/dfinity/ic/blob/620b81c4bf6c59aa1065fe7412afcaf49e51503e/rs/config/src/subnet_config.rs#L475), Wasm32 costs **10 cycles per10 metered instructions:1 cycle/instruction**, plus5M per update. Wasm64 costs twice as much. Current [official pricing](https://docs.internetcomputer.org/references/cycle-costs/) agrees on computation. Historical0.4-cycle references must not be applied as a current discount.

The [performance counter](https://docs.internetcomputer.org/references/ic-interface-spec/canister-interface/#performance-counter) measures IC instruction work. The latest paired local proof samples **972.184B instructions** and debits **972.755B engine cycles**, including execution/persistence tails. These figures are consistent with the current Wasm32 price. Thirteen replicas are already accounted for in the base price; do not multiply the debit by13 again. Public-network move time and actual live debit still need the paused pilot.

Storage has a documentation discrepancy: the current table says127,000 cycles/GiB-second, while the pinned deployed source uses317,500 plus a small per-canister base fee. This audit uses the higher source rate. At1.25GiB, that is about **0.628 ICP per30days** at the saved conversion; computation remains the dominant cost.

## Seven nodes do not provide the needed discount

Read-only checks on2026-11-15 established:

| Subnet | Certified members | Canonical registry SEV flag | Reference denominator | Compute multiplier |
|---|---:|---|---:|---:|
| Selected `bkfrj…` | 13 | false | 13 | **1×** |
| Public seven-node `re2t4…` | 7 | true | 7 | **1×** |

The full IDs, certificate hashes and registry record hashes appear in [BUDGET_100.json](BUDGET_100.json). Node membership was BLS-certified against the SDK-pinned mainnet root. SEV, replica version and cost schedule were independently read through canonical registry queries with SDK node-signature verification; these are not described as certified registry Merkle proofs. The official dashboard inventory agrees: the other two seven-node subnets require authorization.

The [deployed reference-size selection](https://github.com/dfinity/ic/blob/620b81c4bf6c59aa1065fe7412afcaf49e51503e/rs/replicated_state/src/metadata_state.rs#L333) uses denominator7 for non-system SEV subnets. Therefore public `re2t4…` scales7/7, not7/13. There is **no verified46% public-subnet compute saving**. Current coordinator/relay modules also require their own13-node placement and9-valid-of13 HTTP committee. Migration or quorum changes would need a separate review; no migration was performed.

## What 20 games would require

The saved certified rate is **1 ICP=1.6389T cycles**, timestamp2026-11-15 14:29 UTC. The current representative turn combines **972.755B engine** and **69.439B coordinator/relay** cycles: about **0.63591 ICP**. These are local measurements for the stated position and separate relay trace, not a whole-game or universal-cost bound.

| Scenario | Current representative workload | Minimum cut to fit100ICP before other costs | Cut with conservative30-day allowance |
|---|---:|---:|---:|
| 20 games ×40 Black decisions | 508.80 ICP | **80.35%** | **83.88%** |
| 20 games ×80 Black decisions | 1,017.52 ICP | **90.17%** | **91.94%** |

The allowance is17.99 ICP of planning capital: creation/operating reserves, full-idle HTTP booking for30days,1.25GiB storage at the higher source rate and three base canister fees. Booking is conservative prepayment, not measured net burn. Already allocated capital is included, not added again. A precise remaining balance must be reconciled after the pilot.

Ignoring every other cost,100ICP buys about157 representative decisions; including that allowance leaves about129. This does not establish twenty full games. Counting short resignations as twenty games would not satisfy the intended capacity. The engine's1,024-ply/512-job limit is an implementation ceiling, not a proof of a full-game maximum. Position and retry variation remain material.

## Exact cache constraints

Checkpoint reuse remains research, not an implemented saving. A correct key must bind the complete history, model/build/policy and incoming retained state. Restoring only a FEN or best move does not preserve the bot's later TT, move ordering, correction history or retained policy. The [existing checkpoint audit](../../engine/checkpoint-research/README.md) lists the required state and equality gates.

Even assuming **free restoration**, unchanged coordination costs mean the cache would need engine hits on **86.09% of decisions for20×40**, or **96.62% for20×80**, before hosting/startup overhead. With the conservative allowance those rise to89.88% and98.51%. Ten common Black opening moves across twenty games produce at most23.75% hits in the40-decision scenario, or11.875% in the80-decision scenario, when the first game fills the cache.

If the first full80-decision game builds the cache within this budget, even twenty **completely identical games** cost about **115.34 ICP before other overhead**: the remaining nineteen games can provide at most95% hits. Real users can choose uncached moves. Offchain prepared checkpoints would also require explicit provenance and trust disclosure; a checksum alone does not prove that a full search was performed on ICP.

The prefix profile puts roughly46.3% of engine work in feature transformation and32.7% in affine evaluation. Exact SIMD/layout improvements and correctly scoped evaluation memoization remain useful research. These directional profiles do not establish an80–90% reduction. Any candidate must retain the full network,24m budget, Hash128 and retained state, then pass exact consecutive searches and full-game checks. No weaker fallback is acceptable.

## A concrete alternative, only if the user chooses it

One possible architecture runs the **same full-strength native Stockfish** on a small hosted CPU worker, while ICP verifies canonical RH state, coordinates jobs and signs moves. Robinhood still verifies legal moves/checkmate and controls GH0ST rewards.

**Search would no longer be replicated on ICP.** ICP would rely on the hosted worker's report for search quality. Signed transport and legal-move checking do not independently prove a24m-node search. This must be presented as hosted search with ICP coordination, and requires an explicit user decision. It is not implemented or deployed.

A concrete hosting example is DigitalOcean's [Basic bundled1vCPU/2GiB plan](https://www.digitalocean.com/pricing/droplets): **$0.01786/hour, capped at$12/month**, with50GiB SSD and2,000GiB transfer. [Billing](https://docs.digitalocean.com/products/droplets/details/pricing/) is per second with a60-second/$0.01 minimum; powering it off does not stop charges. Taxes, optional backups and other paid extras are excluded. No account, capacity or target-host performance was checked, and the100ICP permission does not authorize a USD hosting bill.

Using current coordination/relay traces as a proxy,20×80 decisions require about **67.86 ICP** without the972B engine computation. Adding the illustrative allowance gives about **85.85 ICP**, before unmeasured hosted-adapter work or stranded balances. This is near the100ICP cap, not a proven funded20-game service. The current engine has no arbitrary cycles-withdrawal endpoint; existing balances must be counted exactly, and any recovery/reallocation would require reviewed controller actions. Hosted process restarts must fault an active retained game rather than silently clear its cache. Native output/retention equivalence still needs testing on the selected host.

A separate proposal could combine ICP move authorization and Ethereum submission into **one threshold transaction signature**. A reviewed native contract method would accept only the ICP-controlled sender for the exact Black move. This could remove one26.154B-cycle signature per decision, about **25.53 ICP across1,600moves**. It requires a different contract API and custody/journal review; the current immutable contract cannot acquire it in place. This saving alone does not make the unchanged all-onchain engine fit100ICP. No such contract or signature change was performed.

## ETH also stays inside its cap

At the saved0.020268gwei quote and the72 local Black receipts'216,988.68-gas mean,800 Black moves model0.003518ETH and1,600 model0.007037ETH. Both exceed the existing **0.0025ETH relay lifetime authority**. These are scenarios, not mainnet worst-case gas bills.

Keeping the same gas price, the current authority requires average Black gas below154,184 for800moves, or77,092 for1,600: approximately28.94% or64.47% lower than the saved mean. Equivalent Solidity legality/storage/calldata improvements can be researched; a new API still needs a reviewed deployment/binding plan. User-paid White moves must not be counted as project-paid Black gas. This audit proposes **no ETH-cap increase**.

Continue the approved paused pilot and exact-kernel/cache work, measure actual mainnet debit and latency, and keep public admissions tied to verified available resources. **No verified unchanged-quality, fully replicated ICP path currently guarantees twenty arbitrary full games within100ICP.** A hosted worker is a different trust choice for the user, not an optimization to switch on silently.
