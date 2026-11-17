# GL3 · warm proof optimization

**R51: the isolated warm baseline is running on Runpod. No optimized timing is accepted yet.** The exact R50 sixteen-transfer EVM fixture, guest, program key, Groth16 circuit and Solidity verification requirements remain fixed.

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
