# Independent optimization review

## Scope and status

The review covers optimized arithmetic/data loading and the optional packed-state hook candidate. It does not replace an external audit or prove safety of arbitrary future weight files. All tools used isolated chain 31337; no mainnet requests or deployment were made.

### Arithmetic and general reader: passed

`kernel-audit.mjs` compiles the original and optimized function bodies into separate EVM contracts and compares their complete outputs. The audited candidate (`core/GRU2CoreOptimized.sol`, SHA256 recorded in `kernel-audit.json`) passed 3,097 sigmoid inputs, 1,063 cell vectors, and 9 bounded reader cases. Reader cases include zero length, a 24,000-byte boundary, a 1,024-shard catalog-page boundary, and surrounding memory canaries.

The reader uses scratch memory 0x00..0x1f, does not modify the free-memory pointer or zero slot, and copies only the internally bounded range into preallocated bytes. The sigmoid's final mload includes allocator padding but extracts only the two valid table bytes. Signed cell divisions use `sdiv`, preserving truncation toward zero. Bounds are documented in `PROFILE-AND-BOUNDS.md`.

### SIMD11 format and flat matrix-page access: passed by inspection

The independent `verify-packing.py` decoder compared all 4,523,904 repacked dynamic weights directly against the original SIMD8 byte blobs, including row sums, offsets, head biases, and unchanged suffixes. Fused input data, vocabulary, sigmoid/exponential tables and `reference.npz` remain byte-identical. The 23-bit multiplication proof is valid provided each chunk coefficient is below 2^23. `layout/packing-proof.json` reports an exhaustive maximum 8,318,976 below 8,388,608. Higher coefficients begin at bit253 and are masked out; multiplication truncation above bit255 cannot affect the coefficient at bits230..252. The row correction and final 10-value padding preserve the 384-dimensional exact signed dot product. No quantization or intermediate rounding is introduced.

The flattened matrix-page reader in `dot/simd11-flat.sol` caches the first page only for the four matrix catalog groups. Their fixed byte counts imply fewer than 1,024 shards (largest is the 9,961,472-byte word head, 416 shards), and constructor `_pin` still validates full catalog structure and runtime hashes. Fused embeddings continue to use the general multi-page reader. Runtime code and model identity must be repinned because physical storage changed even though logical parameters did not.

### Packed hook state: tested but NOT SELECTED

`NovaPoolHookPacked.sol` changes only `hiddenState` and `_saveState`. `hook-source-scope.json` verifies all other source bytes remain equal to the original hook after masking those two function bodies. There is no ABI/storage-layout change. Pool binding, all model/output guards, the 2,000,000-gas reserve, 1,500,000 decoder budget, fail-closed trading, state hashes, and events remain unchanged.

`hook-pack-audit.mjs` compares 26 full 768-element states, including int16 extrema, model extrema, alternating signs, and 20 deterministic random states. It verifies 19,968 returned values, 1,248 exact raw storage words, three mapping IDs, adjacent sentinel slots, and preservation of other IDs. Packing is a mask of each int16 followed by a disjoint 16-bit shift; unpacking sign-extends that field. This establishes the same representation for the complete int16 domain by direct bitwise reasoning, with boundary/random EVM tests supporting it.

Standalone harness savings were 182,438 gas for save and 172,934 for load. Full transaction receipts must determine production-relevant savings.

## Selected integration scope

The selected candidate is the flat SIMD11 model with the original `nova-pool/contracts/NovaPoolHook.sol` unchanged. The independently tested `audit/NovaPoolHookPacked.sol` is an unselected future candidate; it must not be represented as part of the selected runtime or its gas result. Keeping the original hook preserves every hook source byte, including the original callback reserve, decoder checks and memory packing. The final integration report passes 64 checks and 32 recorded real-model buys/sells; its final real-model sequence is 37 after ancillary successful cases. The separate load run passes all 44 swaps, with 16 pending at once and up to two swaps in one 32M block. Every load word is nonempty and sequences are exactly 1 through 44. Maximum load gas is 15,174,932; mean is 14,333,315. The model cap is 13.3M, submitted transaction gas limit is 17.5M, and the original 2M callback reserve remains intact. `selected-final-audit.json` independently checks these counts and binds the receipt reports to the selected source hashes.

## Gas reserve and block packing

Do not reduce the reserve or drop validation to accommodate a declared gas limit. The 14M model cap plus existing reserve requires 16,222,222 gas at hook entry, before considering nested EIP-150 forwarding from the router. This can reject an otherwise cheaper transaction before inference.

A transaction's declared gas limit need not equal its consumed gas. Two transactions with declared limits over16M can fit a 32M block if the first transaction's consumed gas leaves enough remaining for the second declared limit. Conversely, two low measured costs do not prove block packing without the pending-transaction test.

The first successful word writes 48 nonzero storage slots from zero and costs more than later updates. Report first-swap and steady-state results separately. The selected local integration suite and same-block receipt checks have passed. Exact model-byte and packing checks are documented above; any further deployment or external audit remains a separate decision.
