# Exact attention assembly

`attention-assembly.sol.inc` replaces the original `_attention` function and retains its causal grouped-query attention, score scaling, lookup-table softmax, rounding, and outputs. It uses the original `Work` memory layout and the original exponent table at byte offset 2052.

The arithmetic is safe over the entire signed-int32 query/key/value domain. A dot product contains 32 products, so its absolute value is at most `32 * 2^62 = 2^67`, well within signed int256. Division by 23,170 and subtraction from the maximum cannot approach int256 limits. Every interpolated exponent is nonnegative and no greater than uint32 max. The denominator contains at most 16 exponents. A weighted sum has magnitude at most `2^31 * denominator`, again well within int256. Its nonzero-denominator weighted average stays inside the signed-int32 range of its inputs. A zero denominator raises the same Solidity division-by-zero panic as before.

`test-attention.mjs` compiles a local probe containing both the original and assembly functions, creates an isolated Anvil node on loopback port 18556, compares outputs, records internal gas deltas, and stops the node. It does not use a public RPC or existing wallet.

All 128 output values matched in each of 24 cases spanning positions 0, 1, 9, and 15. Cases included zeros, small values that exercise interpolation, Q12-scale random values, full signed-int32 random values, alternating signed extrema, and constant signed extrema. Both versions returned the identical panic for an all-zero exponent table.

Representative internal attention-only gas, measured inside the same probe:

| Position | Original | Assembly |
| --- | ---: | ---: |
| 0 | 238,639 | 49,115 |
| 1 | 420,651 | 80,487 |
| 9 | 1,876,747 | 331,463 |
| 15 | 2,968,819 | 519,695 |

These are isolated attention measurements, not full v4 swap costs. `attention-parity.json` retains every result and source hash. Integration into a complete model must separately pass hidden-state and full-logit parity and the real local v4 swap benchmark.
