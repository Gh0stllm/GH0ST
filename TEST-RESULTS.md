# LFM on-chain feasibility: test results

**Later optimization:** `OPTIMIZATION-RESULTS.md` records the subsequent exact wide-lane and batching implementation, which lowers the third-position total to 399,282,174 gas. `COMPILED-WEIGHTS-RESULTS.md` records a later 143,986,402-gas variant with substantially higher deployment costs. Tables below retain their original variant and fee-snapshot scope.

The complete first LFM convolution block works as resumable Solidity contracts. The present implementation remains expensive even after a substantial arithmetic optimization. Full on-chain chat and agent actions are not implemented.

All public interactions were read-only node simulations. Real ETH/BNB spent: **0**. The 356 deployments per variant occurred only in disposable local Anvil chains.

Model: `LiquidAI/LFM2.5-230M`, revision `40cb2ad3b3044d5a41eee083a6103c8b523afa45`.
The original tests were performed on October 19, 2026 UTC; the six-lane follow-up was run on October 20. Exact timestamps, blocks, inputs and outputs are in the JSON records.

## Arithmetic and persistent state

| Test | Measured result |
| --- | --- |
| Complete layer-zero execution | 3 consecutive token positions in each of scalar, four-lane and six-lane EVM implementations |
| Integer-reference agreement | 1,149/1,149 step digests and 36/36 persisted vector checks per implementation |
| On-chain data layout | 355 immutable data shards plus 1 engine; 6,098,948 payload bytes for this block |
| Progress transactions | 384 per token position in this block |
| Arithmetic optimization | 47.32% lower total computation gas across the three positions |
| Additional correctness | 48 randomized/extreme projection cases; 10 square-root and 12 SiLU boundary cases |
| Input and recovery behavior | Unauthorized/active input replacement rejected; actual step rollback and deterministic replay passed |
| Public-node validation | 15 sampled steps each on Base, Robinhood and BSC matched; 45/45 total |

| Position | Scalar gas | Four-lane gas | Reduction |
| --- | ---: | ---: | ---: |
| 0 | 2,212,145,945 | 1,177,069,618 | 46.79% |
| 1 | 2,176,355,672 | 1,141,279,345 | 47.56% |
| 2 | 2,174,168,974 | 1,139,092,647 | 47.61% |

Four-lane local deployment consumed **1,374,497,800 gas** in total. The largest observed transaction, including deployment, used **10,581,478 gas**. That is below Base's documented 16,777,216 per-transaction maximum. Splitting computation fits transaction limits; it does not erase total gas.

The three EVM fixtures are the first three template tokens `[1, 6, 6423]`. They are not a complete user message. The separate numerical sweep below covers more varied text but runs in the CPU integer reference.

## Six-lane Solidity optimization follow-up

`LfmBlockSwar6.sol` packs six int4/int32 products into each 256-bit multiplication using 40-bit lanes. It preserves the same weight files, integer precision, rounding, state layout and transaction schedule. The runtime code is 6,263 bytes; all measurements below are disposable local Anvil receipts.

| Position | Four-lane gas | Six-lane gas | Additional reduction |
| --- | ---: | ---: | ---: |
| 0 | 1,177,069,618 | 1,060,952,306 | 9.86% |
| 1 | 1,141,279,345 | 1,025,162,033 | 10.17% |
| 2 | 1,139,092,647 | 1,022,975,335 | 10.19% |

Across all three positions, the new layout saves **10.08%** beyond the four-lane version. All 1,149 step digests and 36 persisted-vector checks match the integer reference. The 48 randomized/extreme projection checks, nonlinear boundaries, access checks and rollback/replay also pass. This is exact agreement with the existing quantized implementation, not an improvement in its model quality.

Six-lane total deployment used **1,374,534,749 gas** across 356 contracts. The largest transaction used **10,618,427 gas**. Fifteen public-simulation fixtures were captured, but no public-node validation or new fee pricing was run for this variant. The chain fee table below still describes the four-lane version.

### What would lower gas targets require?

Using position 2 of the six-lane run (1,022,975,335 gas) as the comparison:

| Target for this single block/position | Additional reduction factor required |
| --- | ---: |
| 100,000,000 gas | 10.2x |
| 10,000,000 gas | 102.3x |
| 1,000,000 gas | 1023.0x |

The current 384-transaction schedule has 8,064,000 gas of basic transaction overhead alone (384 times 21,000), before calldata, arithmetic, storage and other execution. Batching could change this schedule; this is a bound on the present design, not a universal lower bound for inference.

Further exact optimizations worth measuring include precomputed weight layouts, amortizing activation reads across more rows, and lower-overhead arithmetic loops. Pre-expanded weights trade cheaper execution for more data and deployment gas. These are research candidates, not demonstrated savings or a plan guaranteed to reach 100 million gas. Nothing measured here supports a 100x or 1,000x reduction from ordinary Solidity tuning. Thousands of gas for this full block is not a credible target. A much smaller model, structured reduction of its arithmetic, or chain-supported native inference execution would change the design and need separate quality/cost measurements. No off-chain inference has been substituted.

## Chain fee comparison

**The unit below is one convolution block at one token position. It is not the price of a full model token or chat reply.** All numbers use the measured 4-bit implementation; an 8-bit Solidity block has not been benchmarked.

| Network | Initial block | Gas price (gwei) | Planning cost across the 3 positions | Indicative USD |
| --- | ---: | ---: | --- | ---: |
| Base | 52,832,101 | 0.006000 | 0.007177–0.007416 ETH | $17.29–$17.87 |
| Robinhood | 93,010,219 | 0.020058 | 0.023990–0.024790 ETH | $57.80–$59.72 |
| BSC | 128,644,522 | 0.050000 | 0.059802–0.061796 BNB | $43.82–$45.28 |

USD conversion uses indicative ETH $2,409.10 and BNB $732.79, recorded 2026-10-19T23:46:02.809899+00:00. Prices and fee snapshots were sampled separately and can change.

Planning totals use the complete local receipt sum, a 5% cushion (or a larger sampled estimator ratio if needed), and the sampled chain gas price. Base adds separately queried L1 upper estimates; its operator-fee probes were zero. Robinhood estimates already bundle L1 data costs. BSC uses BNB. Deployment is excluded. These are modeled fees, not public receipts or guaranteed maximums.

BSC pruned the original pinned state during the first attempt. The successful rerun pins a fresh block for each case. Base's first attempt encountered a transient RPC/proxy error and was rerun. Original attempts are retained. This comparison does not measure network inclusion time, application concurrency, or throughput under congestion.

## Precision and model usefulness

The first-block integer CPU reference was tested on four 64-token sequences, including task instructions, numbers, code-like text and multilingual text. Convolution state persists within each sequence. All 256 positions completed without int32 overflow at each precision.

| First-block weight precision | Mean relative L2 output error vs float32 | Worst error | Mean cosine similarity |
| --- | ---: | ---: | ---: |
| int4 per row | 20.30% | 37.08% | 0.979260 |
| int8 per row | 1.09% | 2.05% | 0.999939 |

Relative L2 error is a numerical vector error, not a percentage of wrong answers. Errors in later blocks and final token selection are not measured by this first-block comparison.

Full-model CPU tests separately quantized/dequantized the unique 2D weights while keeping floating-point runtime arithmetic. The native tool suite offered four functions: set_goal, create_task, complete_task and get_task. It used twelve exact-call cases and four cases expecting no call. No generated call was executed.

| Full-model weight variant | Exact requested calls | No-call cases | Packed 2D weights + scales + other fp32 parameters |
| --- | ---: | ---: | ---: |
| float32 | 7/12 | 4/4 | 918.77 MB |
| int8_per_row | 7/12 | 4/4 | 230.67 MB |
| int4_per_row | 2/12 | 3/4 | 115.85 MB |
| int4_group32 | 0/12 | 4/4 | 143.74 MB |

These parameter sizes exclude tokenizer data, runtime code and persistent inference state. Storing the full model in payloads the size of the tested shards would require thousands of contracts; the 356 deployments cover only the first block.

These are small deterministic smoke tests, not a representative benchmark. Some failures were formatting or capitalization differences; others incorrectly claimed that an available tool did not exist. The original model also failed five of twelve exact-call cases. The 8-bit variant matched its aggregate score but is not thereby established as reliable enough for a complex autonomous agent.

The two 4-bit methods tested here degraded performance. This does not establish that every 4-bit method, calibration scheme, fine-tune or inference implementation would behave the same. The grouped method uses naive groupwise rounding, not an advanced calibrated quantizer.

The separate thirteen-prompt suite tested greeting, factual recall, arithmetic, strict output formatting, state lookup and one native tool call. Its strict automated pass counts were 2/9, 2/9, 1/9 and 1/9 in the same order. For example, the baseline computed 43 correctly but failed a request for only the number because it added explanation. Those scores must not be described as general reasoning accuracy. All raw outputs are included.

## Bugs, constraints and incomplete work

- Fixed Solidity integer square root for input 2 and probe-row scale alignment for non-word-aligned byte strides.
- Widened CPU convolution intermediates to avoid an int64 reference overflow for extreme values; the original three output hashes are unchanged.
- Rollback/replay uses local chain snapshots. It is not an application-level abort/resume feature. The prototype has no cancel/reset method; an overflowing active job can stall the instance.
- Only one sequence is supported, with owner-supplied embeddings. No tokenizer, token-ID input validation, embedding lookup, remaining blocks, attention cache, vocabulary projection or decoder is integrated.
- No wallet actions, goal/task contracts, action grammar, permissions for actions, or funds-handling logic were implemented or audited.
- No full model token, chat reply, mainnet deployment, end-to-end latency or parallel execution was tested. A large number of contracts does not create extra base-chain computation capacity.
- The earlier Robinhood mainnet and testnet probes recorded an activationGas value of uint64 max. New Stylus activation was not attempted; the configured pause was not bypassed. Base does not provide the same Stylus runtime path.
- This is experimental benchmark code, not a security audit or production release.

## Recommended decision

Keep Base as the lowest-fee development target among these measured snapshots. Preserve the fully-on-chain runtime goal, but do not treat this 230M Solidity implementation as ready for a complex chat product. The measured first-block cost is already high, and the model still needs thirteen more blocks plus its vocabulary projection and all integration work.

For LFM research, use int8 as the next accuracy baseline and measure an int8 kernel before assuming its costs. The model also needs a larger task-specific tool evaluation and likely adaptation. Further work should establish a complete next-token pass locally before funding a full network deployment. A substantially smaller task-specific model or a chain-supported efficient inference runtime would be a separate design decision; neither has been silently substituted for LFM.

## Reproduction and evidence

See `block-benchmark/README.md` for commands, arithmetic, fee formulas and file mappings. All weight-shard hashes and result totals are checked by `block-benchmark/summarize_results.py`. The complete local logs, public RPC observations, generated outputs and initial failed attempts are included.

Primary technical sources:

- https://huggingface.co/LiquidAI/LFM2.5-230M
- https://ethereum.org/developers/docs/gas/
- https://docs.base.org/specifications/transactions/throughput-and-limits
- https://docs.base.org/specifications/transactions/network-fees
- https://docs.base.org/specifications/base-protocol/execution/predeploys
- https://docs.robinhood.com/chain/gas-and-fees/
- https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/
- https://github.com/OffchainLabs/stylus-sdk-rs/blob/v0.10.10/stylus-tools/src/core/activation.rs
