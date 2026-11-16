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


## 15 · Verify full native/Wasm retained state and actual EVM dispatch — 16 November

Four consecutive complete24m decisions matched the published reference across scalar native, scalar Wasm and accelerated native. All canonical retained checkpoints matched byte for byte. Two full searches then ran through actual Geth EVM/ArbOS dispatch and committed the same state. Caller isolation, stale/illegal input, corrupted model/state, retry and one-gas-short rollback passed. The latter checks actual code pages, metadata and the whole trie root. Local accelerated decisions took roughly17–20s across the measured runs, with the full model and search policy unchanged.

**Evidence:** [Integration results](chess/README.md), [all four parity decisions](chess/evidence/native-wasm-parity.json), [actual EVM checks](chess/evidence/actual-evm-dispatch.json).

## 16 · Generate the complete custom chess replay machine — 16 November

The full Go replay target and direct C++ engine companion linked into a WAVM machine with root`0xdc64c010de5e7a45fa4c83dde4e6d165ab0abf1a0f074e2ef2a086207edf3ebe`. Initialization passed. This is a build milestone; full engine-bearing block replay and Solidity proof verification remain pending. A local mined-block rehearsal is being prepared. No hosting was ordered and no public-chain funds moved.

**Evidence:** [Exact artifact identities and build boundary](chess/evidence/custom-machine-build.json), [reproducer](chess/build_replay.py).


## 17 · Mine, batch and independently replay an engine-bearing block — 16 November

A full24m decision mined on the actual local custom Nitro profile, returnede7e5 /24,000,033nodes /depth38 and the exact canonical checkpoint, and was included in its real local parent-chain batch. The native block recorder reproduced its canonical hash. A separate complete `cmd/replay` process, using only the recorded preimages and inbox batch, independently reproduced block hash, send root and final inbox position in21.83s. This experiment explicitly set100m local transaction/block gas limits and a longer queue timeout; its32.58m prototype gas is not a production fee quote.

Ten initialization-prefix WAVM witnesses passed the actual pinned Solidity OSP, including rejection of corrupted pre-state hashes and witnesses. The complete interpreter replay is running separately. Prefix proofs are not a full engine proof, and this is not a public Robinhood deployment or an executed BoLD dispute.

**Evidence:** [Mined transaction and block roots](chess/evidence/mined-block.json), [independent native replay](chess/evidence/native-replay.json), [bounded Solidity witness checks](chess/evidence/prefix-solidity-steps.json).


## 18 · Verify actual search-loop OSP witnesses and revise hosting headroom — 16 November

The selected interpreter driver reproduces an independently checked100b-step machine hash, exact witness and next state. A broad initial namespace filter matched `Worker::clear`; it was narrowed to `Worker::search`/`qsearch`, keeping initialization separate from actual search evidence. Real search-loop, arithmetic and memory witnesses from the narrowed run passed the pinned Solidity OSP. Corrupted pre-state hashes and witnesses were rejected. This collection intentionally stops at its four bounded proof points; the complete engine-bearing replay continues in the unchanged upstream prover.

Late-start samples of the full prover reached14.63GiB RSS, about15.7GB, before completion. TheUSD100 monthly direction now prefers32GB and sustained dedicated CPU; the earlier native2.463GiB capacity screen is not the full proof budget. The macOS native binary and Go replay remain byte-identical after recipe changes. A Linux SSE4.1 candidate is prepared but not tested; AVX2 needs a separately verified accumulator-layout adapter. No server was ordered.

**Evidence:** [Actual search-loop verifier results](chess/evidence/search-loop-solidity-steps.json), [reviewable witnesses](chess/evidence/search-loop-witnesses.json), [explicit bounded scope](chess/evidence/search-loop-collection.json), [preserved artifact identities](chess/evidence/native-recipe-preservation.json), [updated hosting direction](chess/HOSTING.md).


## 19 · Select24GB and run a real node/prover overlap screen — 16 November

The user selected24GB RAM while retaining theUSD100/month server budget. A second actual custom-node fixture mined the unchanged full24m move while the complete prover was running:23.85s, exacte7e5 /24,000,033nodes /depth38 and the same canonical checkpoint. The node and retained game then stayed live for a60s overlap sample. The held in-process node/validation fixture peaked at2.65GiB, with6.23GiB observed combined at sampled overlapping instants. That window does not include the full lifecycle or the full prover's earlier14.63GiB peak.

The sum of separately observed component peaks is about17.35GiB. Adding a4GiB planning reserve gives about21.35GiB; that is a sizing estimate, not a measured simultaneous peak or a hard24GB/Linux acceptance test.24GB remains a candidate for one active node/prover, with unchanged bot strength and final hosting acceptance pending. The repeat fixture shut down cleanly; no real funds moved.

**Evidence:** [Repeated full-strength move](chess/evidence/cohost24-move.json), [bounded capacity screen and limits](chess/evidence/cohost24-screen.json), [all overlap samples](chess/evidence/cohost24-samples.csv).

## 20 · Split chess work so ordinary blocks can continue — 16 November

The user required fully on-chain search without the monolithic19–24s block stall, preserving bot strength. An isolated Asyncify module now pauses recursive Stockfish work at a2,048-node scheduling quantum while retaining the full24m decision target, complete network, Hash128 and game cache. This is a build milestone. Exact completed-state parity, persistent snapshot costs, real block cadence and matching proofs remain acceptance gates. The previous full interpreter replay continues on its immutable original inputs.

**Evidence:** [Resumable implementation and gates](chess/sliced/README.md).

## 21 · Preserve exact continuation state and accelerate it — 16 November

Two consecutive full24m decisions matched every canonical retained-state byte across the original reference, a scalar continuation and SIMD128 continuation. Each test destroyed/recreated the module at three suspended points per decision. SIMD reduced the local engine experiment from319/322s to about55/58s, without changing the network, move, node count, depth or retained heuristics. A real EVM prefix passed retries, generation/cursor guards, whole-trie OOG rollback and cold resumption from committed VM pages.

The new profile removes the synchronous A13 ABI, exposes only the sliced A14 workflow, disables ordinary debug precompiles and limits computing work to one slice per block. The code-overwrite capability in ArbDebug requires a stricter identity sweep when enabled; the normal fast path relies on sealed pages and exact root-keyed cache invalidation. Cold restoration remains roughly0.6–0.8s; warm EVM outliers exceed100ms. Moreover, roughly9,900 slices imply at least16.5min per decision at100ms blocks. Actual cadence, storage growth and complete new-lane replay/proofs remain gates. This is not a public deployment or a claim that every timing problem is solved.

**Evidence:** [Measured results and limitations](chess/sliced/README.md), [complete SIMD parity](chess/sliced/evidence/simd-full24m-parity.json).

## 22 · Reduce persistence cost while keeping the exact search — 16 November

The first fully persisted EVM decision passed but took825.86s. A second design stores immutable32-byte word deltas instead of rewriting whole dirty pages, merges shared Merkle ancestors, and groups four exact continuations per transaction. It completed the same24m decision in206.73s across2,464 operations, preserving every canonical retained-state byte. At100ms per block, that operation count implies about4.1min before overhead, versus16.4min for the original schedule. This remains slower per move than the monolithic native search; its purpose is allowing ordinary blocks between bounded work units.

Final API tests add project-only admission, one retained-game reservation, release without partial results, and isolated RPC simulation. Simulation cannot advance/evict the live cache, and its next root matches real execution. Global per-block work limits and tighter mining gas limits prevent aggregated searches; debug code-overwrite stays disabled. Complete native compiler/interpreter frame equivalence, actual mixed-traffic blocks and complete new-lane replay/proofs are being checked next. Long-history recovery and roughly1.616GB of sampled first-decision delta payload remain storage/hosting gates.

**Evidence:** [Complete word-delta EVM result](chess/sliced/evidence/evm-word-delta-full.json), [final API regression](chess/sliced/evidence/evm-final-api-prefix.json), [architecture and limitations](chess/sliced/README.md).

## 23 · Keep ordinary transfers moving during an actual chess search — 16 November

An actual local custom Nitro node mined128 bounded compute transactions while127 independent transfers received receipts during the still-pending full-strength search. With the100ms target, ordinary transfers confirmed at123.1ms median /160.7ms p95; chess operations were123.2ms /169.4ms. The observed maximum was214.2ms, plus a separately measured905ms cold first operation. These are confirmation latencies, not model-inference times or a public SLA.

The test disabled ArbDebug, used14m/15m transaction/block gas caps and an explicit150m-gas/s research pricing configuration. A realistic artificial owner balance avoided the generic fixture's near-uint256 maximum overflowing when the owner also received fees. The recorded first compute block was included in a real local parent batch. Independent native replay reproduced all expected global-state fields in5.59s. The native compiler and interpreter also matched complete VM bytes/globals at early, middle and final search frames. Complete new-lane WAVM execution is now running; no full BoLD dispute or public deployment is claimed.

**Evidence:** [Mixed-traffic receipts](chess/sliced/evidence/mixed-traffic-blocks.json), [independent native block replay](chess/sliced/evidence/native-sliced-block-replay.json), [exact backend frames](chess/sliced/evidence/compiler-interpreter-parity.json).

## 24 · Fix warm-cache consensus gas and recording completeness — 16 November

Consecutive-block testing found that a warm VM skipped19,200 gas of seed-metadata reads and caused the recorder to omit required state. R23's second recorded input was only94KiB; a fresh replay produced the wrong end block hash. A new regression measured12,301,367 gas warm versus12,320,567 cold despite identical VM roots. The first cold block's successful replay did not establish subsequent-block correctness.

The repair charges the same seed reads on both paths and runs recording/replay/prefetch in fresh isolated VMs without the live-cache lock. The exact gas now matches, recording cannot evict the live search, and both consecutive recorded blocks replay correctly in fresh processes. The full24m decision still matches all canonical bytes, completing the corrected local experiment in143.22s. In its mixed-load run,128 regular transfers confirmed at111.8ms median /119.0ms p95 while128 compute operations progressed. These remain local confirmation measurements under the100ms target.

The corrected module root is`0x52c7d494becea047cd0ba0ed288a96f39544056ef573ff961f8268d5b43fa4e5`. Its artifacts are isolated from the still-running R23 cold-block WAVM experiment. No public deployment, paid gameplay or completed BoLD dispute is claimed.

**Evidence:** [Reproduced regressions](chess/sliced/evidence/cache-regressions-before.json), [corrected exact gas](chess/sliced/evidence/cache-metering-fixed.json), [complete policy match](chess/sliced/evidence/cachefix-full24m.json), [fresh next-block replay](chess/sliced/evidence/cachefix-next-native-replay.json), [measured figure](assets/chess-resume-results.png).

## 25 · Remove the second interpreter from the proof experiment — 16 November

The embedded interpreter made the frozen R23 cold-block proof extremely slow. A separate experiment translates the exact same portable SIMD program through pinned WABT1.0.42 and scalar SIMDe code. Its complete native24m decision matches the original move, node count, depth and every canonical retained-state byte. Fresh resumes at engine steps4,4000 and9850 match every byte of the466,157,568-byte image and all mutable globals. No model, search budget or retained game state is reduced.

The first proof-runtime trap prototype failed on an invalid operation. A separate outer unwind layer now returns recoverable errors, including illegal chess history, without changing the inner portable engine frames. The verifier also rejected SDK bulk-memory instructions; proof-only MVP memory helpers pass870 alignment, overlap and fill checks. The final scalar Wasm companion repeats the exact early/middle/final resume checks and all error checks successfully.

An isolated Go replay overlay compiles, and the unchanged upstream WAVM loader accepts the new complete machine with root`0x67c7f0be4295e764e9c34fbc06d428715032becca45452f8ee02461c32db2f42`. Its complete corrected first-block replay is running from frozen inputs. A generated machine and primitive parity tests are not a successful block replay; no proof-speed figure is claimed yet. The default node and earlier cachefix/R23 artifacts remain separate. Full BoLD disputes, long-history recovery and host acceptance are still open.

**Evidence:** [Architecture and acceptance gates](chess/sliced/aot/README.md), [complete native policy parity](chess/sliced/aot/evidence/native-parity.json), [scalar proof-Wasm state and error parity](chess/sliced/aot/evidence/proof-parity.json), [memory helper boundaries](chess/sliced/aot/evidence/mvp-memory.json).


## 26 · Complete a corrected block proof, then remove redundant copying — 16 November

The frozen scalar AOT machine (`0x67c7…b2f42`) completed a full corrected first-operation block and reproduced every expected global-state field. Its 3,097 witnesses cover a completed interval of 309.5–309.6 billion steps. Five distinct sampled steps pass the pinned Solidity verifier, including memory, arithmetic, runtime hashing and a finished-state witness; corrupted prestates and proofs reject. The local run took 2,455.83 seconds. This is proof-generation time, not a game-move latency or a completed full-game/BoLD test.

Uniform instruction samples identify generic Go SHA-256 at 61.9% of sampled locations. A separate Go/Wasm experiment then removes three of four full-memory copies per computing operation, saving 1.398 GB of copy traffic per operation. Full-image hashes, globals, progress and illegal-history rejection match the earlier wrapper. The newer lazy machine (`0xd453…4613b`) has its own replay gate; the earlier root's success does not certify it.

A disposable, billable Runpod CPU test server now supports a paired Linux replay against the same captured input. The live CPU5 compute catalog quoted 16 vCPUs and 32 GB RAM at $0.56/hour, plus scratch storage. No GPU, public GL3 deployment, live gameplay or real chain spending is involved. The obsolete R23 cold-block experiment was retired after the corrected full replay passed; its runner resumed the older full-search reference. Production storage, resource rejection and hosting acceptance remain open.

**Evidence:** [Complete block replay](chess/sliced/aot/evidence/complete-wavm-block.json), [five distinct Solidity checks](chess/sliced/aot/evidence/complete-solidity-steps.json), [uniform instruction samples](chess/sliced/aot/evidence/sampled-profile.json), [copy-traffic and wrapper parity](chess/sliced/aot/evidence/wrapper-parity.json).
