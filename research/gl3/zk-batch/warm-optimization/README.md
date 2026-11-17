# GL3 · warm proof optimization

**R53 complete: the selected CPU profile cuts full warm proof time and compute allocation by 40.41%. All three fresh proofs pass SDK and actual Solidity verification.** Every build and test ran on the existing Runpod CPU worker.

| Profile | Full Groth16 call | Compute allocation | Sampled peak RSS |
| :--- | ---: | ---: | ---: |
| Original generic build, 28 threads | 360.960 s | $0.11230 | 38.34 GB |
| **Native CPU build, 28 threads — selected** | **215.093 s** | **$0.06692** | **38.79 GB** |
| Native CPU build, 16 distinct-core threads | 258.122 s | $0.08030 | 42.70 GB |

The same-source build enables the arithmetic library's existing CPU-vector implementation using `-C target-cpu=native`. The guest, circuit, program key, workload and proof security settings remain unchanged. The 16-thread alternative is slower and uses more sampled RSS in this run, so 28 threads are retained. [Selected profile](selected-profile.json) · [Exact calculations and bindings](comparison.json) · [Source/CPU-feature review](source-review.json).

## Measurement scope

Each run generates a new full proof of the **same fixed sixteen signed ERC20 transfers**, with 833,848 EVM execution gas. These are A/B alternatives for one batch, not three appended production blocks. All 160 public bytes and the program key match the cold reference. Each 260-byte proof includes core proving, recursion and native Groth16 wrapping; no mock, cached proof or omitted wrapper is accepted.

The circuits and OS file cache are warm; each process creates a fresh CPU client and program keys. Full-call timing excludes that initial client/key/guest work and integrity checks. Whole controller times are 369.320/223.051/266.104 seconds respectively. Builds and proof runs are isolated and sequential. These are single-batch observations rather than latency distributions or throughput guarantees.

The earlier cold full call was 591.230 seconds, including its initial 3.026 GB circuit download/install. A cold/warm difference is not an isolated measurement of network time. No new circuit download occurred in these warm runs.

The current Runpod API rate is $1.12/hour compute for 32 vCPU/64 GB. Allocations above equal full-call seconds × that rate /3,600. They exclude storage, tax, chain fees and prior setup. The native build itself took 141.174 seconds and is a separate one-time cost. Faster proving improves resource use; the hourly charge for an always-running pod stays unchanged. [Dated price read](compute-quote.json).

RSS is sampled every 0.5 seconds and is not an exact kernel process high-water result. All runs pass on the 64 GB hard-limit worker with no recorded OOM event. Cumulative memory-limit reclamation events do occur as file cache is reclaimed; minimum RAM or concurrent proof capacity is not established. The native binary targets this worker's CPU features and needs a compatible host or a rebuild. The original generic binary remains available. Circuit cache is worker-local and may be lost on pod replacement.

## Actual contract verification

One unchanged SP1 v5 Solidity verifier accepts all three newly generated proofs on a private official Nitro 4663 parent:

- Selected native28 proof: **227,287 gas**.
- Original warm and native16 proofs: **227,299 gas each**.
- Three changed-proof/public-value/program-key cases actually mine status0 with `ProofInvalid`, using 227,293 compute gas each under an 8m limit. The proof mutation preserves BN254 curve membership, excluding gas exhaustion as rejection evidence.
- Publishing all sixteen raw signed calls separately uses 59,152 gas. Selected verification plus that data component totals **286,439 gas across two transactions**.

The verifier job exits0 in 40.947 seconds. Independent checks decode actual calldata and receipts, bind each to its fresh SDK proof, verify all 160 public bytes and raw transaction data, rehash source and confirm cleanup. Small gas differences are calldata effects; the optimization targets prover computation. Private fixture poster gas is zero, so these values are not a live all-in Robinhood fee quote. One-time verifier deployment uses 1,404,856 gas and is excluded above.

[Final verifier result](verifier-evidence/verifier-result.json) · [Direct process exit](verifier-evidence/actual-exit.json) · [Independent receipt/calldata audit](verifier-evidence/independent-audit.json) · [Readable receipts](verifier-evidence/readable-receipts/) · [Full 145-member capsule](verifier-evidence/warm-verifier-evidence.tar.gz) · [Capsule hashes](verifier-evidence/export-receipt.json).

## Preserved failures and reproducibility

The first native launch stops before proving because a runner assertion expects 32 available affinities after inheriting 28. Its [failed preflight](attempts/native28-01-inherited-affinity/) remains intact; the [v2 controller](optimized-controller-v2.py) validates the requested subset without changing proof limits. The first two verifier launches stop before chain/proof work on a namespace guard, then missing neutral dependency links. Both are retained in the capsule. The corrected [verifier source](verifier-source-v2/) permits only the exact private namespace and uses the existing pinned neutral dependencies. No expensive proof is rebuilt for these fixes.

[Native build result](native-build/result.json) · [Original warm run](baseline28/) · [Native28 run](native28/) · [Native16 run](native16/) · [Binding/verification orchestration](verify-comparison.py) · [Final calculation](finalize-comparison.py) · [Public export script](export-evidence.py).

Proof generation runs on Runpod; the chain verifies its correctness through Solidity. Production state/data acceptance, a coordinator, bridge/withdrawals and Stylus/LLM proofs remain outside this benchmark. Public GL3 is not deployed, and the preserved Nitro launch path is unchanged.
