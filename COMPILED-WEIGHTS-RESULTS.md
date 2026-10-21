# Compiling fixed weights into executable contracts

**The third-position cost falls from 399,282,174 to 143,986,402 gas: another 63.94% reduction.** This is 93.38% below the original scalar implementation for the same position. The result covers the complete first convolution block, not full-model token generation or a chatbot.

All measurements are disposable local Cancun Anvil receipts. No real funds were spent. No public RPC replay was attempted in this round; the earlier disclosure approval remains unresolved.

## Full-block comparison

| Position | Previous batched Solidity | Executable weights | Reduction |
| --- | ---: | ---: | ---: |
| 0 | 437,259,145 | 181,963,373 | 58.39% |
| 1 | 401,468,872 | 146,173,100 | 63.59% |
| 2 | 399,282,174 | 143,986,402 | 63.94% |

Aggregate reduction across the three positions: **61.86%**. The first position pays more to initialize previously empty state slots. All versions execute the same 383 computation chunks; the batched variants use 52 transactions per position.

## The deployment trade-off

| Property | Previous version | Executable-weight version |
| --- | ---: | ---: |
| Contracts | 356 | 4,559 |
| Deployment gas | 1,374,654,011 | 17,893,032,220 |
| Extra model-derived executable code | — | 77,813,728 bytes |
| Largest observed transaction | 11,225,557 | 11,262,351 |

The new layout adds **16,518,378,209 deployment gas** and saves **255,295,772 gas per tested block position**. **Gas-only break-even is 65 block-position executions**, assuming the measured savings continue. This is not 65 complete generated tokens or conversations. It excludes differing gas prices over time, chain-specific data fees, deployment compression, congestion and financing costs. A monetary break-even has not been measured.

The previous 356-contract implementation remains available. For a small number of executions its lower deployment cost can outweigh the new version's execution savings. No public deployment was chosen or funded.

## What runs on chain

The compiler converts fixed int4 weights into immediate constants in ordinary EVM bytecode. Each program performs straight-line packed multiplication, signed correction, row scaling and int32 overflow checks. The Solidity engine prepares activations from its own stored intermediate vectors and calls the programs with STATICCALL. Programs return computed row outputs. No model output, intermediate answer or inference result is calculated offline for execution.

There are 4,192 executable weight programs: up to three 1024-column rows or one 2560-column row per program. Their maximum runtime size is 19,845 bytes. Eleven immutable data books contain 52-byte address/codehash records. The engine commits to the books and checks each target program's expected code hash before executing it. The original 355 data shards remain deployed for provenance and the unchanged nonlinear operators. One engine brings the total to 4,559.

The weight programs are generated EVM contracts; the coordinator, normalization, convolution, activation and state handling remain Solidity. The offline step is code generation from fixed weights, like compilation. All input-dependent arithmetic remains in smart-contract execution.

## Exactness and checks

The same five-lane, 48-bit coefficient representation is used. Columns are padded with zero-weight/zero-activation terms to a multiple of five. A row has at most 2560 actual or padded terms, so each accumulated polynomial coefficient is below `2560 * 15 * 2^32 < 2^48`. The selected coefficient is extracted after all groups are summed; signed corrections and Q24 scale division retain the previous rounding.

- 1,149/1,149 computation digests and 36/36 persisted vectors matched the existing integer reference across three consecutive positions.
- 71 focused generated-program cases passed: real model rows, randomized inputs, int32 extremes, signs, padding, zero, negative truncation and overflow rejection.
- Each non-overflow program case rejected truncated, empty and overlong raw input. Four representative programs were actually deployed and their runtime bytes checked.
- Every one of the 4,192 generated programs was independently regenerated from its corresponding original row data and matched byte-for-byte; all hashes and row coverage were checked.
- A deliberately changed program was rejected by the engine's codehash check; restoring the exact code restored valid execution.
- Unauthorized input replacement, input lengths, batch limits, completed jobs, nonlinear boundaries and projection probes passed.
- A real local out-of-gas batch reverted all engine storage and logs. Snapshot rollback/replay also passed. Extra test gas is excluded from inference totals.

This is differential testing and deterministic regeneration, not a formal verification or security audit. Weight provenance is established by the reproducible build and manifest; the engine does not reconstruct all source weights on chain to prove the compilation. Exact agreement preserves the prior int4 approximation and its known quality limitations.

## Research assessment

The research considered preprocessing fixed matrices, lookup-based matrix-vector algorithms, and restructuring quantized weights to reduce unpacking. The selected EVM implementation specializes the program to fixed weights. It removes interpretation and runtime weight decoding; it does not claim an asymptotically faster matrix algorithm.

The FLUTE paper provides an example of restructuring fixed quantized weights to reduce unpacking on GPUs. Its reported speedups do not apply directly to EVM. Williams' preprocessing results concern abstract computational models; no asymptotic bound from that paper is treated as an EVM gas prediction. Only the local contract measurements above establish this implementation's savings.

Runtime range-aware packing and lookup-table approaches remain unimplemented candidates. They are not included in the claimed savings. A smaller model, pruning or further quantization would change model outputs; none was substituted here.

## Remaining scope

This still implements only the first of fourteen model blocks with supplied input embeddings. Tokenization, embedding lookup, attention/KV state, the remaining blocks, vocabulary projection, decoding and agent actions are not integrated. No full-model token price or reply latency is established. The 144-million figure is the third measured block position; it must not be presented as a complete LLM reply cost.

## Reproduction

Use the pinned dependencies and Anvil described in block-benchmark/README.md. From the project root:

```bash
.venv/bin/python block-benchmark/compiled_weights.py
node block-benchmark/compile.cjs
.venv/bin/python block-benchmark/check_compiled_weights.py --anvil /absolute/path/to/anvil
.venv/bin/python block-benchmark/run_local.py --anvil /absolute/path/to/anvil --variant compiled --batch-size 8
.venv/bin/python block-benchmark/summarize_codeweights.py
```

The local harness deploys all 4,559 contracts using disposable simulator accounts. It accepts no public RPC URL. Raw reports are results/compiled-weight-kernels.json and results/block-compiled-batch8-local.json. The previous compiled artifact and relevant sources are preserved in block-benchmark/prior-optimized-baseline/. The new virtual projection hook slightly changes recompiled older engines; their historical receipts correspond to the archived bytecode.

Primary references consulted October 20, 2026:

- https://arxiv.org/abs/2407.10960 — FLUTE, restructuring quantized weights to reduce unpacking.
- https://people.csail.mit.edu/rrw/mat-vec3.pdf — fixed-matrix preprocessing and computational-model limits.
- https://eips.ethereum.org/EIPS/eip-170 — maximum contract runtime size.
- https://eips.ethereum.org/EIPS/eip-3860 — initcode size and metering.
- https://docs.soliditylang.org/en/latest/assembly.html — inline assembly and memory discipline.
