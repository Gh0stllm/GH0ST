# Hosting price reference — 16 November 2026

## Current sizing: a small private deployment

The user clarified that the chain will have very few transactions and will serve the team's inference work. **The larger AWS fleet below is now a public-HA reference, not the recommendation.** A small private deployment can preserve model weights, precision, and the full inference work while avoiding a public RPC fleet. There are two options: **one host with checkpoint/backups and manual recovery**, which has a downtime tradeoff, or **two hosts that can each complete the same workload**, with coordinated failover. Private usage does not waive the earlier availability goal, and neither option has been selected. Hosted latency and recovery time remain unproven.

The actual deployable L3 child measured **179.25 MiB peak RSS** and **2.08 MiB chain data** in the local deposit/transfer/batch rehearsal. This is base-node evidence only: LLM and fraud-prover peak memory remain unmeasured. **4–8 GB RAM and 80–160 GB NVMe are smaller base-only candidates to benchmark**; the priced 16–32 GB plans below are options, not minimum requirements. Full inference, replay/prover peaks and retained history must fit without changing the selected model or work. The current small TinyStories fixture is not a port of a future Qwen2B model. Production hosts only the child and uses Robinhood RPC; the local Ethereum root and RH-like parent were test fixtures. See [resource evidence](../../integration/evidence/resource-footprint.json).

The strongest lower-cost dedicated-resource candidate found is **netcup G12.5**, with AMD EPYC 9645, DDR5 ECC and NVMe. These are KVM VMs with guaranteed CPU/RAM resources, not whole dedicated physical servers. “Dedicated cores” below is the provider's allocation wording; it is not a verified exclusive physical-core count.

| netcup configuration | Resources | Monthly price shown, including 19% VAT |
| --- | --- | ---: |
| [RS 2000 G12.5](https://www.netcup.com/en/server/root-server/rs-2000-g12.5-iv-24m-eu) | 8 advertised dedicated cores, 16 GB, 256 GB NVMe | **€34.60**, 24-month term and 24-month billing |
| [Same RS 2000, one-month option](https://www.netcup.com/en/server/root-server/rs-2000-g12.5-iv-24m-eu#rs-2000-g12.5-iv-1m-eu) | Verified public product variant: one-month contract and billing, zero setup, IPv4 + IPv6 | **€46.81**, including displayed 19% VAT and IPv4 |
| [RS 4000 G12.5](https://www.netcup.com/en/server/root-server/rs-4000-g12.5-iv-24m-eu) | 12 advertised dedicated cores, 32 GB, 512 GB NVMe | **€66.16**, 24-month term and 24-month billing |
| [Same RS 4000, one-month option](https://www.netcup.com/en/server/root-server/rs-4000-g12.5-iv-24m-eu#rs-4000-g12.5-iv-1m-eu) | Verified public product variant: one-month contract and billing, zero setup, IPv4 + IPv6 | **€89.50**, including displayed 19% VAT and IPv4 |

The exact read-only configured pages verify **€0 setup**, IPv4 + IPv6 included, and **automatic European location selection**. The one-month RS 4000 public variant (product ID 6549) confirms a **one-month minimum and one-month billing**, raw server price €88.90 gross (€74.71 net), plus the standard €0.60 gross IPv4 component, totaling **€89.50**. RS 2000's one-month variant (ID 6534) likewise shows €46.21 gross (€38.83 net) plus €0.60 IPv4, totaling **€46.81**. Factual data is retained in `netcup-public-variants.json` and `netcup-public-variants-rs2000.json`. The [official networking explanation](https://www.netcup.com/en/blog/root-server/extended-network-configuration) confirms the IPv4/IPv6 option and €0.60 difference for removing IPv4. A named location or Singapore adds cost. Billing country can change tax; these are the page's German 19% VAT figures, not an India invoice quotation. The two-year prices imply advance billing and must not be presented as cancel-anytime monthly offers. No term, location, tax status, or server has been selected. Provisioning-delay notices are present; capacity is not reserved. Snapshots are available, but independently recoverable offsite backups remain a separate requirement and cost.

**For a private 32 GB candidate, review one-month RS 4000 pricing around €90 per host plus independent backups**, conditional on the selected quote and replay/inference measurements. Two same-size hosts are about **€179/month before backup and coordination services**, with full workload capacity required on each. One host is the cheaper option but has a downtime tradeoff; it is not assumed acceptable. RS 2000 around €47 per host is a lower-cost candidate if the measured full workload fits unchanged. The [netcup overview](https://www.netcup.com/en/server/root-server) lists one-, twelve-, and twenty-four-month terms. Its two amounts per card are discounted and reference prices; they must not be mislabeled as net/gross VAT conversions. No two-year commitment is recommended by default.

Hetzner dedicated-vCPU alternatives are current **CCX23: 4 threads / 16 GB / 160 GB NVMe at €85.99/month**, or **CCX33: 8 threads / 32 GB / 240 GB NVMe at €138.49/month**, EU, excluding VAT/IPv4. With the provider's 20% backup option and €0.50 IPv4, totals are **€103.69** and **€166.69**, excluding VAT. These are current June-2026 prices, not obsolete €31/€62 prices. [Price table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), [CPU isolation](https://docs.hetzner.com/cloud/servers/faq/), [backup billing](https://docs.hetzner.com/cloud/billing/faq/), [IPv4](https://docs.hetzner.com/cloud/servers/primary-ips/overview/).

OVH's current public pages advertise cheaper shared-CPU VPS starting prices, including **VPS-2: 4 vCores / 8 GB / 75 GB NVMe from €7.21 ex VAT**, and **VPS-4: 8 vCores / 24 GB / 200 GB NVMe from €19.96 ex VAT**. These are **starting prices, not verified configured quotes**; term, exact location and orderable stock remain unresolved. They are valid base-only price research, but shared-vCPU latency must not be marketed as equal to exclusive CPU allocation. Its SYS-3 page/listing configuration also remains unresolved; the older €71.99 claim is not verified. [OVH VPS](https://www.ovhcloud.com/en-ie/vps/), [OVH shared virtual infrastructure explanation](https://www.ovhcloud.com/en-ie/vps/vps-intel/).

AWS's smaller non-burstable `r7i.large` (2 vCPU / 16 GiB) is **$96.58/month compute**, and `r7i.xlarge` (4 vCPU / 32 GiB) **$193.16/month compute**, in us-east-1 at 730 hours. With 256 GB gp3, IPv4, and 50 GB S3 backup, the one-node examples are **$121.86** and **$218.44** before tax/traffic. They use network EBS, not included local NVMe. See `aws-private-offer-extract.json` for exact current offer rows.

The machine-readable current proposal is `private-sizing.json`. No model settings or code are changed, no rentals or new spending caps are created, and no zero-downtime promise is made.

## Retained public-HA reference

For a future public availability deployment, **AWS across availability zones** remains the managed-infrastructure reference. Neither provider makes the whole chain immune to downtime; Nitro's documented default sequencer failover can pause production for about a minute after a crash. AWS's qualifying **99.99% regional EC2 SLA** concerns compute connectivity and service credits, not uninterrupted chain operation. Sources: [Nitro HA guide](https://docs.arbitrum.io/launch-arbitrum-chain/run-a-node/high-availability-sequencer), [AWS SLA](https://aws.amazon.com/compute/sla/).

The [Nitro sequencer hardware guidance](https://docs.arbitrum.io/run-a-node/sequencer/run-sequencer-node) recommends 128 GB or more DDR5, a newer 16-core CPU or higher, strong single-core performance, and several TB of local NVMe. More simultaneous RPC requests need more resources. These hardware classes do not establish throughput; the existing local 100 ms result must not be sold as a hosted latency or TPS guarantee.

## AWS reference bill

Region: **US East / N. Virginia (`us-east-1`)**, Linux On-Demand, shared tenancy, **730 hours/month**, tax excluded. This is a reproducible reference region; final location, network latency from users, and capacity remain unselected.

The [i7i.4xlarge](https://aws.amazon.com/ec2/instance-types/i7i/) has **16 vCPU, 128 GiB RAM, and one 3.75 TB local NVMe SSD**. AWS lists an Emerald Rapids processor at 3.2 GHz in its offer. A vCPU count is not the number of physical cores. The current [official regional EC2 price feed](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv) lists **$1.5101/hour**, or **$1,102.37/month per node** (SKU `Z7SMPYDZ89XYPJ3R`, effective 1 November 2026). The extraction deliberately selects a running On-Demand instance, not the zero-priced allocated-reservation line.

| Component | Assumption | Monthly USD |
| --- | --- | ---: |
| Nitro core nodes | Two i7i.4xlarge in separate AZs | 2,204.75 |
| Managed Redis | Three cache.t4g.small copies across three AZs | 70.08 |
| Application Load Balancer | One ALB, average one LCU | 22.27 |
| EKS control plane | Standard version support; no Auto Mode add-on | 73.00 |
| NAT gateways | Two, before data processing | 65.70 |
| Public IPv4 | Four total: two NAT plus two ALB | 14.60 |
| Root volumes | Two 100 GB gp3 volumes | 16.00 |
| Backups | 500 GB stored in S3 Standard | 11.50 |
| **Core subtotal** | Usage assumptions above | **2,477.89** |
| Optional lightweight relays/proxies | Two t3.medium plus 20 GB root each | 63.94 |
| **With lightweight relays/proxies** | Rounded planning figure | **2,541.83** |
| Optional third full-size node | i7i + 100 GB root + third-AZ NAT/IP | **+1,146.87** |
| **Three full-size nodes plus proxies** | Rounded planning figure | **3,688.70** |

The practical planning shorthand is **about $2,550/month**, or **about $3,700/month with a third full-size node**, **plus traffic, monitoring, RPC providers, support/operations, and tax**. Parent settlement gas, validator collateral, and future LLM/GPU compute are excluded. The unrounded calculations and exact pricing sources are in `pricing.json`; the rows above can differ by a cent when individually rounded.

Supporting rates come directly from official regional offers: [ElastiCache](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/us-east-1/index.json) at $0.032/node-hour for Redis cache.t4g.small, [ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/us-east-1/index.json) at $0.0225/ALB-hour plus $0.008/LCU-hour, [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json) at $0.023/GB-month, [public IPv4](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/us-east-1/index.json) at $0.005/address-hour, and [EKS pricing](https://aws.amazon.com/eks/pricing/) at $0.10/cluster-hour in standard support. The EC2 offer also verifies NAT at $0.045/hour **plus $0.045/GB processed**, gp3 storage at $0.08/GB-month, and t3.medium at $0.0416/hour before CPU-credit extras.

This is a small HA core, **not** a fully isolated enterprise public-RPC deployment. The official HA design separates full RPC nodes, sequencing, relays, coordination, and batch posting. Those roles need measured sizing. Small 1.37 GiB burstable Redis nodes are a pricing example, not validated production capacity. Three Redis copies means one primary plus two replicas in this estimate. A third full-size node's role—validator or additional sequencer—must be finalized; placing a validator there does not automatically add a third sequencer. Independent RPC fleets cost extra.

Local instance-store NVMe can disappear when an EC2 instance stops or terminates. S3 application/state backups, tested recovery, and continuously synced standbys are necessary; EBS snapshots do not back up the local NVMe disk. No On-Demand capacity reservation, region availability, discounted commitment, or failover recovery time has been tested here.

## Hetzner value alternative

The [SKU-specific AX configuration table](https://docs.hetzner.com/robot/dedicated-server/server-lines/ax-server/) lists the Ryzen **7950X3D, 16 physical cores / 32 threads**, with **two 1.92 TB datacenter NVMe drives**. RAID1 gives roughly 1.92 TB usable before operating-system overhead. The exact memory SKU matters:

- **AX102-1 / LTD: 128 GB DDR5, non-ECC.**
- **AX102-3 / LTD: 128 GB DDR5 ECC.** Its current price was not verified, so no price is invented for it.

The [official 15 June 2026 price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) lists AX102-1 at **€257.30/month + €129 setup**, excluding VAT and IPv4. Two servers are therefore **€514.60/month + €258 setup**, before Redis, frontends, backup, failover services, monitoring, and management. The limited AX102-1-LTD offer is **€157.30/month + €39 setup**, strictly stock dependent; live stock was not verified. These prices must not be attached to the ECC AX102-3 SKU or replaced with old €104 pricing.

Hetzner is a hardware-value route requiring more self-managed availability engineering. AWS offers the more cohesive managed multi-AZ lane. Current location/stock and a final configured quote must be rechecked before any order. No account was accessed, purchase terms accepted, or resource ordered.
