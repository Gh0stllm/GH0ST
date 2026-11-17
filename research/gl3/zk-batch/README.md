# GL3 · full ZK-batch comparison

**The real Solidity verifier compiled on Runpod; the full EVM proof build is progressing. No new ZK proof or verified gas result is claimed yet.** All builds, execution, proofs and private-chain verification run on Runpod. The tested Nitro build and its frozen deployment profile remain unchanged.

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
