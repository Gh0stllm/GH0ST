# GL3 research history

[Overview](../../README.md) · [Findings](FINDINGS.md) · [Roadmap](ROADMAP.md)

This is the sequence of research decisions reconstructed from versioned source, test records and deployment plans. Stages are chronological; they do not imply that every experiment ran publicly or at a precise recorded minute. Earlier failed and incomplete approaches remain available in their original folders.

## 01 · Preserve the hard chess policy

The early3m-node, cache-cleared native reference had a repeatable legal White checkmate. Retaining state repaired that selected attack family, and the later candidate increased Black's work to24m nodes with the full network and Hash 128. Two complete native games against48m White ended in legal Black draw claims. Those selected games do not establish public win odds or prize-pool safety.

**Evidence:** [Complete game history and limitations](../chess/benchmarks/README.md), [selected strength policy](../chess/l3/architecture/manifest.json).

## 02 · Measure ICP before projecting economics

The actual optimized ICP engine preserved the network and search policy while reducing measured update/coordination cost. Exact retained-state checkpoint research restored future full 24m searches without changing their results. The projected cost of20 repeated paths did not establish the cost of20 independent histories.

**Evidence:** [Optimized engine](../chess/engine/optimized/README.md), [checkpoint research](../chess/engine/prefix-cache/README.md), [historical cost study](../chess/ops/hybrid/BUDGET_100.md). Earlier budget documents describe that stage; the L3's retired ceilings are not active requirements.

## 03 · Explore a GH0ST-gas L3

The design moved toward a self-operated child chain settling to Robinhood, with GH0ST proposed as native gas. Creating another layer changes execution economics; it does not eliminate CPU work, parent ETH charges, validation or licensing. The SDK's default1WETH validator bond is a configuration/security choice, not an unavoidable software purchase fee.

**Evidence:** [L3 architecture](../chess/l3/architecture/README.md), [native-gas study](../chess/l3/core/gas/README.md).

## 04 · Build reproducible compute primitives — 16 November

A standard Stylus dot-product contract was normalized for real Nitro activation. The separate complete TinyStories INT8/Q12/context64 runtime matched3,216,448 logits against native/Wasm/oracle implementations. That small language-model fixture is neither Qwen nor the chess engine. The custom model lane required different state-transition and replay artifacts.

**Evidence:** [Actual Stylus checks](../chess/l3/nitro/stylus-native/README.md), [complete small-model runtime](../chess/l3/llm/README.md), [persistent bridge](../chess/l3/bridge/README.md).

## 05 · Verify native/replay build boundaries — 16 November

The model ABI ran through actual local Geth/ArbOS storage. Transaction-local write filtering preserved tested state roots and reduced fixture gas; it did not improve measured CPU time. A custom replay machine was generated, but full model-bearing block replay and a fraudulent-result challenge were not executed. Debug gas allowances were not production fee quotes.

**Evidence:** [Nitro integration](../chess/l3/nitro/README.md), [experimental replay machine](../chess/l3/nitro/replay/README.md).

## 06 · Prioritize the base chain — 16 November

The user chose to build the fast L3 first. The initial core therefore returned to pristine standard Nitro/Stylus, ArbOS 61, debug extensions off and the official machine root. The old ICP/ETH L3 ceilings were removed. This did not order hosting, accept a license or enable automatic top-ups.

**Evidence:** [Clean core](../chess/l3/core/README.md), [active deployment intent](../chess/l3/core/deployment/intent.json).

## 07 · Measure local responsiveness — 16 November

The clean 100 ms-delay profile completed96/96 lightweight native/Stylus transactions. The worst workload p95 was about 105 ms. The bounded8-sender observation was not a saturation test, hosted SLA or model-throughput measurement.

**Evidence:** [Pinned node and benchmark](../chess/l3/core/node/README.md), [receipts](../chess/l3/core/node/evidence/receipt-benchmark.json).

## 08 · Complete a real local nested rollup — 16 November

An actual local Ethereum Geth root enabled the connected Nitro parent to supply real parent-block metadata. The child booted with its validated genesis, received native gas through a GHMOCK bridge deposit, mined an ordinary transfer and posted its signed bytes in parent batch2. No header rewriting or synthetic system precompile was used. Local fake funds, accelerated finality and disabled staking/block validation do not establish a secure public deployment.

**Evidence:** [Reproducer and exact receipts](../chess/l3/core/integration/README.md).

## 09 · Correct the hosting workload — 16 November

The user clarified that GL3 is private, very low traffic and intended for the project's compute. Public-RPC fleets and multi-terabyte public-sequencer guidance ceased to be the active sizing target. The deployable local child peaked at 179.25 MiB RSS with 2.08 MiB fresh data; model, staker, block-validator and prover work were excluded. The 16/32 GB quotes were retained as options, not minimums. Private usage did not waive availability requirements.

**Evidence:** [Role-separated footprint](../chess/l3/core/integration/evidence/resource-footprint.json), [private hosting proposal](../chess/l3/core/hosting/README.md).

## 10 · Select full-strength chess for the 16 GB test — 16 November

The user selected the unchanged chess engine rather than the TinyStories demo. The active test repeats every Black inference decision in two complete published games, checks exact move/nodes/depth, and measures retained-state save/restore peaks. It does not pretend that Stockfish is already integrated into the L3 state transition or fraud prover.

**Evidence:** [Experiment plan and methodology](../chess/l3/core/hosting/chess-workload-20261116/README.md). Results will be added after completion; unfinished work is not a pass.

## 11 · Create a dedicated GL3 research branch — 16 November

`research/GH0ST-L3-GL3` preserves the source history inherited from the chess research branch. A new cover, overview, findings, roadmap and this notebook make the chain research navigable. Subsequent findings are appended in sequence and tied to their artifacts; earlier unsuccessful experiments are not erased.

**Baseline:** [Verified inherited public snapshot](https://github.com/Gh0stllm/GH0ST/commit/b27fcb92e93d07073b4859b2c834909a03fc42b5).


## 12 · Finish the unchanged chess workload — 16 November

All 72 Black decisions across the two complete recorded histories reproduced the exact move/nodes/depth at the full24m budget. The simultaneous searches and exact checkpoint-recovery probe produced a2.463 GiB sampled peak; the largest single native game process peaked at490.14 MiB. Five recovery searches preserved future results and reset state. This is a native memory-capacity screen, not a fresh strength campaign or a working L3 chess prover.16 GB is supported for the measured engine, while complete on-chain L3 capacity remains unverified.

**Evidence:** [Complete measurement](../chess/l3/core/hosting/chess-workload-20261116/README.md), [all 72 decisions and identities](../chess/l3/core/hosting/chess-workload-20261116/evidence/results.json), [raw memory samples](../chess/l3/core/hosting/chess-workload-20261116/evidence/memory-samples.csv).

## 13 · Resolve cheaper monthly billing — 16 November

The complete official OVH catalog distinguished default monthly pricing from annual-upfront marketing prices. It also exposed mandatory backup pricing and a conditional100% offer, so the shortlist retains a conservative undiscounted allowance. Netcup's exact one-month variants established smaller guaranteed-resource options without assuming a two-year commitment. Shared CPU does not justify weakening the engine; its hosted search time still needs measurement. No server was bought.

**Evidence:** [Server comparison and source records](../chess/l3/core/hosting/chess-workload-20261116/HOSTING.md).


## 14 · Integrate the full engine and prioritize sustained CPU — 16 November

The user authorized full Stockfish integration into GL3 with replay and proof tests, preserving the full network,24m-node budget, Hash128 and retained game state. The first direct native/scalar-Wasm decision matched exact move/nodes/depth and its entire canonical retained state. Four-decision parity, actual GL3 calls and full proofs remain in progress. The server target changed to up toUSD100/month, with sustained CPU performance and recovery taking precedence over the cheapest shared VPS. No server was rented.

**Evidence:** [Active integration](chess/README.md), [first complete decision](chess/evidence/first-scalar-parity.json).
