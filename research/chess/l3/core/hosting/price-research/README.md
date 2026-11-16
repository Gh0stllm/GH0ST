# Hosting price reference — 16 November 2026

For availability infrastructure, **AWS across availability zones** is the stronger fit. For dedicated high-clock CPU value, **Hetzner AX102** is the cheaper alternative. Neither provider makes the whole chain immune to downtime; Nitro's documented default sequencer failover can pause production for about a minute after a crash. AWS's qualifying **99.99% regional EC2 SLA** concerns compute connectivity and service credits, not uninterrupted chain operation. Sources: [Nitro HA guide](https://docs.arbitrum.io/launch-arbitrum-chain/run-a-node/high-availability-sequencer), [AWS SLA](https://aws.amazon.com/compute/sla/).

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
