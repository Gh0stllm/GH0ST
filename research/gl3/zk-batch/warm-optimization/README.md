# GL3 · warm proof optimization

**R52: the isolated warm baseline passed SDK verification in360.960 seconds. The CPU-specific build passed; its proof is running, with Solidity verification still pending.** The exact R50 sixteen-transfer EVM fixture, guest, program key, Groth16 circuit and Solidity verification requirements remain fixed.

| Step | Status / acceptance |
| :--- | :--- |
| Warm baseline | Original binary, 28 allowed CPU threads, existing circuit files verified before execution |
| CPU-specific build | Queued after baseline cleanup; same source/lockfile, `-C target-cpu=native` |
| Optimized proof | New full proof required; all160 output bytes and the program key must match |
| Chain verification | Actual Solidity acceptance required; meaningful changed-proof/output/key rejections retained |
| Cost | Fresh pod rate × measured elapsed time, with builds and first-run downloads separated |

The original `p3-baby-bear` fingerprints have empty Rust flags and no nightly features. Inspection of its pinned source shows that CPU vector packing is selected by target features. The worker supports AVX2, while its available32 CPU affinities are sixteen sibling pairs. The candidate enables the library's existing CPU-specific arithmetic through compilation; it changes neither the guest nor proof-system parameters. Gains remain unmeasured until the full proof and verifier pass. [Exact source/build-feature review](source-review.json).

Each run creates a fresh proof in an empty output directory. It does not reuse the cold proof. The original signed calls are deliberately fixed for the A/B comparison: this is a repeat of the same EVM batch, rather than a second appended production block. All seven installed circuit-file hashes are checked before a warm run; no first-run circuit download should be included.

The baseline is isolated from compilation. Once it exits0 with verified outputs and no owned processes, the bounded native build starts automatically, verifies the full embedded guest, then launches its own new proof. Runs retain a48GiB owned-RSS guard,56GB shared working-set guard,6GB disk floor and30-minute proof deadline. Build failures are preserved and do not count as a proof result.

Proof generation runs on Runpod. On-chain Solidity proof verification remains mandatory for acceptance. This benchmark does not claim that the prover executes inside a contract or that a production state/data coordinator, bridge or ZK withdrawals are already delivered. The frozen Nitro launch path remains separate.

[Warm baseline intent](baseline28-intent.json) · [Controller](controller.py) · [Native build queue](build-native.py) · [Optimized controller](optimized-controller.py) · [Current compute quote](compute-quote.json) · [Cold reference](../source-evaluation/complete16/README.md)

## R52 · measured warm baseline

| Actual measurement | Result |
| :--- | ---: |
| Full warm Groth16 call, including recursion and wrapping | **360.960 seconds** |
| Whole controller, including hashes/client/key/guest work | 369.320 seconds |
| Sampled owned RSS peak | **38,335,074,304 bytes** |
| Full-call compute allocation at$1.12/hour | **$0.11230** |
| Actual proof process exit / remaining owned processes | 0 / 0 |

This is circuit-assets-warm execution with a fresh CPU client, program-key setup and proof. All160 public bytes and the program key match the cold reference. No circuit download occurred. No heavy build/test ran concurrently with this baseline. [Actual result](baseline28/controller/result.json) · [Fresh proof](baseline28/proof/evm-proof.json) · [Runpod calculation](baseline28/summary.json).

The same-source native build exits0 in141.174 seconds, with actual `target-cpu=native` dependency fingerprints and the complete unchanged guest located inside its71,702,544-byte executable. The initial optimized launch stopped before starting a proof because its inherited28-thread affinity did not satisfy a runner assertion requiring32. That failed preflight is [preserved](attempts/native28-01-inherited-affinity/). The corrected [v2 controller](optimized-controller-v2.py) checks the requested affinity against the actual available subset; guest/proof math and resource limits are unchanged. Native28 timing remains unaccepted until completion. A16-thread comparison is queued afterward.

The native executable targets this worker's CPU features; production on different hardware requires a compatible build. The original generic binary is retained. Build/setup cost is separate from per-proof compute.
