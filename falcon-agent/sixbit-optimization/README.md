# Six-bit optimization on existing Robinhood Chain

20 October 2026. **The under-one-billion deployment and usage targets have not been achieved.** The selected model remains Falcon-H1-Tiny-90M-Instruct, revision `e6389502a0b12cd8da894b395ba5bf7436873b16`. All weights remain on-chain in the intended design; no API, proof-of-off-chain-inference, genesis allocation, training, or fine-tuning was introduced.

This study implements a smaller exact encoding, native EVM arithmetic kernels, and a MODEXP experiment. It measures every matrix of the selected six-bit model on a local EVM. It does **not** implement complete Falcon inference or a working chat agent.

## Results

| Measurement | Previous selected six-bit format | New exact compact format |
|---|---:|---:|
| Complete weight-file bytes | 79,890,833 | 72,045,528 |
| Weight shards at 61,439 payload bytes | 1,301 | 1,173 |
| Modeled aggregate shard deployment gas | 17,304,643,105 | 15,648,599,873 |
| Code deposit for payload only | 15,978,166,600 | 14,409,105,600 |

The file saves **7,845,305 bytes (9.820%)**. Modeled deployment saves **1,656,043,232 gas (9.570%)**. The new file counts its 16-byte header and 12,352-byte tensor directory. Shard deployment also counts STOP prefixes, creation, initcode, transaction data and memory under the standard Cancun schedule. It excludes the shard-address directory, inference engine, tokenizer, controller and L1 fees. Three actual local deployments match the cost formula and their full code bytes; the maximum modeled shard is 13,346,104 gas.

These are **local Cancun measurements/models, not current Robinhood fee quotes**. Anvil's code-size limit was increased to 96 KiB to reflect RH's documented code limit; Anvil is not Nitro. Chain transaction budgets and chain-specific fee behavior remain unverified. No public transactions were submitted and no real ETH was spent.

| Real-weight matrix slice, synthetic signed-int16 input | Scalar Q24 baseline | Dedicated packed kernel | Reduction |
|---|---:|---:|---:|
| Embedding/output-head, 32 × 512 | 3,192,205 | 566,202 | 82.26% |
| Layer 0 down projection, 32 × 768 | 4,770,968 | 828,584 | 82.63% |
| Layer 11 Mamba input projection, 32 × 512 | 3,192,253 | 564,650 | 82.31% |
| Layer 23 value projection, 32 × 512 | 3,192,157 | 569,222 | 82.17% |

Gas includes one local transaction, reading immutable weight code, preparing inputs, computing the matrix product and returning results. This is a comparison against the explicit scalar kernel in this study, not a claimed reduction from a previously completed full Falcon runtime. The dedicated kernel deploys for **830,442 gas**; it is one component, not the LLM deployment cost.

The larger verification executes **all 217 two-dimensional matrices**, totaling **90,996,736 weights**, once each. All **165,440 output rows** match the independent NumPy integer reference. There are **2,600 matrix-tile transactions**, totaling **2,965,180,308 usage gas**. Their inputs are synthetic and independent per matrix. This total includes the tied embedding matrix once as a full output projection. It is **not a generated-token measurement**: it omits actual layer-to-layer activations, normalization, attention, Mamba recurrence, state writes, tokenization, sampling and agent work. A complete token or reply cost remains unknown. These results do not establish usage below one billion.

The local matrix test also deploys independently re-encoded tiles for testing. Its tile-deployment total excludes nonmatrix weights and a complete model directory, so it is not interchangeable with the complete-file deployment figure above.

## Exact storage transformation

The prior affine representation stores a signed Q24 offset and unsigned Q24 scale, each four bytes, for every 64 weights. That is 11,374,592 metadata bytes in addition to six-bit codes.

For this pinned export, those offsets and scales can be reconstructed from two BF16 endpoint values. The encoder derives those endpoints, encodes their differences from tensor-local bases, and bit-packs the result. The EVM decoder converts the endpoints into Q24 and recovers the exact existing scale. Nonmatrix BF16 tensors are copied unchanged. The same 64 codes remain in every group; groups are not merged or requantized.

An important edge case is preserved: the original export computes its scale using float32 division and round-to-nearest-even. Naively replacing that with nearest integer division changes **299 of the 1,421,824 groups**. The integer decoder reproduces those half-way cases explicitly. Every offset, scale, code and nonmatrix byte was checked by rebuilding the complete old export byte-for-byte.

Source SHA-256: `a0e3121e433f8fc000219ec629c0ab361749d9190f903118e7a96a7c4c29cead`.

Compact SHA-256: `1aca236cbf553bab84bd5aa934a9d5e73d82748113e7c8b8272f4382f41e23fc`.

Consequently the **format transformation adds no quality loss to the already selected six-bit weights**. It does not reverse the earlier six-bit quantization loss. Earlier CPU tests reported 92.81% teacher-forced next-token agreement over 765 positions and 8/32 identical short replies versus the original model. Those are small-suite fidelity measures, not accuracy guarantees.

## Arithmetic optimization

For a group, the exact integer equation is:

`dot = offset × sum(x) + scale × sum(code × x)`.

Factoring the scale alone did not help in the tested Solidity implementation: extra accumulator and control-flow work outweighed saved multiplications. Those negative results are retained in `kernel-results.json`.

The successful kernel spreads eight six-bit codes into 32-bit lanes of a 256-bit word. It packs eight biased signed-int16 activations in reverse lane order. One multiplication produces eight desired products in a single coefficient; unrelated polynomial coefficients occupy other lanes. Eight such products accumulate before extraction, followed by a single signed-bias correction per 64-weight group. Input packing and input sums are reused across output rows. The loop is unrolled and a dedicated code path avoids benchmark-strategy branches.

No coefficient can carry into its neighbor: the group bound is `64 × 63 × 65,535 = 264,237,120 < 2^28`, below a 32-bit lane. EVM multiplication modulo `2^256` preserves the selected coefficient. These are exact integer transformations under the documented input bounds.

**Activation precision is an unresolved integration gate.** The reference chat tests used float32 activations. The new kernels use signed-int16 inputs with no internal rounding. Their exact integer matches do not prove that a complete int16 Falcon runtime preserves the CPU model's quality. Correct attention/Mamba state and nonlinear arithmetic are still missing.

## Additional routes investigated

| Approach | Evidence from this work | Decision |
|---|---|---|
| Compact encoding plus Zstd-19 | 71,629,113 bytes, exact CPU roundtrip | Small extra saving; no on-chain Zstd decoder |
| Bitplane transform plus Zstd-19 | 71,659,694 bytes, exact roundtrip | Worse than directly compressed compact file |
| Row-delta transform plus Zstd-19 | 71,899,831 bytes, exact roundtrip | No useful improvement |
| One byte per six-bit symbol, then Zstd-19 | 70,263,862 bytes, exact roundtrip | Best new compressed-size experiment, but still 14.053B code-deposit gas alone; no on-chain decoder |
| Static Huffman symbol coding | 69,278,579 bytes including current other data, before codebooks/framing | Calculated size, not an implemented deployment codec |
| Smaller metadata tiles | Best tested layout estimate 71,922,616 bytes at 512 groups/tile | Only 0.17% smaller than implemented format; requires another directory/layout |
| Exact duplicate 64-code groups | Only 190 repeats within tensors out of 1,421,824 groups | Dictionary indices would overwhelm savings |
| Low-rank factors at roughly 15.65× compression | Four selected matrices have at least 57.2–85.8% relative squared weight error even for optimal real-valued rank-r factors | No evidence of small quality loss; no weights replaced |
| One MODEXP square for a 64-element dot | Exact in local Cancun and Osaka tests; slower than native packed multiplication | Retained as a negative research result |

Symbol statistics were measured on **every** matrix: entropy is 5.7296 bits per code with tensor-specific histograms, or 5.6980 with a previous-symbol context. An ideal tensor-specific symbol coder plus the current other data would still occupy about 68.97 MB, before practical tables/framing. This tests the relevant hypothesis behind entropy compression; it is **not** a proof against all possible algorithms or an information-theoretic lower bound on this particular file.

### MODEXP experiment

This prototype applies the known Kronecker-substitution idea to the EVM precompile. Let `A` contain 64 codes in 32-bit lanes and `X` contain reversed, biased activations. Construct `B = A + X × 2^2048`. In `B² mod 2^4096`, the coefficient at bit 4064 contains twice the desired unsigned dot. The square of `A` ends below that coefficient and the square of `X` starts above it. All input construction and bias correction run on-chain in the local test; inputs are not precomputed externally.

For the same random 64-product case and the same code-stored weights, the native comparator costs **29,615 gas**, versus **47,359** for MODEXP under Cancun and **54,401** under Osaka. All 20 comparisons across the two methods and five inputs on two forks match the integer reference. Testing both schedules matters because EIP-7883 raises MODEXP prices and EIP-7823 caps operands where adopted. This does not assert either fork's activation on RH.

### Research assessment

The 2026 lossless-compression paper *Approaching Shannon Bound with Lossless LLM Weight Compression* motivates tensor histograms, tile-local codecs and fused decoding. Its largest headline ratios concern other numeric distributions and models; they cannot be transferred to these measured six-bit codes. Its GPU throughput results are not EVM gas measurements.

NanoQuant is a relevant sub-bit research direction, but its pipeline optimizes latent factors/scales and performs block/model reconstruction. It changes the model representation and uses tuning, unlike the exact conversion here. The paper's experiments do not validate a 91M Falcon hybrid model at the required effective bitrate with a small chat-quality loss. Its own ablations show substantial degradation when reconstruction steps are removed. AQLM similarly uses learned additive codebooks and joint optimization. Neither is treated as a ready-made solution under the existing no-training constraint.

Stylus can reduce computation costs on chains where execution/activation is enabled, but official documentation distinguishes this from persistent storage costs. This study does not establish current RH Stylus activation availability, and switching execution engines does not itself compress 72 MB of weights into the deployment target. The active implementation remains Solidity.

## Why the target is still missed

At the modeled standard EVM code-deposit rate of 200 gas per byte, one billion gas covers at most **5,000,000 bytes before every other cost**. For 91,131,072 parameters, that is only **0.4389 effective bits per parameter**, including all model representation overhead. Even an ideal one-bit-per-parameter file would cost about **2.278 billion code-deposit gas** before scales and code.

The implemented compact file needs another **14.41× size reduction merely to reach the payload-only budget**. Transaction batching, shared implementations and larger shards reduce overhead; they do not remove this deposit charge. None of the tested lossless representations comes close to the required size. This is a measured failure to reach the goal, not a claim that every conceivable future compression method is impossible.

The current packed arithmetic also exceeds the usage target for the full synthetic linear pass. Lower full-token/reply costs require another algorithmic improvement and a completed runtime. No sub-billion complete deployment or complete inference claim is justified.

## What is ready and what remains

The compact exporter/decoder, pinned manifests, unsigned 1,173-shard data plan, exact arithmetic kernels and local tests are ready for review. The top-level selected manifest now points to the user-selected six-bit compact export. Previous NF4 manifests remain under `historical-weight-layouts/`; the old rehearsal script writes there by default.

The file-shard plan may split matrices across contracts. The benchmark kernel accepts one complete matrix tile in a local data contract. A production cross-shard reader, execution scheduler, tokenizer, nonlinear functions, attention/Mamba states, per-agent state and full next-token validation are still required. Permissioned controller actions remain separately implemented and tested with a scripted fixture, which is not an LLM.

No public deployment should be represented as ready. The model binaries are not redistributed in the source package; the exporter reconstructs them locally from the pinned public checkpoint and prior six-bit export. The existing custom model license still applies.

## Reproduction and evidence

Use the existing Python environment and Anvil, plus Solidity 0.8.30 with via-IR, Cancun bytecode and optimizer runs 1,000,000. Paths below are placeholders for local cache locations.

```bash
node falcon-agent/sixbit-optimization/compile.cjs
python falcon-agent/sixbit-optimization/optimize.py --source /cache/int6 --output /cache/compact
python falcon-agent/sixbit-optimization/test_kernel.py --source /cache/int6 --compact /cache/compact --anvil /tools/anvil
python falcon-agent/sixbit-optimization/research.py --source /cache/int6 --compact /cache/compact
python falcon-agent/sixbit-optimization/test_modexp.py --anvil /tools/anvil
python falcon-agent/sixbit-optimization/full_matrix_pass.py --source /cache/int6 --anvil /tools/anvil
python falcon-agent/sixbit-optimization/deployment_plan.py --export /cache/compact
```

`format-results.json` records complete byte recovery for 386 tensors. `kernel-results.json` contains 648 checks, six kernel strategies and three actual shard deployments. `full-matrix-results.json` contains all 217 matrix totals and 2,600 tile transactions. `research-results.json`, `tile-sweep-results.json` and `modexp-results.json` retain the additional measurements and negative results. The byte-layout sweep is a diagnostic estimate, not an implemented second format.

Primary references checked 20 October 2026:

- Robinhood differences and code limits: https://docs.robinhood.com/chain/differences-from-ethereum/
- Robinhood fees: https://docs.robinhood.com/chain/gas-and-fees/
- Geth code-deposit pricing: https://github.com/ethereum/go-ethereum/blob/master/params/protocol_params.go
- Lossless entropy compression: https://arxiv.org/pdf/2606.15789
- NanoQuant methods and ablations: https://arxiv.org/html/2602.06694v2
- AQLM official implementation: https://github.com/Vahe1994/AQLM
- Stylus gas/storage distinction: https://docs.arbitrum.io/stylus/concepts/gas-metering
- MODEXP operand bounds: https://eips.ethereum.org/EIPS/eip-7823
- MODEXP repricing: https://eips.ethereum.org/EIPS/eip-7883
