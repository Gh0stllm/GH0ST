# Private inference-chain hosting

The current requirement is GH0ST-operated inference with very few transactions. A public RPC fleet, large Kubernetes cluster and several terabytes per node are not the initial sizing target. The actual local L3 child peaked at179.25MiB RSS and used2.08MiB of chain data in the small functional test; that excludes model loading, inference and prover peaks. Model weights, context, concurrent jobs and state history—not transaction count alone—determine the final memory/storage needs.

The 16 GB and 32 GB plans below are priced provider options, not minimum requirements. For the clean base alone, 4–8 GB RAM and 80–160 GB NVMe are smaller candidates to benchmark. No full inference, prover peak or long-term disk growth was measured, so these smaller sizes are not yet a production capacity claim.

## Latest selected-workload result

The user selected the unchanged full-strength chess engine for sizing. **72 complete-history Black decisions and five recovery searches passed**, preserving full NNUE,24m nodes,Hash128 and retained state. The simultaneous native test reached **2.463GiB sampled aggregate RSS**. This supports16GB for the measured native workload, but does not certify the unimplemented L3 Stockfish replay/prover or a16GB Linux server. [Measurement and limitations](chess-workload-20261116/README.md).

The new [monthly server shortlist](chess-workload-20261116/HOSTING.md) includes OVH8GB at€8.49 base plus up to€0.50 backup allowance, and24GB at€23.49 base plus up to€1.00, before tax. Netcup8GB guaranteed-resource KVM is about€25 including displayed19%VAT/IPv4. Hosted latency and stock are not verified; no order was made. The earlier16/32GB quotes below remain alternatives, not minimums.

Current verified netcup one-month options, with displayed19%VAT and IPv4, zero setup:

| Plan | Advertised dedicated CPU allocation | RAM / NVMe | One host / month | Two matching hosts / month |
|---|---|---|---:|---:|
| RS2000G12.5 |8 |16GB /256GB |€46.81 |€93.62 |
| RS4000G12.5 |12 |32GB /512GB |€89.50 |€179.00 |

These are guaranteed-resource KVM instances, not exclusive physical servers. Price, automatic European location and availability are public configurations, not a reservation or purchase. Backups and automatic-failover coordination cost extra. [Verified price evidence](price-research/private-sizing.json), [comparison and sources](price-research/README.md).

Preserve the chosen weights, precision, context and complete inference/search work. Cut unused RAM/disk and public-service infrastructure; do not substitute a weaker model or truncate work to fit a cheaper machine.16GB is a base-chain candidate, not proof that every future model fits.32GB provides headroom when the measured workload requires it. Hosted inference latency and peak memory remain unmeasured.

The earlier AWSmulti-AZ fleet remains a public-service/managed-availability reference, not the recommendation for this low-traffic workload. Its priced baseline is about$2,542/month, or$3,689 with a third full-size node, before variable extras. It should not be used to imply that a private GH0ST chain requires128GB and3.75TB per machine.

Single-host recovery and a two-host warm-spare setup are separate unselected options. Private usage does not waive the earlier availability goal. A single machine can preserve computation quality while still experiencing outages; two nodes require independent failure domains and tested coordination to improve availability. No literal zero-downtime promise is made.

Production would host the GH0ST child and use Robinhood RPC remotely. The local Ethereum root and RH-like parent were rehearsal infrastructure, not three servers required for our deployed chain. [Resource evidence](../integration/evidence/resource-footprint.json).

## Failover design

- Exactly one sequencer holds the coordinator lease; a synchronized standby follows its feed and can take over.
- Replicate coordination data across failure domains, with protected administration and preserved priority/lease configuration.
- Route public RPC through health/lag-aware gateways; keep admin/metrics endpoints private and isolate heavy reads from sequencing.
- Make batch posting, parent RPC access and feed relays redundant, with guarded signer/nonce ownership.
- Test node death, coordinator failover, parent/RPC loss, restart, maintenance and restoration before claiming a service objective.

Literal zero downtime is not promised. Nitro's default unplanned failover can stop sequencing for roughly the one-minute lease duration plus election/startup overhead; Redis failure can stop sequencing. AWS's qualifying99.99% regional EC2 SLA is a service-credit contract, not an end-to-end GH0ST chain guarantee. [Nitro HA guide](https://docs.arbitrum.io/launch-arbitrum-chain/run-a-node/high-availability-sequencer), [AWS SLA](https://aws.amazon.com/compute/sla/).

## Performance scope

The current clean local node uses a100ms minimum delay and measured p95 around101–105ms on the bounded ordinary EVM/Stylus fixture. That is not a hosted SLA, maximum TPS or LLM throughput. The hosted hardware, failover and sustained workloads still need measurement. Future LLM jobs must be bounded and resumable inside the deterministic chain execution; fast receipts do not establish fast model inference.

No provider account, purchase, license acceptance or real funds were used. The old ICP/ETH ceilings were removed; no replacement finite ceiling or automatic top-up was selected.
