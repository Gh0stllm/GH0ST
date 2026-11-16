# GL3 chess · USD 100/month performance budget

The active recurring server ceiling is **USD 100 per month**. The objective is sustained full-strength chess execution and recovery. This is a server budget; parent-chain gas, bonds and any software-license terms remain separate. No permanent production host has been ordered. A temporary, billable Runpod CPU machine is being used for replay testing, as requested by the user.

| Candidate | Advertised hardware | Current public starting price | Decision |
| --- | --- | --- | --- |
| OVHcloud RISE-GAME-1 | Dedicated Ryzen5 5600X,6cores/12threads,32 GB base RAM,2×512 GB disks; NVMe configuration to verify | Official Kimsufi catalog search listsUSD72/month, before applicable tax/checkout options | Primary dedicated-host candidate for a measured acceptance test; reserve remaining budget for tax and independent backups |
| Hetzner EX44-1-LTD | Dedicated Corei5-13500,64 GB,2×512 GB NVMe | Official15June2026 adjusted list:USD72.10/month excluding VAT/IPv4, zero listed setup | Alternative when the limited-stock tier is available; ordinary current pricing is not assumed to be the same |
| netcup RS2000G12.5 | Guaranteed-resource KVM,8 advertised CPU allocations,16 GB,256 GB NVMe | Current page displaysEUR46.81 incl19%VAT; exact one-month terms were recorded in the earlier study | Recovery-friendly fallback; not a whole physical server |

Primary sources, checked16November2026: [OVH/Kimsufi dedicated catalog](https://www.kimsufi.com/en/), [Hetzner current adjustment and limited-stock terms](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [EX hardware](https://www.hetzner.com/dedicated-rootserver/matrix-ex/), [netcup plans](https://www.netcup.com/en/server/root-server).

The quote must be rechecked at checkout for the user's billing country, datacenter, setup fee, tax, mandatory options and stock. A starting price is not a reserved machine or an all-in invoice. Keep the configured recurring total underUSD 100. A one-time setup cost needs its own concrete review.

## What the test must preserve

- Same complete98,511,183-byte NNUE; same24m nodes, one worker, Hash128 MiB, skill20 and retained state.
- Native Linux build and portable replay must reproduce exact move/node/depth/checkpoint fixtures. CPU instruction acceleration is accepted only after parity.
- Measure real native move latency, whole-node peak RAM, block recording/replay, proof cost and disk growth on the selected CPU. More cores do not automatically reduce a serial deterministic search.
- Keep backup data off the primary host; test restore and retain the old authoritative checkpoint on any failed transition. A single host does not provide zero downtime.

Current local M5 measurements: accelerated native18.7–20.5s/decision in the four-position suite; actual EVM17.3–17.9s in a later two-decision run. Scalar Wasm JIT188–222s/decision. These do not establish hosted timing or full WAVM-proof speed. The full retained checkpoint is155.5 MiB/game; historical state growth and parent DA cost still need measurement.


## Full-prover memory observation

During the complete interpreter replay, a late-start sampler of the prover process briefly observed **14.63 GiB RSS**, before the run completed. This is not an exact whole-run peak or a hard16 GB Linux test. It is already enough to avoid treating the earlier native2.463 GiB study as the full node/proof budget. The user-selected target is24 GB withinUSD 100/month. Bounding diagnostic Merkle-hashing concurrency and reducing redundant witness generation are being tested separately; neither changes the Stockfish model, search budget or chess results.


## Earlier 24 GB capacity candidate

The earlier preference was24 GB RAM withinUSD 100/month. The bounded real node/prover overlap screen supports it as a candidate for one active node/prover: the held native fixture observed2.65 GiB; a separate full-prover late sample reached14.63 GiB. The conservative observed-component sum plus a4 GiB planning reserve is about 21.35 GiB. This is neither a measured simultaneous maximum nor a hard24 GB/Linux certificate. [Exact scope](evidence/cohost24-screen.json).

The provider table preserves quoted comparison bundles, some of which include32 GB. An exact24 GB hosting configuration, checkout total, sustained CPU performance and restore acceptance remain unselected. The bot's full model,24m nodes and retained state remain fixed.

## 32 vCPUs, 64 GB RAM and 1 TB NVMe

This is a credible **low-traffic launch candidate**, not a completed whole-chain capacity test. It could co-host a GL3 sequencer/RPC, batch poster and a bounded validation worker, using a remote Robinhood parent RPC. It does not include running a full Robinhood or Ethereum node on the same server. Resource reservations must keep proof generation from starving block production. One machine also remains one failure domain.

The [Nitro prerequisites](https://docs.arbitrum.io/run-a-node/start-here) list64 GB DDR5 as the minimum and128 GB or more as recommended; they call for local NVMe and storage sized to traffic, ideally several TB. Those public-chain guidelines do not establish a measured GL3 limit. GL3 starts much smaller, but its retained engine history can grow even when the number of players is low.

The current first-decision experiment wrote approximately **1.616 GB of immutable delta payload**. A simple projection of that one observation gives129 GB for80 Black decisions, or2.59 TB for20 such games, before database and proof overhead. This is an illustrative projection, not measured sustained growth: later moves may differ. A1 TB disk is therefore a starting capacity, not a guarantee for20 long games under the current storage design. Reclaiming live code, retaining challenge data and cold replay need a tested design; ordinary database pruning alone is not a demonstrated solution.

For the temporary Linux replay experiment, the allocated machine has32 vCPUs and64 GB RAM. The guest reports an AMD EPYC9575F. [AMD's specification](https://www.amd.com/en/products/processors/server/epyc/9005-series/amd-epyc-9575f.html) lists up to5 GHz boost and4.5 GHz all-core boost; neither is a provider guarantee of sustained guest frequency. A vCPU is not a promise of a dedicated physical core. The live Runpod CPU5 compute catalog quoted **USD1.12/hour** for32 vCPUs, excluding scratch disk. At730 hours this isUSD817.60 in compute alone, so this temporary testing configuration is **not** the permanentUSD100/month proposal. Its scratch disk is64 GB; the1 TB question did not authorize ordering a1 TB volume.

The16-vCPU predecessor was terminated before creating the32-vCPU test machine. Both machines use the same complete engine and captured replay input. Paired eager/lazy replay results and final cleanup are recorded separately; allocation alone is not a passing workload test.
