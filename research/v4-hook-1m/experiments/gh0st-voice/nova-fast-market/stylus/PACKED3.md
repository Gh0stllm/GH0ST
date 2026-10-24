# Exact 64-bit packed WASM candidate

This is a separate candidate under `wasm-packed3/`; the raw-weight kernel remains available. It still uses ordinary scalar WASM integer instructions. It does not depend on WASM SIMD support.

Each 64-bit packed weight word contains three signed Q10 coefficients in radix `B = 2^21`. Activations are packed in the reverse order. For one three-element group, the middle product coefficient is exactly the desired dot product. The product is evaluated modulo `2^64`, then rounded at bit 42 and sign-extended from 21 bits:

```
product = weights.wrapping_mul(activations).wrapping_add(1 << 41)
partial_dot = (product << 1) >> 43    // signed arithmetic right shift
```

The absolute value of every polynomial coefficient is at most `1024 × sum(abs(weights in group))`. An exhaustive scan gives **847,872**, below `2^20 = 1,048,576`. The two lower coefficients therefore sum in absolute value to less than half the central radix unit, so rounding extracts the middle coefficient exactly, including negative values. Higher coefficients and overflow beyond 64 bits cannot affect bits 42–62. There are exactly 128 groups of three in every 384-element row; no padding is needed.

`packed3-proof.json` verifies all 4,523,904 dynamic matrix weights through an independent balanced-radix decode and 94,248 row/vector dot comparisons. The same fused token rows, feature weights, biases, activation tables and vocabulary remain unchanged. `packed3-wasm-results.json` verifies 502 model words, including all state values and logits at every word, against the original numerical reference. `packed3-wasm-probe-results.json` adds the 16 extreme/mixed vectors and ten invalid-input rejections.

Local unmetered CPU execution of the 20-word seed-42 sentence took approximately 4.0–4.4 ms, versus 10.4–10.7 ms for the raw kernel. **This does not establish a Stylus gas saving or chain throughput.** The packed representation expands source bytes: the same sentence copies 5,240,806 bytes through 287 code-read calls. A metered execution must include that additional I/O. An independent lossless on-chain compression experiment may reduce bytes while retaining the packed in-memory calculation.

The optional `meter-entrypoint` feature builds a fixed-seed isolated benchmark entrypoint. It rejects nonempty calldata, reentrant context and a missing neural terminal. It returns the 20 token/punctuation identifiers as 80 little-endian bytes. The numerical test exports and virtual fixture addresses remain in that artifact. It is not a production Solidity ABI or a production contract.
