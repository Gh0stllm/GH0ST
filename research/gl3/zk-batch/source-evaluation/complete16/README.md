# Real sixteen-transaction EVM proof

**One full CPU Groth16 proof completed and passed native SDK verification.** Its public output matched independent native EVM execution and the released guest execution, byte for byte. The separate Solidity verification packet records on-chain verification and gas; this packet does not claim that result.

| Measurement | Actual result |
|---|---:|
| Workload | 16 signed ERC20 transfers, one EVM block, chain ID 9 |
| EVM gas | 833,848 |
| Native full EVM execution | 0.001935 s |
| Guest execution | 0.770364 s |
| Initial CPU client setup | 1.558472 s |
| Initial key setup | 1.143519 s |
| Full Groth16 call, including recursion, cold circuit fetch and final wrapping | **591.229675 s** |
| Native proof verification | 0.002774 s |
| Whole runner | 596.383528 s |
| Sampled owned RSS peak | **41,341,263,872 bytes** (38.50 GiB) |
| EVM proof / public values | 260 / 160 bytes |
| Actual exit / remaining owned processes | 0 / 0 |

The worker had 64,000,000,000 bytes of hard RAM and 32 available CPU affinities; the prover used at most 28. Its CPU model was AMD EPYC 9575F. RSS was sampled every 0.5 seconds, rather than obtained from a final process high-water counter. The whole-pod kernel peak was 57,790,828,544 bytes, including file cache, builds and the parallel Nitro fixture. Kernel OOM counters remained zero. This is a successful run on that worker, not a measured minimum-memory result.

The final sampled owned CPU counter was 7,902.16 CPU-seconds at 595.851 seconds. It covers the runner through that observation; an exact final proof-only CPU counter was not collected.

At the worker's quoted $1.12/hour, the measured cold proof call represents about **$0.184 of compute**. This excludes earlier setup/builds and storage, and shares the worker with the Nitro test. It is not a measured warm per-batch price.

## Cold circuit assets are included

The SDK downloaded its official 3,025,985,400-byte `v5.0.0-groth16.tar.gz` during the proof call. The download/install directory was created at 13:13:27.017445602 UTC, and the completion log was observed by 13:17:22 UTC. Pure network time and a warm proof were not separately measured. No second full proof was run to manufacture a warm result.

The original SDK download was retained without changing its bytes. Its SHA-256 is `6cbc2c155c41001e81efd81119bd3d4f32313fcd3184df383d50225315b73104`. The installed verification-key SHA-256 is `a4594c59bbc142f3b81c3ecb7f50a7c34bc9af7c4c444b5d48b795427e285913`; its prefix is the proof's verifier selector. All installed circuit-file hashes and the official URL are in [circuit-artifacts.json](circuit-artifacts.json). No custom setup or mock proof was used.

## Binding and provenance

The [runner](runner.rs) computes native expected output, executes the actual released EVM guest, requires all 160 public bytes to agree, creates a real Groth16 proof with the same CPU client/key, verifies it, and requires the proof's public values to agree again. The five committed fields are the initial state root, final state root, last block hash, chain ID and transaction count. The guest's complete bytes were located and compared inside the runner ELF before launch.

The native host is ethrex `890efb6…`; the official guest release is pinned separately to `f902422…`. Their commits are not described as identical. The accepted fixture came from the real ERC20 generator and native EVM, with deployment/mint setup folded into genesis outside the measured block.

- [Frozen input, executable, guest and source hashes](intent.json)
- [SDK result and actual exit](sdk-result.json), [exit receipt](actual-exit.json)
- [Public EVM proof bundle](evm-proof.json), [native/guest output binding](preproof-execution.json)
- [Resource samples](resource-samples.jsonl), [measurement scope](measurement-summary.json), [raw log](proof.log)
- [All small artifact hashes](manifest.json)

This benchmark proves a genuine EVM batch. It does not deploy a production ZK rollup or change the preserved Nitro GL3 configuration.
