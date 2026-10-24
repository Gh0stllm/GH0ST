# Lossless physical storage with packed-three WASM compute

This optional local candidate preserves all quantized Q10 values. It compresses physical matrix rows and decodes them directly into the independently tested three-lane signed21 compute representation. It does not reduce model size, precision or weights.

## Verified result

- 4,532,229 matrix/bias values decode exactly; remaining fused inputs, word-punctuation values, tables and vocabulary are retained unchanged.
- All 502 neural word steps match the existing reference: tokens, punctuation, all 768 hidden values and all 197 logits.
- 17 malformed-format and host-copy cases reject or pass as expected.
- For the same 20-word sentence, the module reads **2,254,777 bytes**, versus 3,994,342 bytes in the raw-int16 WASM: **43.55% fewer bytes**.
- That sentence performs 187 host-code reads touching 96 distinct virtual shards.
- Unmetered local CPU execution is about 6.6–7.1 ms with specialized decoding, slower than the approximately 3.85 ms compute-packed3 module without physical compression. Only real host/instruction metering can determine the overall gas tradeoff.

No Stylus gas, chain TPS, activation or deployment claim follows from these results. Catalog/code-hash binding and production ABI/pool state remain outside this local kernel.

## Physical layout

All multibyte header integers are little-endian. A row stores signed i16 `minimum`, u8 `bits`, optional signed i32 bias, then 384 unsigned `(value - minimum)` deltas in a little-bit-order stream. Payload size is exactly `48 * bits` bytes. Actual model rows use only 7, 8 or 9 bits.

- `core.bin`: `N0C1`, u32 row count 3456, u32 auxiliary length 16128, u32 reserved zero; 3456 rows without biases; unchanged big-endian feature/bias auxiliary bytes.
- `groups.bin`, `punct.bin`: `N0H1`, u32 row count; rows with i32 biases.
- `words.bin`: `N0W1`, u32 group count 128, u32 rows/group 64, u32 reserved zero; 129 u32 absolute file offsets; 128 groups of 64 biased rows. The first offset is 532 and the final offset equals the file length.

| File | Raw int16 bytes | Compute-packed3 bytes | Physical-packed bytes |
| --- | ---: | ---: | ---: |
| Core | 2,670,336 | 3,555,072 | 1,434,016 |
| Group heads | 98,816 | 131,584 | 45,928 |
| Word heads | 6,324,224 | 8,421,376 | 3,073,668 |
| Punctuation heads | 3,860 | 5,140 | 1,963 |

## Decoder bounds

A 24,000-byte streaming buffer is shared across sequential decode operations. Rows crossing a buffer boundary use a bounded 768-byte scratch array. The common 7/8/9-bit row paths read each delta directly; generic 0–16-bit rows use bounded bit extraction.

The decoder checks magic, row counts, auxiliary size, reserved flags, row bit width, int16 ranges, final stream position and strictly increasing in-range word-group offsets. Every decoded triple additionally checks `abs(w0)+abs(w1)+abs(w2) < 1024`, preserving the signed21 coefficient bound for hidden values in [-1024,1024]. No extra uncompressed whole-file temporary buffer is allocated.

A valid format is not proof of the model's identity. The production wrapper must bind these exact compressed bytes to immutable authenticated catalogs/code hashes.

## Artifacts and reproduction

- `SUMMARY.json`: source/module hashes and measured byte/call counts.
- `packing-proof.json`: exact decode comparison and per-row bit histograms.
- `wasm-results.json`: full 502-word reference parity.
- `malformed-results.json`: rejection tests.
- `wasm-generic-results.json`: initial slower generic decoder measurements.
- `wasm/src/lib.rs`: complete optional Rust variant.
- `wasm/target-meter/wasm32-unknown-unknown/release/nova_wasm_delta_packed3.wasm`: feature-gated fixed diagnostic entrypoint for separate meter evaluation.

Generation order is `export.py`, `build-loader.py`, then `optimize-loader.py`. Build the local Rust project for `wasm32-unknown-unknown`, then run `benchmark.mjs` and `test-malformed.mjs`. The source borrows the baseline compute kernel from `../../stylus/wasm-packed3` but writes only within this directory.
