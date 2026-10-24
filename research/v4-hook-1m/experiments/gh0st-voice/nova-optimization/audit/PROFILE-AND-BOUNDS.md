# Independent baseline gas profile and arithmetic bounds

Status: local-only analysis. No public RPC, transactions, or deployment.

## Baseline phase profile

`profile.mjs` injects the accepted `grammar4m` runtime data into an unforked local Hardhat chain (31337), compiles an instrumented copy of the original model, and calls it with the BOS token, zero hidden state, seed 42, temperature 512, and features `[0,0,0,0,1024,1024]`. Output is `the`.

The instrumentation changes compiler layout, so these are directional measurements, not production transaction gas guarantees. The measured body consumes 20,645,945 gas:

| Phase | Gas |
|---|---:|
| Input validation, static input tables | 251,547 |
| Packing both previous hidden states | 106,975 |
| First GRU layer | 7,559,911 |
| Packing new first hidden state | 52,353 |
| Second GRU layer | 11,512,946 |
| Packing output hidden state | 54,667 |
| Group head | 594,785 |
| Word and punctuation heads, intermediate sampling | 495,120 |
| Punctuation sampling and text formatting | 17,641 |

The two GRU loops consume 92.38% of this instrumented body. The model executes 3,456 core dot rows plus 197 head rows per word. Each baseline dot repeatedly resolves a two-level catalog and copies a small row into memory. Optimizing exact dot execution and repeated catalog resolution is the main opportunity. Removing token, LP, callback, return-shape, or output-validation protections cannot address the dominant cost and is not recommended.

## Exact cell arithmetic bounds

Inputs are range checked before inference: hidden values are in `[-1024,1024]`; six features are in `[-4096,4096]`. Original core weights are signed int16, and fused input values are signed int40.

Conservative representation-wide bounds:

- `abs(coreDot) <= 384 * 32768 * 1024 = 12,884,901,888`.
- `abs(featureDot) <= 6 * 32768 * 4096 = 805,306,368`.
- The two fused int40 values plus feature dot fit below 2^41 in magnitude.
- The accepted sigmoid table contains deltas in `[0,32768]`. Its exact lookup, sign branch, rounding by adding 32, and division by 64 give reset/update gates in `[0,1024]`.
- `n = 2 * sigmoid(2 * (xn + r * rn / 1024)) - 1024` is in `[-1024,1024]`.
- For `old,n` in `[-1024,1024]` and `z` in `[0,1024]`, `z*old + (1024-z)*n` is in `[-1,048,576,1,048,576]`. Dividing by 1024 preserves the next-state range.

All arithmetic is far below signed 256-bit overflow. An assembly replacement must use `sdiv` for signed intermediate divisions to retain Solidity's truncation toward zero. Replacing signed division with arithmetic right shift would change negative results.

Actual accepted data tighter bounds (independently decoded from the static blobs):

- Core weights: minimum -247, maximum 280.
- Maximum core row L1 weight sum: 29,421.
- Maximum absolute raw core dot under valid hidden input: 30,127,104.
- Maximum absolute fused signed-int40 value: 4,037,250.
- Maximum absolute punctuation-fold signed-int40 value: 2,234,865.

## Security invariants for optimized candidate

1. Same logical quantized weights, biases, lookup tables, vocabulary, and sampling. Any physical weight repacking must prove exact reconstruction for all weights.
2. Keep validation of previous token, punctuation, temperature, hidden states, and features.
3. Keep constructor catalog size/hash commitments. Assembly reads must operate on ranges that are bounded by internal row and token indices and allocated buffers.
4. Preserve the hook's caller/pool binding, pinned runtime/model hash, sequence overflow check, gas reserve, bounded static call, exact return-size/canonical ABI validation, output ranges, vocabulary/text check, state hash, and rollback behavior.
5. Keep token fixed supply, permanent LP custody, router reentrancy lock, exact input/full-fill checks, deadline, slippage, and settlement checks.
6. Do not infer a per-block capacity claim from transaction gas alone. Submit multiple transactions before mining a 32M local block and verify receipts, block gas, consecutive word sequence, and balances.
