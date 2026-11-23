# M-P1 Q5 linear kernels on Robinhood

These Solidity kernels evaluate exact integer dot products from the pinned five-bit model pack. Both preserve signed Q16.16 activation inputs and take weight groups from immutable bytecode through `EXTCODECOPY`. The dot product returns one signed int64 for each output feature and token, before the Q24 group scales have been applied.

`Mp1Q5Linear` supports full-range signed int32 activations. `Mp1Q5Linear24` uses eight terms per packed multiplication for 192-feature groups and validates that each input fits signed 24 bits. The fast path is algebraically identical within that range. A wider input reverts on the fast path and can use the full-range kernel. Both accept a byte stride between weight rows, so each 192-feature group of FC2 can reuse the same raw-operator interface.

`Mp1Q5Projection` converts the original binary16 scales to Q24 exactly and rounds the original Float32 bias to Q16.16 with ties to even. It adds integer products across all groups before a single signed truncation and bias addition. Its current implementation verifies the execution interface by calling a selectable raw kernel. A production registry must pin kernel addresses and data-contract code hashes.

## Evidence

The public Robinhood RPC ran these contracts in temporary call state, with exact original packed bytes from the first QKV matrix. An independent scalar oracle checked every raw result. The scaled tests also matched authentic first-forward fixed-point reference outputs for QKV and the four-group FC2 on the prompt “blue crystal” with seed 24680.

| Kernel | Tokens × outputs × inputs | Verified gas estimate |
| --- | --- | ---: |
| Full-range | 32 × 128 × 192 | 26,682,547 |
| Signed-24 | 32 × 128 × 192 | 8,108,045 |
| Signed-24 | 32 × 256 × 192 | 15,672,683 |
| Signed-24 | 13 × 256 × 192 | 7,353,843 |

Raw tests include synthetic boundary activations for the supported width. The signed-24 test also proves that an unsupported activation reverts. The fixed projection checks use authentic input values and scale/bias bytes, but only small output counts. The gas numbers are operator measurements and do not measure attention, durable intermediate state, or a complete image.

## Reproduce

Run with Solidity 0.8.30 and ethers 6, with the reference fixture available and the pinned Q5 package extracted to a local directory.

```sh
node benchmark.cjs /absolute/path/to/q5 robinhood-linear-gas.json
MP1_PACKED_24=1 node benchmark.cjs /absolute/path/to/q5 robinhood-linear24-gas.json
```

The runner accepts only read-only methods, checks both chain identity and genesis, selects empty state-override addresses, pins the input artifacts, and confirms the anchored block hash. It reports RPC transaction estimates separately from the measured gas inside each operator.
