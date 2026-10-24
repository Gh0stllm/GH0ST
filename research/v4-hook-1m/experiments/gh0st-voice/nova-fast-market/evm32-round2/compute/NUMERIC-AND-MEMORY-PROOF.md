# Exact compute changes

All candidates use the same Q10 checkpoint and data catalogs as the checked batch baseline. No value is quantized again, clipped differently, pruned, or rounded differently. The original input checks remain intact.

## Feature contribution reuse

The six input features do not change within a batch. Each of 1,152 gate-input rows contains six signed int16 weights. Their sum is computed once as `sum(weight[i] * feature[i])`, then used before the same signed division by 1,024 as the baseline.

For every permitted input, the absolute sum is at most `6 * 32768 * 4096 = 805306368`, which fits signed 31 bits and therefore also fits the signed 40-bit scratch representation without loss. The scratch buffer allocates 5,792 bytes. The last 32-byte store begins at byte 5,755 and ends at byte 5,787, inside the allocation. Subsequent reads sign-extend the exact stored low 40 bits. No division occurs during precomputation.

## Head shard reuse

After the GRU finishes, the output heads reuse the first core scratch-cache slot. It is 25,376 bytes: a 32-byte tag, 24,000-byte shard, and 1,344 bytes of boundary space. A head row has stride 1,344, so the full copied row and 32-byte bias read fit in that slot, including rows crossing a shard boundary. The remaining five core cache slots are unaffected.

The cache tag is cleared at every catalog transition and on re-entering the GRU. Equal shard indices in different catalogs cannot be mistaken for equal contents. This reset is required: an initial deliberately tested prototype without the GRU reset failed second-word complete-output parity and was rejected.

## Unrolled head packing

The head's 384-element vector is packed into exactly the same 39 256-bit integers as before: 38 full ten-lane groups plus four remaining elements. Only the loop structure changes.

## Separate zero-state shortcut

The selected candidate ORs together every original signed value in each initial recurrent state vector once per batch. This result is zero if and only if every original element is zero. Only in that case may all recurrent matrix products for that vector be set to zero in the first step. A nonzero vector never uses this shortcut, even when its arithmetic sum is zero. Alternating positive/negative boundary vectors test that distinction. The flags are cleared before the first GRU computation, so every later step conservatively uses the complete recurrent calculation.

The shortcut does not skip input contributions, the second layer's input matrix, biases, gates, sampling, or any validation. It is reported separately because its principal saving applies to initial or otherwise exactly zero states, not typical continuing story state. Earlier candidates tracked zero values during every packing pass; the selected version detects zero once to avoid repeating that work.

## Validation

The benchmark compares every byte of the full batch return value with the baseline: token IDs, punctuation, all 768 hidden values per step, all 197 scores per step, all text, count, terminal flag, and unused slots. It also compares reverts for invalid token, punctuation, temperature, feature, hidden-state and batch bounds and word-index overflow.

The benchmark is unforked Hardhat on local chain 31337, with injected immutable model-data code and a 32M block/transaction gas limit. It neither contacts nor broadcasts to a public chain. These measurements are direct model calls, not full swaps or deployment-cost estimates.
