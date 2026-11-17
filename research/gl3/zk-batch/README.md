# GL3 · full ZK-batch comparison

**The sixteen-transfer native EVM and guest execution passed; a real full Groth16 proof is running on Runpod. The Solidity verifier compiled, but no complete proof or verified gas result is accepted yet.** All builds, execution, proofs and private-chain verification run on Runpod. The tested Nitro build and its frozen deployment profile remain unchanged.

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
