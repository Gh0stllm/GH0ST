# N0VA exact arithmetic runtime kernels

This is local research. No public-network deployment or transaction was performed by these scripts. The benchmark injects the already validated model data into an unforked Hardhat chain to measure inference, not deployment cost.

## Selected kernel

`assembly-b25x10a5.sol` uses the original 8,175,493-parameter N0VA checkpoint, the same Q10 values, and the exact derived data from `../layout/b25x10a5`. It preserves every result byte in the 23-input comparison with the prior selected model. This includes the generated token, punctuation, all 768 next-state values, all 197 scores, text and terminal flag.

The selected source SHA-256 is `e7185cadb3feda3f8cffa01bdd1b6945ed911761603f8cae0668195c8fde0835`.

| Measure | Prior selected | This kernel |
| --- | ---: | ---: |
| Mean direct inference gas, same 23 inputs | 12,725,376 | 9,257,636 |
| Minimum direct inference gas | 12,580,932 | 9,127,337 |
| Maximum direct inference gas | 12,894,626 | 9,431,191 |
| Runtime bytecode bytes | 18,127 | 17,273 |
| Initcode bytes, excluding constructor ABI data | 20,511 | 19,669 |

The mean gas reduction is **27.25%**. These are direct model calls, not whole-swap gas figures. They do not establish 10 swaps per second or full sentences under a 32M transaction limit.

## Changes

- The two GRU layers run in one bounded assembly routine, with identical signed division and rounding order.
- Six bounded memory caches retain one 24,000-byte immutable data shard per matrix stream. Each cache occupies 25,376 bytes, including its metadata and enough room for a row crossing a shard boundary. Total cache allocation is 152,256 bytes.
- Fixed feature and vector preparation loops are unrolled.
- Sigmoid output rounding is precomputed into a two-sided lookup table. This expands a deterministic table, not a learned parameter set.
- Sampling uses the same maximum, temperature, exponent lookup, entropy and cumulative selection in bounded assembly.
- The layout agent's 25-bit, ten-lane packing accumulates five products before extracting the desired coefficient. The separate layout proof establishes exact decoding and carry bounds.

The public input guard prefix is byte-identical to the prior source. Model/catalog pinning, vocabulary validation, local chain restriction and external ABI are retained. No hook or token security restriction is removed here.

## Evidence

- `RESULTS.json`: compact selected result and source hash.
- `assembly-b25x10a5-results.json`: all 23 inputs, exact complete-return hashes and gas measurements.
- `kernel-checks.json`: 65,545 integer-domain sigmoid comparisons in the local EVM, an equivalent 65,545 reference comparisons, and 200 sampler scenarios.
- `../layout/b25x10a5/proof.json`: independent layout proof, decoded weights and carry bounds.
- `assembly-unrolled-results.json`: the 23-input intermediate runtime without the new data layout.

The inputs cover zero, alternating extrema, mixed states, all-positive and all-negative states, sparse states, feature extrema, temperatures 64 through 4096, multiple previous tokens and punctuation values, and forced word-head endpoints 0, 63, 8128 and 8191.

The sigmoid test exhausts every integer in [-32768, 32768], plus eight distant values. For every larger magnitude, both algorithms clamp to the same endpoint, so this covers the complete non-saturated domain. The sampling scenarios include ties, positive/negative score extrema, temperature endpoints and entropy zero/uint256 maximum.

## Reproduce

Run from `research/v4-hook-1m` with the installed Node runtime:

```sh
NOVA_VARIANT_EXPORT=../layout/b25x10a5 node experiments/gh0st-voice/nova-fast-market/kernels/benchmark.mjs assembly-b25x10a5 --full
node experiments/gh0st-voice/nova-fast-market/kernels/check-kernels.mjs assembly-b25x10a5.sol
```

`benchmark.mjs` rejects runtimes above 24,576 bytes and initcode above 49,152 bytes. It verifies every data file against its export manifest and enforces local chain ID 31337 before sending local transactions.

## Rejected merge experiments

Two initial layout merges failed the first complete-return comparison: one accidentally changed a coefficient byte offset while substituting a matrix stride; the other omitted the changed punctuation-bias offset. Their sources and failed reports are preserved under `failed-b25x10a5-*` with matching source hashes. Neither is selected. The corrected selected source passes every complete-return and arithmetic test above.

## Additional optimization experiments

Compiler optimizer runs 1,000 and 10,000 preserve full return bytes on three test inputs and remain below bytecode limits. They save only approximately 14,100 and 23,900 gas per word respectively while adding 503 and 864 runtime bytes. The selected 23-case and arithmetic evidence uses optimizer runs 200.

`assembly-triple.sol` groups the GRU's reset/update/candidate dot products to share vector reads. Although its three complete-return comparisons pass, stack pressure makes it approximately 324,000 gas slower than the selected model. It is not selected. Reports are retained for these experiments.
