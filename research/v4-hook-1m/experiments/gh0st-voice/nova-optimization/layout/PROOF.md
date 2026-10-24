# Exact 11-lane packing for the selected N0VA weights

This local candidate changes only the derived matrix storage format. It keeps
all 8,175,493 accepted Q10 parameters, input checks, features, sigmoid table,
sampler, recurrent arithmetic, and ABI unchanged. The source `reference.npz`
is copied byte-for-byte. It is not a retraining or a lower-precision model.

The selected model's dynamic weight rows allow 11 terms per EVM multiply in
place of 8. Each row stores a signed correction offset `o = -min(row)` and
unsigned weights `u_i = w_i + o`. Every `u_i` is nonnegative. Validated hidden
values `x_i` remain in [-1024, 1024]; shift them to `v_i = x_i + 1024`, in
[0, 2048].

For each 11-element chunk, place `v_i` at bit `23*i` and `u_i` at bit
`23*(10-i)`. Multiplication places the desired dot product coefficient at bits
230 through 252. Extract with `(product >> 230) & 0x7fffff`. Coefficients above
it start at bit 253 and are removed by the mask. EVM multiplication truncates
at bit 256, which cannot affect the desired lower bits.

Every coefficient in this nonnegative polynomial product is at most
`2048 * sum(u_i)` for that chunk. Exhaustively evaluating every chunk of every
dynamic weight row gives a maximum of **8,318,976**, strictly below
`2^23 = 8,388,608`. Therefore no lower coefficient can carry into the desired
coefficient, for **any** valid hidden vector. This is a bound over the entire
allowed hidden-value domain, not just sampled hidden states.

After summing the 35 extracted chunk coefficients, recover the signed row dot
product exactly:

```
dot(w, x) = sumCoefficients - o * sum(x_i + 1024) - 1024 * sum(w_i)
```

The final chunk has 10 real elements and one zero padding element. Both its
packed vector and packed weight use zero for that element. The vector-sum
correction includes only the 384 real elements. Signed division remains at the
same full-row point as before; no rounding is introduced per chunk.

`export_layout.py` checks every recovered packed weight against its source,
the bound for every row/chunk, and 94,248 packed/scalar row comparisons using
zero, both all-extreme vectors, alternating extremes, and four seeded random
vectors. `packing-proof.json` records the results and hashes.

Storage layout per row:

| Offset | Bytes | Meaning |
|---|---:|---|
| 0 | 1120 | 35 packed words, each with 11 lanes |
| 1120 | 32 | Signed sum of all 384 original weights |
| 1152 | 32 | Signed row offset |
| 1184 | 32 | Head bias, only in output-head rows |

Core rows are 1184 bytes and head rows 1216 bytes. All complete data files and
catalogs must be repinned under the new model hash. The packing bound applies
to this exact accepted checkpoint; another model cannot reuse this candidate
without re-running the export and exhaustive bound check. Inference failure
continues to revert the trade, and no contract guard is removed.

These are local experiments, with no mainnet requests or deployments. Gas and
full-output parity are measured separately by the full model benchmark.
