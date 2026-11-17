# Automated GL3 demonstration activity

This packet prepares genuine, clearly labelled demo transactions. It does not represent organic adoption, financial volume, backed assets, or a throughput benchmark. It changes no node, validator, poster, supervisor, or block configuration.

The public draft remains **activationApproved: false**. Root owns the dedicated demo wallet, its funding review, and the separate launch approval. Preparation read no private wallet files and signed/sent no live transactions. The actual public preflight observed the dedicated account funded with 100,000 native GH0ST, nonce zero, and empty predicted contract addresses.

Root subsequently approved a private clone and launched the worker once. The independent observation at child block 177 verified 162 canonical receipts, all three exact deployed runtimes, and actual pulse/token/NFT accounting. The first 120-second activity window contained 133 demo transactions in 133 demo-containing blocks, each with one demo transaction. Activity fees in that window were 452.17961 GH0ST; deployments are separate. The observer saw 162 other transactions across the full 162-block range and does not label them as demo or organic users. The worker remained running with one pending transaction. These observations are a saved snapshot, not a promise of future cadence or liveness.

## Intended activity

- One `GL3AutomatedDemoPulse.pulse()` call per one-second tick.
- Every tenth tick also transfers one explicitly worthless `GL3DEMO` test token to the dead-address sink.
- Every thirtieth tick also mints an explicitly worthless demo NFT to the demo operator.
- Thus the nominal mix is 34 transactions per 30 ticks: one transaction most ticks, two or three periodically. Backpressure can skip actions. There is no catch-up burst.

The existing 100 ms block target remains unchanged. Submission timing can split a burst across blocks. System/report messages may add transactions. Actual transactions per block and observed cadence must be measured after launch; this preparation makes no batching or throughput acceptance claim.

All contract names, NFT metadata, transaction labels and status descriptions identify automated demos. The token has fixed supply and no backing/redemption promise. The NFT has a finite collection cap. Neither is priced as economic volume.

## Evidence

All compilation, tests, RPC estimates and resource checks ran on the existing Runpod pod. Solidity 0.8.30 with optimizer 200 and Shanghai output is pinned in the artifacts. Fifteen final tests passed, including actual deployment and execution on an isolated in-memory EVM, exact runtime comparison, token accounting/allowance, NFT ownership/transfer, operator authorization, durable journal/lock checks, uncertain broadcasts, nonce drift, reorgs, failed receipts, finite budgets and pending backpressure. That isolated test chain is separate from live GL3.

Final live read-only estimates include the current ArbOS posting estimate:

| Action | Estimated native GH0ST |
| --- | ---: |
| Zero-value self-transfer pulse | 4.30630 |
| Steady counter pulse | 4.48424 |
| Steady test-token transfer | 6.36921 |
| Steady NFT mint | 4.76907 |
| All three contract deployments, once | 135.51656 |

At the current quote, the default mixed activity projects **19,008.468 GH0ST/hour**. After estimated deployments and the retained 100 GH0ST reserve, finite funding of 10k / 50k / 100k GH0ST projects roughly **0.51 / 2.62 / 5.25 hours**. If the entire 125% gas limit were charged, the corresponding scenarios are 0.41 / 2.09 / 4.20 hours. These are projections, not paid fees or guaranteed runtime. The worker obtains fresh quotes, and posting prices/compression can change.

`eth_estimateGas` simulations of deployed calls use explicitly recorded runtime/storage overrides at empty addresses. They are not mined deployments. NodeInterface component estimates were not accepted for override-mode inner calls, so no compute-only claim is derived from them. The initial RPC quantity-format failure and preliminary component experiment remain under separate attempt directories.

`parent-cost-reference.json` separately authenticates a historical posted batch: 150,791 gas and 516 calldata bytes. At the sampled parent quote, 360 batches of exactly that historical shape would cost about 0.001086 ETH/hour. **That is a historical reference, not a quote for this new workload.** A pilot must measure actual parent batch shape, frequency, data compression and poster ETH cost. No automatic funding/recycling or cold-wallet topup exists.

## Worker safety and persistence

The wallet is exclusively the dedicated demo account, not Cold, the deployer, poster or validator. Every transaction has zero native value; native GH0ST is spent only on the approved demo transaction gas. All three expected contract addresses and exact runtime bytes are checked before activity.

The private journal is append-only, hash chained, 0600, exclusively locked and bounded to 128 MiB. An exact signed transaction intent is appended and fsynced before broadcasting. Nonces are consecutive and reconciled against latest/pending counts, known transaction hashes and canonical child receipts. An uncertain send stops immediately. Restart queries existing hashes; it never automatically resubmits or replaces an absent/ambiguous intent. Truncated/tampered journals, stale locks, unexpected nonce activity, failed receipts, recent reorgs and pending timeouts require operator review.

Up to four transactions may be pending. Each new submission reserves the full worst-case cost of all pending transactions, plus a retained 100 GH0ST balance. Both current balance and the finite 100k session budget are checked. Additional deposits do not enlarge that budget. The gas limit is 125% of a fresh live estimate and max fee is twice the current live quote; fee caps reserve balance and are not necessarily paid in full.

The root-invoked controller runs once, with nice 10, two CPU affinity, 1.5 GiB JS heap, 2 GiB sampled aggregate owned RSS, 56,000,000,000-byte whole-pod working-set guard and 6 GiB free-root-disk floor. The draft wall deadline is six hours, with a separate 100,000 transaction maximum. It stops only its own process group, records actual exit/remaining PIDs and never automatically retries. Source syntax/cgroup/RSS/owned-only dummy cleanup checks passed; the funded live controller had not been launched when this packet froze.

Child receipt checks establish local sequencing/canonicality, not parent finality. The worker checks the latest 64 saved receipts for reorgs; it is not a complete historical settlement auditor. Exact signed intents and runtime logs remain in the private demo state directory and must not be exported publicly.

## Root launch handoff

1. Review `evidence/freeze.json`, the funding receipt, source and the public draft. Verify the dedicated address, chain 4663001, block-zero hash, exact artifacts/source hashes, budget, cadence and finite bounds.
2. Root alone writes a new private approved configuration by changing the draft approval bit after review. Preserve the approved file bytes/hash. No private key/password belongs in that configuration or command line; it refers only to the existing dedicated key file.
3. Root invokes `run-guarded.py` through the durable runtime wrapper, with `GL3_DEMO_APPROVAL_SHA256` set to that exact approved configuration hash. No launch occurred during preparation.
4. Observe the first minute: real contract creations, actual transaction/block distribution, receipt gas, balance spend, pending depth and node/poster health. Keep system transactions separate from demo transactions. Stop the owned worker if the measured behavior is unsuitable.
5. A stop or crash is reconciled before any restart. Never remove a stale lock until the recorded process is proven gone. Never replace an uncertain transaction or top up automatically.

The source/artifact freeze is immutable. Later live observations belong in a separate evidence directory.
