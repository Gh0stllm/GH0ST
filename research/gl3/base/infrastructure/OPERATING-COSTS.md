# Selected host · operating-cost projection

The live cleanup read leaves one CPU5c pod, `9fu9ldfpioy14f`: **32 vCPU / 64 GB**, at **$1.12/hour for compute**. The attached standard network volume is `hb0wpuifqx`, **1,000 GB**, plus a **64-GB container disk**. These are the selected test/future-launch resources; public mainnet is not running.

| If kept running for 30 days | Estimated USD |
| :--- | ---: |
| Compute: 720 hours × $1.12 | 806.40 |
| Standard persistent volume: 1,000 GB × $0.07 | 70.00 |
| Container disk: 64 GB × $0.10 | 6.40 |
| **Host plus disks, before tax** | **882.80** |

The hourly compute price comes from the fresh Runpod pod read. Storage uses the current [network-volume rates](https://docs.runpod.io/storage/network-volumes) and [container-disk pricing](https://www.runpod.io/pricing). This is arithmetic at those rates, not an invoice. The volume retains its storage charge until deleted. No additional worker or GPU is included.

Parent deployment/posting ETH, validator collateral, any paid parent-RPC allowance, independent backups, redundancy and taxes are separate. The final launch packet must specify them before presenting a complete operating budget. One pod does not establish zero downtime or cross-host recovery. No automatic top-up is configured by this cost report.

[Machine-readable calculation](operating-costs.json) · [Verified worker cleanup](cleanup-only-big.json)
