# GL3 · current findings

**17 November 2026 · Base-chain build, without chess.**

[Active work](base/README.md) · [History](HISTORY.md) · [Roadmap](ROADMAP.md)

| Question | Verified observation | Boundary |
| :--- | :--- | :--- |
| Does the clean base execute Solidity and Stylus? | Official Nitro returns EVM 42 and activated Stylus signed-dot −31; 16/16 measured transactions pass | Private fixture; no deployed public GL3 |
| Can GH0ST serve as the native gas token? | Private native parent/child deposit 4, spend 1, burn/release 0.5 with exact token accounting | Frozen real runtime, explicit sparse balance-owner remap, unit-rate fixture pricer and privileged confirmation |
| Can the ordinary process recover abruptly? | Actual SIGKILL, identical binary/config and three persistent DBs; exact head/state recovery in 743 ms | Same-host acknowledged-state process crash; not arbitrary power loss or host replacement |
| How responsive is the base? | 100 fresh-account transfers: 101 ms median, 109 ms p95, 123 ms maximum | Local estimate/sign/send/receipt sample; not sustained throughput or an SLA |
| How much storage did that sample add? | 1,013,760 allocated bytes and 782,711 logical bytes | 100 light transactions only; no long-run extrapolation or pruning acceptance |
| What is running now? | One 32-vCPU / 64-GB worker with 1,000-GB persistent volume; temporary workers deleted | Infrastructure only; mainnet not deployed |
| Does the full private permissionless dispute settle? | Yes: honest assertion confirmed, stake refunded and replay rejected; actual 0 / 235.945 s | Private Geth / standard-ETH child fixture; public mainnet and final production-native-token configuration remain unaccepted |

[Private flow result](base/withdrawal-recovery/evidence/result.json) · [Independent audit](base/withdrawal-recovery/evidence/post-run-audit.json) · [Infrastructure cleanup](base/infrastructure/cleanup-only-big.json)

The base uses standard ArbOS 61 and the official `c10` machine. No custom model or chess state transition is enabled. The 2.59-TB estimate belongs to the deferred chess experiment, which remains preserved below.

<details>
<summary>Preserved earlier local and chess findings</summary>

# Current findings

[Overview](../../README.md) · [History](HISTORY.md) · [Roadmap](ROADMAP.md)

## Verified locally

| Question | Finding | Practical limit |
| --- | --- | --- |
| Does the standard base execute? | Real Nitro/Stylus node; standard source and official consensus-v61 machine | No public GL3 deployment |
| Is the base responsive? |96 lightweight successes; configured 100 ms minimum block delay; worst workload p95 ≈105 ms | Local M5, not sustained capacity or inference latency |
| Does the nested token/transaction route work? | Real local Geth → Nitro → Nitro, GHMOCK lock/native credit and exact signed transaction in parent batch2 | Mock funds, development finality; no fraud challenge |
| How large is a fresh child? |179.25 MiB peak RSS;2132 KiB allocated chain-data directory | No model, staker, block-validator or prover peak included |
| Is the chess model small enough to inspect? | Full NNUE98,511,183bytes; pinned SHA and full 24m-node policy | File size is not live execution memory |
| Does full chess execute inside the custom STF? | Four native/Wasm state fixtures match; actual mined move and independent complete native block replay passed | Custom debug-only research profile; full WAVM replay and live dispute not complete |

[Core evidence](../chess/l3/core/README.md) · [Full-strength workload](../chess/l3/core/hosting/chess-workload-20261116/README.md)

## What controls hardware sizing

**RAM** holds the full neural network,128 MiB transposition table, histories, search/runtime memory, checkpoint copies and chain/replay/prover state. Fixed node count preserves the work even on a slower CPU. Fewer concurrent searches can reduce peak RAM without reducing each decision's work.

**CPU** controls how long24m nodes take. Shared hosting can change latency and jitter without changing the configured search budget. A hard time deadline must not silently return a reduced search.

**Disk** holds executable/model artifacts, committed state, retained checkpoints, history and operational logs. Very few transactions help history growth; one heavy state transition or repeated full checkpoint persistence can still create significant work. Build caches are not mandatory production chain storage.

The team needs the GL3 child and parent RPC connectivity, not locally hosted full Ethereum and Robinhood chains. The extra two layers in the functional test were test infrastructure.

## Economics that remain real

GH0ST native gas does not remove parent ETH posting charges. The SDK requires an explicit compatible custom-token fee-pricer configuration; its rate and safe reimbursement policy remain unselected. Validator collateral, custody, license applicability and independent recovery still need review. A small single host can preserve computation quality while remaining a single failure domain.

The earlier large AWS fleet is a public-availability reference, not a private-chain minimum. Current smaller provider quotes and their billing terms are in the [hosting study](../chess/l3/core/hosting/price-research/README.md). The active budget is nowUSD 100/month. A late sample of the full WAVM prover reached14.63 GiB RSS before completion;24 GB is the user-selected target; the actual node/prover overlap screen and Linux acceptance remain separate checks.

## Claim policy

A local benchmark is not a hosted acceptance test. A compiled replay artifact is not an executed proof. A native engine beside a node is not verified on-chain inference. Public execution requires receipts and deployed artifact identities. Each new result records the exact policy, runtime, hardware, resource scope and remaining gaps.


## Full-strength chess memory result

The two complete recorded game histories executed **72 Black decisions at the unchanged 24m-node policy**, matching every prior move, actual node count and completed depth. Five additional 24m searches verified exact retained-state recovery. One game engine peaked at490.14 MiB; the recovery probe peaked at1.46 GiB. The simultaneous workloads plus harness reached a **2.463 GiB sampled aggregate peak** on the24 GiB M5 host.

This supports16 GB for the measured native engine workload; it is not a16 GB Linux acceptance test or a complete L3 chess/prover memory certificate. No new strength or win-rate games are claimed. [Full report](../chess/l3/core/hosting/chess-workload-20261116/README.md), [exact evidence](../chess/l3/core/hosting/chess-workload-20261116/evidence/results.json).

![Exact memory data in GH0ST's dot-matrix style](assets/memory-results.svg)

The lowest practical shared-CPU catalog candidate found is OVH8 GB at€8.49 base, conservatively€8.99/month before tax with the undiscounted backup allowance. For at least16 GB, its24 GB plan is€23.49 base, conservatively€24.49 before tax. A netcup8 GB guaranteed-resource alternative is about€25 including displayed19%VAT and IPv4. Stock, invoice eligibility, Linux parity and hosted performance remain unverified. [Pricing rows, terms and primary sources](../chess/l3/core/hosting/chess-workload-20261116/HOSTING.md).


## Active full chess integration

The98.5 MB network and24m-node/Hash128/one-worker policy are unchanged. Four consecutive decisions reproduce exact move, actual nodes, depth and all 163,085,439 canonical checkpoint bytes across native/scalar-Wasm. The native vector binary remains byte-identical after the build-recipe update.

The custom ArbOS extension executed a full move in an actual local Nitro block and included it in a real local Ethereum-parent batch. A separate complete native replay, using only recorded inputs, reproduced the exact block hash, send root and inbox position. Full-model/state corruption, caller isolation, retries and one-gas-short rollback passed. The full WAVM replay is in progress; ten initial OSP witnesses, an independently reproduced100b-step point and real Worker::search arithmetic/memory witnesses passed actual Solidity verification, with corrupted witness/pre-state rejection.

The full prover's partial late-start samples already exceed14 GiB RSS; the earlier2.463 GiB native capacity screen does not cover that proof workload. The current24 GB/USD 100 direction supersedes the cheapest shared-CPU recommendation above. No host has been rented. Linux SSE4.1 is a prepared candidate, not a tested deployment. AVX2's accumulator-lane layout requires a separately verified canonical-state adapter before promotion.

[Engine/replay evidence](chess/README.md) · [Current host candidates](chess/HOSTING.md)

</details>
