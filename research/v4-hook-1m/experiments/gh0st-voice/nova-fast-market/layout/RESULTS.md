# Exact N0VA packing experiment — local only

The accepted checkpoint remains `904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3` (8,175,493 learned parameters). No retraining, pruning, lower precision, output caching, or inference-policy changes were made. All runtimes are restricted to local chain 31337. These are direct inference benchmarks with read-only data installed using local `hardhat_setCode`, not mainnet throughput or deployment tests.

## Selected representation

`b25x10a5` packs 10 shifted Q10 weights into each 250-bit word. It uses 39 words per row and accumulates up to five products before extracting the central 25-bit coefficient. The old SIMD11 representation needed 35 separate extractions per row. This candidate needs eight. It retains the exact row-minimum and weight-sum correction.

| Vector | Previous selected model | Selected packing | Saving |
| --- | ---: | ---: | ---: |
| zero | 12,610,619 | 12,012,837 | 597,782 |
| bounds | 12,750,898 | 12,153,116 | 597,782 |
| mixed | 12,813,385 | 12,218,084 | 595,301 |

All complete ABI return bytes are identical across these three test vectors: token, punctuation, all 768 hidden values, all 197 logits, text, and sentence-end flag. The selected source runtime is 16,669 bytes; deployed code remains below EIP-170's size limit. Final integration with other optimizations must be measured separately.

### Exactness bound

Let `B = 2^25`, `x_i = hidden_i + 1024` in `[0,2048]`, and `w_i = Q10_weight_i - minimum_row_weight >= 0`. Within a chunk, weights are packed in descending powers of B and values in ascending powers. The coefficient of `B^9` in their product is the desired ten-element shifted dot product.

For up to five chunk products, **every coefficient up to and including the central coefficient** is bounded by `2048 * sum(all shifted weights in those chunks)`. Exhaustively scanning all rows gives a maximum of **29,218,816**, strictly below **33,554,432 = B**. Thus no lower coefficient can carry into the central one, even when all validated hidden values reach their inclusive extremes. Reducing multiplication and additions modulo `2^256` cannot affect this central coefficient, whose bits occupy positions 225–249. Unwanted higher coefficients and overflow are discarded. Padding weights and vector digits are zero; correction sums include only the original 384 entries.

The independent byte decoder compares **4,523,904 dynamic weights** directly with the original SIMD8 export, checks offsets, sums, head biases, padding, suffixes, and unchanged static tables. It imports neither the exporter nor the neural-training code. It passes. Separately, six vectors across all 11,781 rows give **70,686 exact scalar-dot comparisons**.

Evidence: `unsigned-independent-audit.json`, `b25x10a5/proof.json`, and `benchmark-b24x10a2-b25x10a5-b26x9a13-b27x9a28-b28x9a43.json`.

## Other candidates

Five unsigned layouts and four centered signed-radix layouts were measured. Wider lanes permit fewer extraction operations, but the extra weight bytes and reads erase their arithmetic savings. Centered signed packing was independently decoded and its lower-digit rounding bound verified, but its best measured implementation was about 54,000 gas slower than `b25x10a5`; it is not selected. These experiments remain for reproducibility, not production deployment.

| Representation | Zero-vector gas |
| --- | ---: |
| unsigned 24-bit / 10 lanes / accumulate 2 | 12,472,624 |
| **unsigned 25-bit / 10 lanes / accumulate 5** | **12,012,837** |
| unsigned 26-bit / 9 lanes / accumulate 13 | 12,628,479 |
| unsigned 27-bit / 9 lanes / accumulate 28 | 12,671,961 |
| unsigned 28-bit / 9 lanes / accumulate 43 | 12,617,934 |
| signed 23-bit / 11 lanes / accumulate 3 | 12,319,802 |
| signed 24-bit / 10 lanes / accumulate 8 | 12,157,164 |
| signed 25-bit / 10 lanes / accumulate 19 | 12,067,000 |
| signed 26-bit / 9 lanes / accumulate 43 | 12,439,242 |

The direct benchmark does not change pool security. Full pool integration, realistic queue capacity, model-hash binding and adversarial hook tests belong to the final combined candidate.
