# Hosting and availability proposal

For the strongest managed availability lane, use AWS across multiple availability zones. The current priced baseline is two i7i.4xlarge nodes (16vCPU,128GiB,3.75TB local NVMe each), replicated Redis coordination, load balancing, lightweight relay/proxy workers and backups. Add an independent full validator/RPC node for better role and failure isolation. The exact region must be selected using Robinhood RPC and user latency measurements, stock and a complete quote.

[Current source-backed prices](price-research/README.md) are about$2,542/month for that baseline or$3,689 with the third full-size node, using730hours in us-east-1. These are estimates before variable traffic, monitoring, RPC services, operations/support, taxes and chain settlement; they are not a hosting order. A fully isolated RPC fleet or larger coordinator adds cost. Local NVMe is ephemeral, so replicas, durable recovery data and restoration tests are essential.

Hetzner dedicated hardware is a lower-cost alternative with more operations owned by the project. Two currently priced AX102-1 machines total€514.60/month plus€258 setup, excluding VAT/IPv4; that SKU is128GB DDR5 **without ECC**. The ECC AX102-3 needs a separate verified quote. Do not describe one host, RAID or two colocated containers as high availability.

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
