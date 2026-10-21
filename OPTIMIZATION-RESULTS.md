# Exact Solidity optimization results

**Subsequent research:** `COMPILED-WEIGHTS-RESULTS.md` records the later 144-million-gas third position, with a much higher 4,559-contract deployment cost. This report preserves the earlier lower-deployment-cost option.

**The latest implementation reduces the third-position cost from 1,022,975,335 to 399,282,174 gas (60.97%).** It is 81.64% below the original scalar implementation for that position. This is the complete first convolution block at one token position, not a complete generated token or chat reply.

All full-block totals are local Cancun Anvil transaction receipts. No public transactions were broadcast and no real funds were spent. The selected version keeps the same 355 data shards, all original int4/Q16 precision and the same integer outputs.

## Full-block measurements

| Position | Original scalar | Previous six-lane | New kernel, single steps | New kernel + batches | Reduction vs previous |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 2,212,145,945 | 1,060,952,306 | 546,745,202 | 437,259,145 | 58.79% |
| 1 | 2,176,355,672 | 1,025,162,033 | 510,954,929 | 401,468,872 | 60.84% |
| 2 | 2,174,168,974 | 1,022,975,335 | 508,768,231 | 399,282,174 | 60.97% |

Across all three positions, gas falls **60.18%** versus the previous six-lane run. The kernel and batching were measured separately so their savings are not conflated.

| Deployment / execution property | Result |
| --- | --- |
| Contracts | Same 355 weight/data shards plus one engine |
| Transactions per position | 384 → 52 |
| Computation chunks per position | 383, all checked individually |
| Engine runtime | 6,820 bytes |
| Maximum local transaction, including deployment | 11,225,557 gas |
| Total local deployment gas | 1,374,654,011 |
| Deployment increase vs previous | 119,262 gas |

## What changed

1. **Multiply-and-mask weight unpacking.** Multiplication by a carefully chosen constant spreads packed nibbles into wide lanes, replacing many separate shifts and masks.
2. **Packed accumulation across the row.** Five 48-bit lanes allow partial products to be summed before extracting the desired coefficient. The earlier six-lane version extracted and corrected every group.
3. **One signed correction per row.** Activation bias is accumulated once per projection, and packed weight bias is summed and reduced once per output row.
4. **Measured loop unrolling.** Two ten-input groups per loop won among the tested wide-lane variants. More unrolling was slower in this compiler configuration; those results are retained.
5. **Atomic batches of up to eight steps.** Self-calls retain warm storage access within a transaction and amortize transaction overhead. State and every chunk digest remain observable. A failed batch reverts all its steps.

The schedule groups chunks within each stage. The last stage also tests requesting eight advances when only one remains; execution stops at completion. The existing single-step interface remains usable. Different callers can advance the job, while only the owner can supply its next input.

## Arithmetic bound and verification

For each group, activations are biased to A=x+2^31 and weights to B=w+8. Activations occupy ascending 48-bit lanes and weights descending lanes. Coefficient 4 of their product is the desired five-term unsigned dot product. Across a whole row, every coefficient is strictly below `2560 × 15 × 2^32 < 2^48`. Thus lower coefficients cannot carry into the desired lane, even after summing all groups. The low 256-bit EVM product preserves bits 192–239 exactly. Remainders use scalar products.

The signed result for n packed inputs is `C + n*2^34 - 8*sum(A) - 2^31*sum(B)`. A modulo reduction by `2^48-1` sums the packed weight lanes exactly because the total is below that modulus. These bounds rely on int32 activations, int4 weights and at most 2560 input columns; widening those limits needs a new proof.

- Both single-step and batched full-block runs passed 1,149 chunk digests and 36 persisted-vector checks each.
- Each selected full-block run passed 48 randomized/extreme projection probes, 10 integer-square-root cases and 12 SiLU cases.
- Each kernel candidate passed 68 differential cases, including all-minimum/all-maximum int32 activations, -8/7 weights, alternating signs and remainder lengths.
- A real local multi-step transaction ran out of gas; all engine storage and logs rolled back. Its test gas is excluded from inference totals.
- Input authorization, invalid batch sizes, completion rejection, snapshot rollback and deterministic replay passed.
- Every original weight-shard hash is rechecked. No retraining, new quantization or off-chain inference was used.

These are analytical bounds and differential tests, not a formal verification or security audit. Exact agreement preserves the existing approximate int4 model; it does not fix the previously measured model-quality limitations.

## Kernel screening

Receipt figures here include ABI calldata overhead and omit persistent inference state. They select candidates; full-block receipts above establish application savings.

| Candidate | 32×1024 projection gas | 16×2560 projection gas | Runtime bytes |
| --- | ---: | ---: | ---: |
| LfmBlockSwar6 | 2,654,568 | 3,423,284 | 6,263 |
| LfmBlockFast6 | 1,694,295 | 2,213,552 | 6,230 |
| LfmBlockFast6U4 | 1,286,266 | 1,698,243 | 6,539 |
| LfmBlockFast6U8 | 1,511,418 | 1,979,267 | 6,998 |
| LfmBlockFast6U16 | 1,654,566 | 2,142,527 | 7,963 |
| LfmBlockWide5 | 1,425,404 | 1,873,258 | 6,265 |
| LfmBlockWide5U2 | 1,259,865 | 1,664,823 | 6,580 |
| LfmBlockWide5U4 | 1,580,601 | 2,066,151 | 6,922 |
| LfmBlockWide5U8 | 2,342,082 | 3,080,963 | 8,553 |

## Public-node samples

**Latest public replay is blocked, not completed.** Automatic approval review rejected sending prototype contract bytecode, storage overrides and model-derived intermediate state to third-party public RPC nodes. Local validation is complete; no current public-node compatibility or new fee quote is claimed. The prepared replay script selects three batches per network: input projection, final feed-forward projection, and final residual/completion. Any future replay needs approval for that disclosure.

| Network | Status | Matching calls |
| --- | --- | ---: |
| Base / Robinhood / BSC | Blocked by automatic approval review | No completed latest replay |

## Research decisions and remaining limits

The selected implementation adapts multiply/mask bit-spreading techniques and the EVM cold/warm storage rules. The packing constants and full-row coefficient bound were derived for this model shape and checked in EVM; the sources do not claim these exact benchmark results.

MODEXP was reviewed as a possible wider-arithmetic route. EIP-7883 raises its pricing and EIP-7823 limits operands to 1024 bytes where activated. It is not a native matrix-multiplication operation. No MODEXP-based speedup was assumed or claimed, and current adoption was not inferred for every target chain.
Expanded precomputed weights were deferred: the selected approach obtains substantial savings without increasing model-data storage or contract count. Pruning, lower-rank weights and further quantization would change outputs and need separate quality evaluation; none were silently substituted.

At 399,282,174 gas, reaching 100 million still needs about 4x further reduction, 10 million about 40x, and 1 million about 399x. These are required factors, not promised future savings. The remaining thirteen model blocks, attention state, embedding lookup, tokenizer and vocabulary projection are not integrated. Full-model token cost, reply latency and agent actions remain unmeasured.

## Reproduce

From the project root with the previously documented dependencies and Anvil installed:

```bash
python3 block-benchmark/generate_unrolled.py
node block-benchmark/compile.cjs
.venv/bin/python block-benchmark/kernel_sweep.py --anvil /absolute/path/to/anvil --contracts LfmBlockWide5 LfmBlockWide5U2 LfmBlockWide5U4 LfmBlockWide5U8 --output kernel-sweep-wide5.json
.venv/bin/python block-benchmark/run_local.py --anvil /absolute/path/to/anvil --variant optimized --batch-size 1
.venv/bin/python block-benchmark/run_local.py --anvil /absolute/path/to/anvil --variant optimized --batch-size 8
.venv/bin/python block-benchmark/summarize_optimization.py
```

Compiler: Solidity 0.8.30, optimizer 200 runs, via IR, Paris bytecode. Local chain: Anvil 1.8.5, Cancun rules. The local runner accepts no public RPC endpoint. Public scripts permit read-only RPC methods only.

Primary references consulted October 20, 2026:

- https://graphics.stanford.edu/~seander/bithacks.html — multiply/mask bit spreading and packed reductions.
- https://docs.soliditylang.org/en/latest/assembly.html — inline assembly and memory discipline.
- https://eips.ethereum.org/EIPS/eip-2929 — transaction-wide cold/warm storage access.
- https://eips.ethereum.org/EIPS/eip-7883 — MODEXP repricing.
- https://eips.ethereum.org/EIPS/eip-7823 — MODEXP operand bounds.
- https://docs.base.org/specifications/transactions/throughput-and-limits — documented transaction limit.
