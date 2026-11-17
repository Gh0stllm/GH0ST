# Matched Nitro baseline · sixteen ERC20 transfers

**Private benchmark passed.** The official Nitro client sequenced the exact sixteen signed transactions exported by the ethrex proof workload, posted them in one actual parent batch, and an independent official follower reproduced the results from that inbox without a sequencer feed. This is ordinary native validation, not a fraud proof or a ZK proof.

| Measured phase | Result |
| --- | ---: |
| Native sequencing, submit → all receipts | **266.52 ms** |
| Sequencer CPU during that window | **0.04 s** |
| ERC20 execution gas | **833,848** — identical to ethrex native replay |
| Child packing | 16 transactions / 2 blocks / 1 posted batch |
| Compressed batch data / whole parent calldata | **1,542 / 2,052 bytes** |
| Actual parent receipt gas | **179,241** |
| Parent compute / its own L1 posting component | 175,613 / 3,628 gas |
| Post trigger → follower observed target | 2,322.69 ms |
| Parent receipt observation → follower target observation | 91.73 ms |
| Follower CPU during posting/replay window | **0.09 s** |
| Whole guarded job, including setup and teardown | exit **0**, 52.233 s; kernel wait4 max RSS 475,880 KiB |

Posting timing includes a deliberate sequencer restart to release the withheld batch. The receipt/head observations are polling measurements; the CPU delta and both absolute times are retained. Setup took 40.18 seconds and is outside the sequencing measurement. The kernel `wait4` RSS value is a process/child high-water measurement, **not summed simultaneous pipeline RAM**. The shared cgroup CSV overlaps the separate ZK job and cannot be attributed to Nitro alone; individual sequencer/follower RSS snapshots are retained in the result. A single run is not a throughput distribution.

## What is matched

The fixture uses ethrex-replay `d6687b13f06f39510cf71abafe0e6a5fe2ab3c80`, seed zero, one sender, chain ID 9. Its ERC20 deployment and mint are folded into genesis. The Nitro fixture copies the actual contract bytecode and complete exported storage, restores sender nonce 2, then deposits the exact exported native balance through a real private parent inbox before timing. Independent deterministic signing reproduced **all sixteen original raw signed byte strings**. Transfer events, balances, nonce 18 and receipt gas were checked.

The actual ethrex fixture files are bound by SHA256:

- Workload: `e468b022a4138c7a88f296b808f4d7429a029667c0114242d499529f122725f0`.
- Folded genesis: `34ad33d2b13a33b7c3c2addac6b19f958ecc71c0d1d67c533251cf5b99bddfd2`.
- Normalized matching fixture: `4c7bf816770e91610827dcc12bd1e455a1badf460374a32e1f556629ffcff922`.

Nitro uses the official `v3.12.2+5f02f3f` binary SHA256 `d9e778d3c513e106dab9de8ef04be9500093b0638cfd463e4d4ec542c214c4ed` and standard machine root `0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`, ArbOS 61, debug disabled. The private stack is Geth 1337 → Nitro 4663 → Nitro 9. No public chain or user wallet was used.

## Comparison boundaries

This benchmark uses a **synthetic neutral ERC20 gas asset**, not real GH0ST. The existing real-GH0ST compatibility evidence remains separate in [base withdrawal/recovery](../../base/withdrawal-recovery/). Because the original transactions reserve gas at a very large maximum fee, the loopback sequencer's RPC admission cap is explicitly five million fixture units. It changes admission only; the EVM, block limits and stock STF remain unchanged.

Ethrex packs the sixteen calls in one Ethereum block; Nitro produced two child blocks and posted both in one batch. Whole Ethereum and ArbOS state roots and fees differ. The comparison matches contract prestate, exact signed calls, ERC20 outcomes and execution gas; the follower separately matches Nitro's own header/state/receipts exactly. Private parent gas prices are fixture prices, **not a current Robinhood or USD quote**.

The genuine SP1 proof and actual Solidity verifier/DA component measurements are separate jobs. This baseline does not implement a ZK rollup coordinator, proof-bound state acceptance, bridge or ZK withdrawals. Comparing its ordinary validation time to the duration of a full BoLD dispute would be misleading.

## Evidence and preserved failures

[Result](evidence/result.json), [direct exit](evidence/actual-exit.json), [controller acceptance](evidence/controller-result.json), and [independent raw receipt/config/source/cleanup audit](evidence/independent-audit.json) are readable separately. The [236-member evidence capsule](evidence/nitro-baseline-evidence.tar.gz) includes actual parent/child/follower receipts, parent transaction calldata, public configuration, genesis, fixture, source manifests and both earlier failed attempts. The capsule is 569,367 bytes, SHA256 `8f0e9bf928659d3e129a241a153f88dea1e6c1501d03459ecc33a38881f8055a`; every member was round-trip hashed on Runpod. Private key/config files and closed databases are excluded.

Two setup failures are retained without accepted timed results: the copied adapter initially restricted the child ID to 4663007 (exit 1 / 39.191 s), then a non-sequencer follower required explicit `execution.forwarding-target="null"` (exit 1 / 134.698 s). The third fresh attempt passed with child 9 and forwarding disabled. All six owned processes exited successfully and were independently confirmed absent. All execution occurred on Runpod under a two-CPU, five-minute, 1 GiB owned-file guard; no local tests or chain writes occurred.
