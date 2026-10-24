# Exact hidden-state packing review

This is a local-only candidate. The final integration harness must still test the selected model, hook, vault and router together. No mainnet transaction or deployment is authorized by this work.

The original pool hook saves 768 signed values in 48 storage words. The candidate `NovaPoolHook12.sol` saves exactly the same values in 37 words: 36 words hold 21 values each, and the last holds 12 values. Twelve bits are enough for every permitted neural value from -1024 through 1024; this changes physical storage, not model precision. The public `hiddenState(bytes32)` result remains `int16[768]` with normal signed ABI encoding.

The outer slot loop remains bounded. The inner packing and unpacking operations are unrolled with constant offsets. On reading, a 12-bit two's-complement value is moved to the high end of an EVM word and arithmetic-shifted back, which restores its signed 256-bit memory representation. On writing, the low 12 bits of each previously validated value are stored. Zero-filled storage still decodes to a zero initial state.

The final partial slot writes only output cells 756 through 767. It reads exactly those same twelve inputs on save. All higher unused bits in that slot are zeroed. Scratch writes use memory 0 through 63; the free-memory pointer at 64 and the zero slot at 96 are untouched. The returned state array is allocated by Solidity before assembly writes to its fixed 24,576-byte region.

All source outside `hiddenState`, `_saveState`, and the internal mapping's array size is byte-for-byte identical to the original hook. In particular, the constructor's chain restriction, exact pool/caller binding, model hash/code hash, sequence bound, 2M callback reserve, bounded static call and return-copy length, bounded external decoder, canonical ABI check, all numeric limits, vocabulary and text checks, state hash, and event behavior are unchanged. The state save is only reachable after successful decoding and validation. EVM transaction rollback still covers the entire swap and storage update.

`hook-state-test.mjs` compares baseline, an unrolled 16-bit control, and the 12-bit candidate on an unforked local chain. It covers all 2,049 allowed integer values, 29 state arrays, both range endpoints, alternating signs, 20 deterministic random arrays, three mapping IDs, untouched other IDs, zero uninitialized state, and sentinel storage on both sides of the mapping. It checks every stored packed word independently. The test's external save wrapper rejects values outside the allowed neural range; this mirrors the unchanged production decoder and is not a new production path. The candidate is not intended to retain arbitrary int16 values outside the accepted neural domain.

The selected candidate's typical isolated load and save savings total approximately 523,000 gas versus the original Solidity loops. This is only a microbenchmark delta. Actual complete-swap gas and the security status must come from integration receipts. It does not establish ten swaps per second.

This representation requires a fresh hook deployment if it is ever approved. It is not an in-place migration of an existing hook's storage. The present task does not deploy it.
