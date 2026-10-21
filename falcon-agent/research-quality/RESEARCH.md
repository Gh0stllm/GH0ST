# Quality-preserving deployment research

Research and local experiments completed 20 October 2026. No training, fine-tuning, public deployment, or paid API use.

**Current project constraint: existing Robinhood Chain only.** The user's subsequent decision excludes a dedicated chain or genesis allocation as the project direction. The architectural alternatives below remain historical research, not the implementation plan. The follow-up quality-tolerance study is in `RH-QUALITY-UPDATE.md`; it evaluates 6-bit, 8-bit and selective 4/8-bit weights without training.

**Result: exact compression saves 32.38% of the original weights. No tested approach puts this complete, self-contained pretrained model onto existing Base or Robinhood Chain for a total deployment cost in millions of gas.** The most substantial architectural alternative is to include unchanged model contracts in a new chain's genesis state. That changes the chain/infrastructure requirement and does not solve inference cost.

## What was actually tested

The model is `tiiuae/Falcon-H1-Tiny-90M-Instruct`, revision `e6389502a0b12cd8da894b395ba5bf7436873b16`. Its 386 BF16 tensors contain 91,131,072 unique parameters and 182,262,144 payload bytes. The original safetensors file is 182,304,120 bytes, SHA-256 `199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578`. Tensor-payload SHA-256 is `95876b28e73b84d94206540f30d58643ab7a45121ebb6ab6356126a25eb25a33`.

Tests covered seven codec configurations over every original weight, a custom Solidity lossless decoder, authenticated weight streaming with an exact arithmetic kernel, and full-model genesis allocation. All **78 local architecture checks passed**. The decoder also reconstructs all 65,536 possible BF16 bit patterns exactly. Full on-chain Falcon inference and tokenization are still unimplemented; these are component/architecture results, not a working conversational agent.

## Complete-weight compression

Every accepted compressed stream was decoded and compared against the entire original tensor payload. Sizes below include codec framing but exclude the model's tensor schema, tokenizer, engine, contract address index and agent. MB means decimal megabytes.

| Representation | Payload bytes | Saving vs original | Code-deposit gas alone |
|---|---:|---:|---:|
| Original BF16 | 182,262,144 | — | 36,452,428,800 |
| Zstd level 3 | 143,687,318 | 21.16% | 28,737,463,600 |
| Zstd level 19 | 140,910,285 | 22.69% | 28,182,057,000 |
| BF16 exponent/sign-mantissa separation + Zstd 19 | 124,274,534 | 31.82% | 24,854,906,800 |
| ZipNN Huffman, 1 or 4 threads | **123,242,321** | **32.38%** | **24,648,464,200** |
| ZipNN, independent 256 KiB streams | 123,267,345 | 32.37% | 24,653,469,000 |
| Custom independent 4,096-weight top-seven-exponent codec | 129,148,850 | 29.14% | 25,829,770,000 |

The custom codec needs a further 89,000-byte block-offset index under the simple u32 indexing scheme; code storage for that index alone is another 17,800,000 gas. A smarter derived index could reduce this, with a different lookup cost.

The best ZipNN result implies **26,919,192,481 modeled gas** for 5,015 portable shards, or **26,767,236,376** for 2,006 candidate 60 KiB shards. These figures include standard Cancun transaction, calldata, code creation and constructor-memory charges. They exclude the engine/tokenizer/index/agent and chain-specific data fees. They are calculated totals, not 5,015 actual deployment receipts or live Base/RH quotes.

The 60 KiB layout is a candidate for RH's documented larger contract limit. Base's standard 24 KiB layout remains the portable choice. Larger shards save approximately 0.56% here; they do not change the dominant bytes-to-gas term. Actual chain transaction limits and all-in fees require separate validation.

For comparison, applying Zstd 19 to the previous NF4 group-128 export gives **43,952,459 bytes**, down from 48,879,392: another 10.08% saving and an **8,790,491,800-gas code-deposit floor**. This preserves the already-quantized weights exactly, including their previously measured quality regressions. It does not restore original-model quality. The previous approximately 10.6-billion-gas deployment plan was for that lossy NF4 model, so it must not be compared to original BF16 preservation as though both deliver the same quality.

### Integration issue caught by verification

ZipNN 0.5.4 in this GCC-built local environment modifies its input buffer, including when passed a Python `bytes` object. Initial in-memory comparisons therefore failed against a modified reference. The final implementation supplies an owned copy to the codec, protects the canonical reference with its pinned digest, and verifies recovered bytes against that reference. Both thread settings then produced the same valid compressed artifact. Earlier contaminated intermediate results were replaced and are not included as accepted measurements. This illustrates why compressed size alone is insufficient evidence.

## Why another ordinary compression pass is unlikely to reach millions

Under the standard EVM code-deposit schedule of 200 gas per byte:

| Total gas target | Maximum code/data bytes before every other cost | Bits available per parameter |
|---|---:|---:|
| 1 million | 5,000 | 0.000439 |
| 10 million | 50,000 | 0.004389 |
| 100 million | 500,000 | 0.043893 |
| 999 million | 4,995,000 | 0.438489 |

Our best exact representation needs 10.819 bits per parameter. Reaching 100 million code-deposit gas would require another approximately **246×** reduction from it; reaching 10 million would require approximately **2,465×**, before other costs. This budget applies to storing encoded weights as bytecode, not a theorem about every conceivable blockchain architecture.

Measured empirical entropy is 3.269 bits for exponents, 7.972 for sign/mantissa, and 10.682 bits per weight when BF16 symbol entropy is weighted tensor by tensor. This explains why exponent coding succeeds and why removing hundreds of times more information has no demonstrated basis here. These are zero-order statistical measurements, **not universal lower bounds against contextual or algorithmic compression**.

Only seven of the 91,131,072 weights are exact positive/negative zero. Lossless zero pruning therefore has negligible potential. Three representative matrices have full numerical rank: 512/512, 128/128 and 128/128. This is evidence against an exact low-rank shortcut for those matrices, not proof about every tensor. Approximate factorization, pruning and lower-bit quantization change the model and need quality evaluation; our previous two- and three-bit experiments failed badly.

## Decoding can cost more than it saves

The custom codec retains sign/mantissa, encodes the seven common exponents with three-bit codes, and uses an escape for other exponents. It is exact and independently decodable in small blocks. It is our research implementation, not a Solidity port of ZipNN or DFloat11.

Local Solidity 0.8.30, via-IR, optimizer 200, Cancun results:

| Operation | Actual local gas |
|---|---:|
| Deploy decoder | 349,323 |
| Deploy first compressed sample (5,775 bytes plus STOP) | 1,301,161 |
| Read/decode/hash its 4,096 original weights from contract code | 1,135,508 |
| Same operation for middle sample | 1,132,937 |
| Same operation for shorter final sample (3,264 weights) | 921,858 |

Stored-decode receipts include the call and result hashing and write the same existing result hash; the unchanged SSTORE is intentionally identified in the raw results. These are **not matrix multiplication or token-generation measurements**. Linear extrapolation of the two full samples suggests roughly 25 billion gas to decode one sweep of all weights with this simple decoder, before model arithmetic. This is an illustrative extrapolation, not a measured full sweep. A fused, optimized decoder could reduce it, but deployment savings must always be evaluated against repeated execution cost.

Decompressing once into permanent uncompressed contracts would pay the uncompressed code-deposit bill again. Decompressing into transient memory avoids that bill but repeats work in future transactions. No EVM ZipNN/Zstd decoder is implemented here.

## Two architectural alternatives tested

### 1. Authenticated weight streaming

The prototype stores an immutable Merkle root and weight length. A transaction supplies a 4,096-byte original-weight chunk and a 16-sibling proof. Leaves bind position, length and bytes; separate prefixes distinguish leaves, internal nodes and padding. The root covers all 44,498 chunks of the original model.

**Actual prototype deployment: 478,876 gas.** This deploys a verifier and one arithmetic kernel, not the entire LLM. Three sampled authenticated dot products match exact Python integer references. Corrupted weights, proofs, indices and lengths are rejected. The arithmetic kernel converts a supported BF16 range to exact Q128 and multiplies int16 inputs; it does not implement general BF16 activations or the model's nonlinear operations.

Verification costs 206,870–207,020 gas for a full 4 KiB sample including calldata. The measured full-sample dot transactions cost 1,946,943–1,960,857 gas. Shipping the entire raw model once costs **2,911,558,956 calldata gas** under the 4/16 schedule, even before proofs and arithmetic. This is a full-model shipping calculation, not a measured per-token bill. Different schedules, caching, compression and prefill batching change costs, but do not eliminate weight delivery.

This keeps sampled arithmetic on-chain and prevents substituted weights. It adds an external availability/transport dependency, and shifts costs from deployment to use. Historical calldata is not automatically readable by later contracts. It therefore **does not meet the current self-contained-contract-state requirement**. No off-chain answer or zero-knowledge inference is used in this prototype.

### 2. Full model in a new chain's genesis state

A generated local genesis file preallocates **all 182,262,144 original weight bytes** into **7,417 STOP-prefixed contracts**, each within 24 KiB. The local node starts with them already present. We verified every shard's EVM code hash, read sample bytes through a Solidity contract, and confirmed genesis contains no transactions.

Weight-deployment transactions: **zero**. Weight transaction gas: **zero**. A separate reader deployed for 178,630 gas. These values describe initial-state allocation and the reader, not the total cost of deploying and operating a production chain or complete LLM.

Arbitrum's Chain SDK explicitly supports custom genesis contracts/account allocations and commits genesis hashes in rollup creation. This offers a real architectural path to avoid ordinary weight-creation transactions on a **new chain**. The test used Anvil's genesis mechanism; it did not launch Nitro/Orbit, deploy parent-chain contracts, validate fraud proofs, or create a bridge.

It cannot be applied retrospectively by an ordinary app developer to existing Base or Robinhood Chain. A protocol-authorized predeploy would require chain-operator involvement; no such permission or integration is established. A new chain also requires genesis distribution, node operation, sequencing, data availability, settlement and a credible verification model. Exact arithmetic remains costly. Lower custom gas prices or a native model precompile change protocol economics/execution, not the underlying work; a native precompile also changes the requirement that the runtime itself be entirely smart contracts. Parent-chain deployment and recurring costs are **unmeasured**, so no total-million-gas claim is justified.

## Other ideas assessed

| Technique | Assessment for this exact goal |
|---|---|
| Factory batching / multicall | Saves repeated transaction overhead; still pays CREATE and every deposited code byte. Batches must fit transaction limits. |
| Shared weights / minimal proxies | Excellent for incremental agents; initial weight bill still exists. Current controller clones are 162,069 local gas each, excluding inference. |
| Storage slots instead of bytecode | Ordinary fresh SSTORE is more expensive per byte for this dense immutable dataset. |
| Deploy a compressed constructor that emits original weights | Compresses input transmission, then still pays for the expanded permanent runtime. |
| Lazy weight deployment | Defers the bill until later; does not meet a total-lifecycle deployment target. |
| Blobs / events / historical calldata | Do not give future EVM contracts direct arbitrary access to all stored model bytes. Supplying authenticated data is the streaming alternative above. |
| Merkle/KZG commitments | Authenticate data; do not reconstruct or contain an arbitrary full model for free. |
| Transient storage | Transaction-scoped; cannot hold permanent weights across requests. |
| Exact low rank / zero skipping | Only seven exact zeros; sampled matrices full numerical rank. No large exact shortcut demonstrated. |
| Aggressive quantization / distillation | Changes weights/behavior. Previous aggressive variants lost quality; training remains excluded. |
| Checkpoint-delta compression | Requires the base checkpoint to be available too; not a standalone deployment saving. |
| Seed-generated weights | A hash/seed cannot ordinarily recreate arbitrary learned weights without an encoding or additional computation/data; no suitable generator demonstrated. |
| Packed arithmetic / MODEXP / compiled weights | May reduce computation; does not remove weight information. Compiled-weight LFM work previously increased deployment size. MODEXP input bounds also need chain-specific checks. |
| Parallel execution / more contracts | Can affect throughput and scheduling; does not multiply a transaction's budget or remove aggregate charged work. |
| Exact selective vocabulary search | Potential execution optimization if bounds prove the same chosen token. Full vocabulary data still needs storage for general chat. |
| Smaller story-only pretrained model | A different capability target; no demonstrated strong general-chat/agent replacement within the desired byte budget. |
| Stylus | Worth testing for computation when available; state-bound costs remain. Published GPU compression speedups do not translate into Stylus gas results. |
| Off-chain inference with proofs | Can preserve verification, but violates the requested on-chain inference boundary. |

## Primary research and what it supports

- [ZipNN paper](https://arxiv.org/abs/2411.05239) and [official implementation](https://github.com/zipnn/zipnn): BF16 field separation and entropy coding; our tests independently measure Falcon and verify full recovery.
- [DFloat11](https://arxiv.org/abs/2504.11651): roughly 30% lossless BF16 reduction with specialized GPU decoding. Not a published EVM-gas solution.
- [Approaching Shannon Bound with Lossless LLM Weight Compression](https://arxiv.org/pdf/2606.15789): tile-level ANS and fused GPU decoding. Despite the abstract's up-to-10× statement, its BF16 discussion reports roughly 11–12 effective bits and approximately 1.5× compression. The largest ratios involve particular low-bit representations; they are not evidence of 10× compression of our original BF16 weights.
- [NeuralZip](https://arxiv.org/abs/2610.09916): recent shared-codebook work; the large encoding-speed multiples should not be read as size reductions. Not implemented here.
- [Geth protocol constants](https://github.com/ethereum/go-ethereum/blob/master/params/protocol_params.go) and [EIP-170](https://eips.ethereum.org/EIPS/eip-170): code-deposit pricing and ordinary code-size limit; local costing is explicitly Cancun-scoped.
- [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844): blob data is separate from EVM-readable execution data. Commitments alone are not model memory.
- [EIP-7823](https://eips.ethereum.org/EIPS/eip-7823): 1,024-byte per-field MODEXP bound on networks implementing it; no unbounded matrix-precompile assumption.
- [Arbitrum custom genesis](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/custom-genesis-state): supported new-chain predeploy mechanism, including genesis hashes and operator initialization.
- [Stylus execution differences](https://docs.arbitrum.io/stylus/concepts/vm-differences): computational advantages and unchanged state-bound operation costs.
- [Robinhood differences](https://docs.robinhood.com/chain/differences-from-ethereum/) and [Base transaction ordering/limits](https://docs.base.org/specifications/transactions/transaction-ordering): contract/batch constraints; neither supplies a way for an app to rewrite chain genesis.

## Recommendation and next implementation gate

For deployment on **existing RH or Base**, retain the original BF16 checkpoint as the quality reference. Lossless compression is the only tested path here that changes storage without changing any weight. Budget in billions of total gas for ordinary self-contained storage; do not promise millions. A deployable version would still need a bounded on-chain decoder, deterministic numeric kernels, the complete Falcon hybrid runtime, tokenizer, per-job caches and an end-to-end gas/quality benchmark.

Historically, this study identified a dedicated chain with model contracts preallocated at genesis as an alternative to ordinary weight-deployment transactions. **The user has now fixed the target to existing Robinhood Chain, so that alternative is excluded from the active project.** No protocol-level predeploy agreement exists, and none is assumed. The total-million-gas deployment target remains unmet.

Preserving original weights does not make the original small model a reliable agent. Earlier baseline tests already exposed balance/permission and output-format errors. Direct state reads, deterministic action schemas and independently enforced spending/recipient limits remain necessary. Complete numerical equivalence also requires preserving operation order, rounding, activations, tokenizer and decoding behavior; exact stored weights alone cannot certify a future EVM runtime.

## Reproduction and files

Use the pinned original model already documented in `../selected-weight-manifest.json` and `../../selected-model.json`; do not use a quantized checkpoint as `--original`. Original/derived model binaries and the approximately 365 MB genesis JSON are deliberately outside the distributable archive.

```bash
# From falcon-agent/research-quality, with the existing Python environment:
CC=gcc python -m pip install zipnn==0.5.4 zstandard==0.25.0 --no-deps
node compile.cjs
python lossless.py --original /path/to/model.safetensors --cache /path/to/cache
python test_architectures.py --original /path/to/model.safetensors --cache /path/to/cache --anvil /path/to/anvil
python costs.py --original /path/to/model.safetensors --cache /path/to/cache
```

Other dependencies are the existing project environment: NumPy 2.5.4, PyTorch 2.14.1+cpu, requests, eth-abi and eth-utils; Solidity 0.8.30 is supplied by `../../contract-benchmark/node_modules/solc`. Tests start only loopback Anvil, chain 31337. There is no remote RPC argument or signing-key input.

`lossless-results.json` contains full-payload codec checks, entropy/rank results and the input-buffer mitigation. `architecture-results.json` contains all 78 checks and actual local receipts. `cost-results.json` contains modeled total weight deployment costs. `QualityExperiments.sol` is research code, unaudited, and deliberately not connected to `Agent.sol` as if it were an LLM.
