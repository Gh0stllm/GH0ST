# Cheapest hosting candidates for the selected chess workload

[Measurement](README.md) · [GL3 overview](../../../../../../README.md)

Research date:16 November 2026. These are **server costs**, excluding parent ETH gas, licensing, validator collateral, independent backups, operations and optional redundancy. No order or hosted performance test was performed. The unchanged native workload's memory screen supports16 GB and suggests that8 GB is also worth a controlled pilot; the full L3 chess replay/proof path remains unimplemented.

## Public monthly prices

| Candidate | Resources | Monthly cost and terms | What remains unknown |
| --- | --- | --- | --- |
| OVHcloud VPS-1 |2 shared vCores,4 GB,40GB local NVMe |**€4.49 ex VAT base**; conservative **€4.84** with one-day backup; default monthly/zero commitment |Lower-cost listing, but little assured recovery/OS/proof headroom; not the preferred pilot |
| OVHcloud VPS-2 |4 shared vCores,8 GB,75GB local NVMe |**€8.49 ex VAT base**, zero setup, default monthly/zero commitment; budget **€8.99** if the one-day-backup offer is ineligible |Datacenter stock, configured invoice, CPU latency and full GL3 proof peak |
| OVHcloud VPS-4 |8 shared vCores,24 GB,200GB local NVMe |**€23.49 ex VAT base**; conservative **€24.49** with undiscounted mandatory one-day backup; zero setup/monthly |Same hosted and promotion checks; exceeds the requested16 GB target |
| netcup RS1000G12.5 |4 advertised dedicated CPU allocations,8 GB,128 GB NVMe |**About€25 including displayed19%VAT and IPv4**; one-month minimum/billing, zero setup |Linux parity/performance, automatic EU location, independent backups |
| netcup RS2000G12.5 |8 advertised dedicated CPU allocations,16 GB,256GB NVMe |**€46.81 including displayed19%VAT and IPv4**; one-month minimum/billing, zero setup |Same deployment checks |
| netcup RS500G12.5 |2 advertised dedicated CPU allocations,4 GB,64 GB NVMe |**€14.87 including displayed19%VAT and IPv4**; one-month minimum/billing, zero setup |Too little assured headroom for an unmeasured complete L3 replay/proof path; not selected |
| netcup VPS2000G12.5 |8 shared vCores,16 GB,256GB NVMe |**€30.96 including displayed19%VAT and IPv4**; one-month minimum/billing, zero setup |Shared-CPU speed and end-to-end proof capacity |

**Cheapest practical catalog candidate found for an engine/base capacity pilot:** OVH VPS-2, conservatively about€9/month before tax. For at least16 GB RAM, OVH VPS-4 provides24 GB around€24.49/month before tax under the same conservative backup allowance. This is a shortlist, not a claim of the cheapest server in every country or a validated public-chain installation.

**More predictable CPU-allocation candidate:** netcup RS1000 at about€25/month including the displayed tax. It is guaranteed-resource KVM, not an exclusive physical server. Its extra cost buys a different CPU-allocation policy, not stronger model settings. No candidate is claimed to match the M5's speed or provide zero downtime.

## Why the marketing price differs

OVH's official Ireland catalog9905 lists VPS-2 default monthly base€8.49 and12-month upfront mode€7.21. VPS-4 lists€23.49 monthly versus€19.96 in12-month upfront mode. The public “from” prices therefore must not be quoted as cancel-anytime monthly prices. Linux and local storage have zero-price rows. Mandatory one-day backup has a100% standard offer, but its catalog contains a `minimumDuration:2` condition whose applicability to a chosen one-month order was not verified. The conservative allowances above add€0.50/€1.00 rather than assuming the offer applies. The complete6,484,811-byte catalog was fetched and its selected rows, promotions and SHA are saved.

Netcup's primary public product variants distinguish one-month billing from twelve/twenty-four-month commitments. Saved server prices exclude the standard€0.60 IPv4 component, which is added here. For RS1000, public display rounding can differ by a cent, so the user-facing comparison rounds to€25. Current availability flags are not a reservation. Named locations, customer tax and optional services can change the invoice.

Hetzner's public cloud page currently marks its cost-optimized class unavailable, so an old cheap CX43 rate is not an orderable recommendation. IONOS16 GB pricing is a three-month promotion within a one-year term, followed by a materially higher price. Contabo's primary page returned403 in this research, so no unverified cheap price was promoted.

## Evidence and primary sources

- [OVH product specifications](https://www.ovhcloud.com/en-ie/vps/) and [official public catalog](https://eu.api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=IE); [complete selected pricing rows](evidence/ovh-ie-plan-extract.json).
- [netcup RS1000](https://www.netcup.com/en/server/root-server/rs-1000-g12.5-iv-24m-eu#rs-1000-g12.5-iv-1m-eu), [one-month variant](evidence/netcup-rs1000-terms.json).
- [netcup RS500](https://www.netcup.com/en/server/root-server/rs-500-g12.5-iv-24m-eu#rs-500-g12.5-iv-1m-eu), [one-month variant](evidence/netcup-rs500-terms.json).
- [netcup VPS2000](https://www.netcup.com/en/server/vps/vps-2000-g12.5-iv-24m-eu#vps-2000-g12.5-iv-1m-eu), [one-month variant](evidence/netcup-vps2000-terms.json).
- [Earlier same-day RS2000 evidence](../price-research/netcup-public-variants-rs2000.json).
- [Hetzner cloud availability statement](https://www.hetzner.com/cloud/); [IONOS term/promotion disclosure](https://www.ionos.com/servers/vps).

Run the same immutable node/NNUE/state policy on the chosen Linux build before deployment. Preserve full24m searches if the CPU is slower; use queues or more capacity, not a weaker or silently truncated result. Stockfish still needs actual L3 state-transition/replay/prover integration before this can be sold as fully on-chain chess.
