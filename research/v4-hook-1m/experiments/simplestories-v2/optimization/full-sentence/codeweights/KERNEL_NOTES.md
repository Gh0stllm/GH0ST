# Executable weight tiles

These local-only kernels compile the same Q12 matrix coefficients into EVM `PUSH` constants. They retain every matrix row and every output vocabulary entry. They are an execution-format change, not retraining, pruning, or a replacement model.

The exporter reads the lossless eight-lane representation in `optimization/kernel8/model/weights.bin`, verifies its SHA-256, and emits 282 runtime contracts covering all 8,795 matrix rows. Total runtime size is 6,413,507 bytes. Each individual runtime is at most 24,000 bytes. The model still needs raw embeddings, normalization weights and lookup tables; current integration also retains the packed data for the exact fallback path. Deployment/storage cost increases and is not part of the swap-gas measurement.

## Runtime interface

Tiles use raw calldata, without a function selector or ABI array header:

- `groups` packed input words, in the same ordering as the SWAR8 implementation;
- one signed `commonCorrection` word: `2048 * sum(actualInputs) + paddedColumns * 2^27`.

The length is exactly 544 bytes for 128 columns or 1,408 bytes for 341 columns. A tile rejects any other length. It returns exactly `row_count * 32` bytes of signed, sign-extended Q12 outputs without an ABI header.

For every row, the code evaluates:

```
raw = sum((packedWeight[group] * packedInput[group] >> 224) mod 2^32)
output = truncTowardZero((raw - commonCorrection - originalWeightRowSum * 65536) / 4096)
```

Every multiply is the EVM's modulo-2^256 multiply. The desired middle convolution coefficient remains fully inside the word. With eight unsigned 12-bit biased weights and unsigned 17-bit biased inputs, `8 * 4095 * 131071 < 2^32`, so lower coefficients cannot carry into it.

The parent model must check that every fast-path input is in `[-65536, 65535]`. All original matrix weights were verified in `[-2048, 2047]`. Therefore any returned row magnitude is bounded above by `341 * 2048 * 65536 / 4096 = 11,173,888`, safely inside int32. The tile need not repeat this proof as a per-row range check. Inputs outside the fast-path range must use the exact fallback, not be truncated.

`SUB` and `SDIV` operand order is handled explicitly by `SWAP1`. The standalone tests include positive, negative, alternating, zero and random inputs and compare every returned row against the original integer dot product, including division toward zero.

## Identity and verification

`tile-manifest.json` lists every runtime path, byte length, SHA-256, Keccak-256, covered matrix offset and row range. Its code commitment folds all runtime hashes in index order using `keccak256(abi.encode(previousCommitment, codeHash))`.

Initial independent local EVM validation covers four representative tiles, both supported matrix widths, five signed input patterns and incorrect-length rejection: 20 exact row-vector tests passed. Representative execution-only costs were 14,500 gas for 36 rows of width 128 and 13,325 gas for 13 rows of width 341. These are kernel microbenchmarks, not complete swap costs; full-model and PoolManager measurements must include calls, cold account access, all layers, vocabulary selection and settlement.

No public-chain RPC, key, signing or deployment is used by the exporter or tests.
