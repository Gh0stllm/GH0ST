# GH0ST four-bit batch 1: blocked after the kernel

**1 of 25 requested contracts deployed. The remaining 24 did not deploy.**

The `FourBitAffine64` kernel succeeded and its complete runtime matches the pinned artifact. Both Alchemy and Robinhood Chain's official public RPC rejected the first weight deployments with `oversized data`. Gas estimates had succeeded; the initial preflight checked runtime and gas limits but missed the separate signed-transaction admission limit. This is a limitation of the earlier deployment validation and has now been added as a conservative guard.

| Measure | Result |
|---|---:|
| Requested / verified in this batch | 25 / 1 |
| Actual gas used | 1,150,404 |
| Actual fee | 0.000023870883000000 ETH |
| Wallet balance | 0.040418698327272000 ETH |
| Pending transactions observed | 0 |
| Wallet latest / pending nonce | 3 / 3 |
| Total deployed, including two old six-bit contracts | 3 |
| Uncompleted contracts in this batch | 24 |
| Remaining contracts in the blocked layout | 496 |
| Remaining local modeled gas for the blocked layout | 10,552,755,322 |
| Top-up needed now | 0 ETH; resolve the size blocker first |

Kernel: [`0x0200026e314067c01ac69665d2386d45d156e7b8`](https://robinhoodchain.blockscout.com/address/0x0200026e314067c01ac69665d2386d45d156e7b8).
Transaction: [`0x786ea0c2e21e29615f93aadfb12f02bdd41c17303895365534084ecb62e62c67`](https://robinhoodchain.blockscout.com/tx/0x786ea0c2e21e29615f93aadfb12f02bdd41c17303895365534084ecb62e62c67).

All 25 signed hashes were reconciled: the kernel has a receipt; all 24 remaining hashes were absent from both transaction and receipt queries. The first three weight submissions were rejected; the remaining 21 were not submitted. No rejected transaction consumed gas. The original journal is retained, all temporary key files were removed, and there is no automatic continuation. These are RH receipt checks, not a claim of Ethereum finality.

The 0.016 ETH batch cap and 0.002 ETH reserve were respected. Total spending including the prior six-bit pilot is 0.000307731672728000 ETH and 15,221,770 gas. Balance reduction exactly equals the new kernel's receipt fee.

The runtime-code limit of 96 KiB does not imply that a raw creation transaction of that size is accepted. Upstream Nitro defaults to a 95,000-byte transaction limit, consistent with the observed rejection; the exact RH configured boundary has not been measured. The runner now conservatively checks the full signed transaction size for every batch item before signing.

**The earlier 499-contract raw-initcode plan is not deployable as written.** Using 94,800-byte raw weight payloads would instead require 513 weight contracts, or 517 contracts including the kernel, index and old pilot. Preserving the under-500 target requires a revised encoding. Lossless constructor decompression is a possible approach, but is not implemented or gas-validated here. Changing the encoding requires a fresh review of bytecode, gas limits, signed hashes and the saved journal. No alternate layout has been broadcast.

Remaining gas/ETH quotes from the attempts describe the blocked layout and must not be treated as a funding instruction. Obtain fresh estimates after the encoding is corrected.

Snapshot: 2026-10-20T14:50:49.049817+00:00.

[Machine-readable report](batch-0001.json) · [Deployment journal](deployment-state.json) · [Hash reconciliation](reconciliation.json) · [Runner and recovery controls](../DEPLOYMENT.md)
