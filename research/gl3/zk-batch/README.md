# GL3 · full ZK-batch comparison

**Complete private benchmark passed: sixteen ERC20 transfers → real Groth16 proof → actual Solidity verification and three mined rejection tests.** All builds, execution, proofs and private-chain verification ran on Runpod. The tested Nitro build and its frozen deployment profile remain unchanged.

| Final measured result | Value |
| :--- | ---: |
| Cold full proof, including official circuit fetch and final wrapping | **591.23 seconds** |
| Sampled owned proof RAM peak | **41.34GB** |
| Full-pod compute allocation for that cold call | **$0.184**, excluding prior setup/storage |
| Proof / public values | **260 / 160 bytes** |
| Actual private Solidity verification | **227,263 gas** |
| Verification + separate uncompressed data publication | **286,415 gas**, two transactions |
| Matched Nitro parent posting | **179,241 gas** |

Warm proving time is unmeasured. Private parent posting-price initialization and compression differ; these are measured components rather than all-in mainnet fees. **[Full cost comparison and boundaries](costs/README.md)** · [Proof and memory evidence](source-evaluation/complete16/README.md) · [Solidity receipts and negatives](nitro-baseline/verifier/README.md).

The target is one genuine EVM batch of **16 ERC20 transfers**, with deployment/mint setup outside the measured transaction window. It must reach a final EVM-compatible proof and an actual Solidity verifier receipt. A native replay, mock proof, precomputed third-party proof or standalone arithmetic example cannot satisfy this experiment.

| Measurement | Required evidence |
| :--- | :--- |
| Actual program | Pinned EVM guest, verifier, backend, compiler and parameter identities |
| Time | Cold setup/build separate from execution, proving, recursion and final wrapping |
| RAM | Whole owned pipeline, not only the guest or advertised GPU memory |
| Gas | Actual private native-Nitro-parent verifier receipt plus calldata/data-posting costs |
| Correctness | Exact state/public-value binding; changed proof and changed output rejection |
| Nitro comparison | Matched routine transaction semantics and parent batching/validation cost |
| Cost | Measured resource time × live hourly rates; parent gas separately; setup amortization explicit |

The earlier **235.945-second Nitro result is a dispute stress test**. It is not a per-batch operating-cost baseline. Different forks, fee rules and state schemas will be disclosed rather than described as identical executions.

The first source candidate is ethrex EVM replay with a pinned SP1 final-proof pipeline. The prior Airbender review found a documented high-memory path and incomplete latest-main wrapping instructions; those must not become a blind build. No additional pod is created until the concrete pipeline's resource needs are established. The selected32-vCPU/64-GB host is available at the live API rate of$1.12/hour compute; the existing persistent disk cost is separate.

[Machine-readable plan](plan.json) · [Nitro measurements](nitro-baseline/) · [Source evaluation](source-evaluation/) · [Earlier accepted Nitro evidence](../base/README.md)

## R47 · verifier ready; proof build continues

The unchanged MIT-licensed SP1 v5.0.0 Solidity verifier compiles successfully: actual process exit0, 1.961 seconds, kernel maximum RSS371,332 KiB, deployed code6,260 bytes. Source, compiler settings and deployed-code hash are preserved in the [verifier evidence](verifier/README.md). No proof has been verified yet.

The CPU proof build uses a pinned ethrex EVM guest/host and SP1/native-gnark pipeline. Broad optional dependency fetching was stopped; only the selected build continues. Network-mounted Cargo metadata caused idle waits, so this test's cached build and registry were moved to fast local storage without changing proof math or the EVM workload. The selected production Nitro profile is untouched. Those setup delays will stay separate from the eventual proving measurement.

The matched Nitro baseline and real-verifier test drivers are being prepared in parallel. Full ZK rollup readiness is outside this single-batch experiment: even a valid proof would not establish a completed bridge, withdrawals or production state coordinator.

## R48 · exact EVM batch passes; real proof starts

The actual sixteen-transfer generator/witness/native-replay job passed with exit0 in0.2395 seconds. The measured block uses833,848 EVM gas. A separate pinned SDK runner independently executes the exported witness natively and in the official released EVM guest: **all160 public bytes match**, including initial/final state roots, last block hash, chain9 and transaction count16. Cold CPU-client initialization is1.558 seconds, program-key setup1.144 seconds and guest execution0.770 seconds.

One real CPU Groth16 proof started at **13:07:30 UTC**, with28 CPU cores allowed, a48GiB owned-RSS guard and56GB shared working-set guard. The saved13:08:32 snapshot is a running observation, not a finished-proof latency or final peak-RAM result. The guest and native EVM have different explicitly pinned source revisions; actual input/output compatibility was tested, rather than assuming identical source. [Frozen source, fixture, failures and measurements](source-evaluation/README.md) · [Actual160-byte binding](source-evaluation/run16/preproof-execution.json) · [Running snapshot](source-evaluation/run16/running-snapshot.json).

The Runpod API still quotes **$1.12/hour compute** for the existing32-vCPU/64GB worker. Storage, chain fees and cold setup are separate; parallel lanes share one rental interval. [Dated compute quote and calculation rule](costs/compute-quote.json). Nitro's matching signed calls are running in a separate private fixture; no completed baseline is claimed in this snapshot.

## R49 · matched Nitro baseline passes

The private official Nitro run passes with direct wait4 exit0 in52.233 seconds including setup/teardown. It accepts the **same16 signed ERC20 transactions**, using copied token prestate, and independently re-executes their actual posted inbox batch on a follower without a sequencer feed.

| Routine measurement | Actual result |
| :--- | ---: |
| Submit all16 calls → all receipts | 266.52 ms |
| Token execution gas | 833,848, matching ethrex |
| Child packing | 2 child blocks, 1 parent posting batch |
| Compressed batch data / parent calldata | 1,542 / 2,052 bytes |
| Parent receipt gas | 179,241 |
| Post trigger → observed independent replay | 2,322.69 ms |
| Sequencer / follower CPU windows | 0.04 / 0.09 seconds |

Posting observations include a controlled restart to release a deliberately withheld batch. The native token is a synthetic neutral test asset; complete ArbOS/Ethereum state roots and fees differ, while signed calls, token prestate/outcomes and execution gas match. The follower matches Nitro's own header, state and all16 receipts exactly. These are one-run measurements, not throughput or production guarantees. [Full result, actual receipts, preserved setup failures and audit](nitro-baseline/README.md).

The ZK proof remains active. Its final wrapper needs a cold download of the official3,025,985,400-byte circuit archive; download/install time will be identified in the complete pipeline result. No completed proof or ZK verification-gas result is claimed at this milestone.

## R50 · complete the real proof, Solidity checks and cost comparison

The one actual CPU Groth16 proof completes with exit0, matching all160 native/guest/proof public bytes. The final260-byte proof verifies in the SDK and in the unchanged pinned Solidity verifier on a private official Nitro parent. Actual mined mutations of the proof body, public values and program key each revert with `ProofInvalid`, using about227k compute gas under an8m limit. Native BN254 curve validity is preserved in the proof-body mutation; gas exhaustion is excluded.

The actual verifier job passes with wait4 exit0 in41.608 seconds. Audits independently inspect calldata, deployment/verification/reverted receipts, exact published raw transactions, source hashes and cleanup. The earlier receipt-indexing and invalid-curve negative-test failures remain preserved; no second expensive EVM proof was needed.

The591.230-second cold proof call includes the official3.026GB parameter download/install. Its archive hash and installed verification-key hash are recorded, with the latter matching the Solidity circuit selector. All sampled kernel OOM counters remain zero and all owned test processes are gone. [Complete proof](source-evaluation/complete16/README.md) · [Solidity acceptance](nitro-baseline/verifier/README.md) · [Measured costs](costs/README.md).

This establishes a full EVM batch proof and verifier/data components. It does not deliver a production rollup coordinator, proof-bound data/state acceptance, ZK withdrawals or Stylus/LLM execution proofs. The Nitro launch path remains separate; no public deployment or real funds are used.
