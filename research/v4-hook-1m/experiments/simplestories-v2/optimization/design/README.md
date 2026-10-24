# Exact packing design for the SimpleStories V2 gas experiment

This optimization preserves all 1,235,968 parameters and every operation of the existing Q12 reference. It changes the encoding of matrix weights and computes several integer products in one EVM multiplication. It does not prune vocabulary, layers, neurons, or prompt tokens. This remains exact relative to the existing quantized implementation, not to FP32.

## Five-lane general path

Use radix `B = 2^51`, weight bias `W = 2^15`, and activation bias `X = 2^31`. For five signed int16 weights and five signed int32 activations, encode:

```
A = sum((weight[i] + W) * B^i, i = 0..4)
C = sum((input[4-i] + X) * B^i, i = 0..4)
```

The coefficient of `B^4` in `A*C` is the sum of five corresponding biased products. Every convolution coefficient contains at most five products. The bound `5 * 65535 * (2^32 - 1) < B` prevents carries between any adjacent coefficients. That coefficient occupies bits 204 through 254, so EVM multiplication modulo `2^256` retains all of it.

For a row padded to `N` columns with actual zero weights and zero inputs, sum the extracted coefficients across groups, then recover the original signed dot product:

```
dot = sum(coefficients) - W*sum(original inputs)
      - X*sum(original weights) - N*W*X
```

The appended row-sum word is the sum of the original signed weights, including zero padding. The dot is divided by 4096 with the original truncate-toward-zero rule, then checked against the original int32 output range.

## Eight-lane fast path with exact fallback

Every actual matrix weight in this checkpoint fits signed 12 bits; the observed maximum absolute value is 1674. Use radix `B = 2^32`, weight bias `W = 2048`, activation bias `X = 65536`, and eight lanes. The carry bound is `8 * 4095 * 131071 < B`. The coefficient of `B^7` occupies bits 224 through 255.

This fast path is valid only when each input is between -65,536 and 65,535 inclusive. The implementation checks every input before using it. A value outside that range selects an exact scalar fallback that decodes the same stored 12-bit weights and multiplies the full signed int32 input. No clipping or truncation is permitted to make an input fit the fast path.

The root profiling run found all linear inputs in range for its 195-prompt corpus, including random contexts up to the supported 16 tokens. This is observed coverage, not a proof that every possible prompt takes the fast path. Fallback preserves the original numerical result when coverage fails; its gas cost can be higher.

## Export and proof files

- `export_swar.py`: offline exporter, default five lanes; `--lanes 8` produces the separate eight-lane model.
- `packing-proof.json`: full signed-int32 five-lane tests plus bounded eight-lane tests.
- `packing-proof-swar8.json`: eight-lane export checks.
- `../kernel/model/packed_offsets.json`: five-lane tensor and layer offsets.
- `../kernel8/model/packed_offsets.json`: eight-lane tensor and layer offsets.

The exports recover every original matrix value exactly. All 8,795 actual matrix rows also pass a randomized dot-product comparison at the complete activation range supported by their packed arithmetic. Another 1,792 deterministic cases include padded lengths, negative values, signed extrema, and EVM's 256-bit multiplication truncation. Independent end-to-end hidden-state and full-vocabulary parity belongs in the local EVM benchmark; arithmetic tests alone do not establish integration correctness.

The five-lane representation uses 9,334,560 bytes and the eight-lane representation uses 6,258,016 bytes. Raw input embeddings remain available separately; tied output embeddings are duplicated only as a storage encoding. Model parameter count is unchanged. Shard deployment gas and persistent storage costs must be reported separately from inference gas.

## Context and repeated generation

Matrix packing reduces arithmetic cost but does not remove the cost of processing a complete prompt. The current stateless generation loop also recomputes all prior tokens for every new output. A future persistent key/value cache could preserve exact causal-transformer results and process just one appended token per swap. It would require explicit session/context state, cache invalidation, and storage-gas measurement. It would not make the initial prompt prefill free, and it would change the hook interface and sequencing. No such cache should be claimed by the packing benchmark.

All experiments use isolated local execution. No mainnet access or transaction is needed by the exporter or proof scripts.
