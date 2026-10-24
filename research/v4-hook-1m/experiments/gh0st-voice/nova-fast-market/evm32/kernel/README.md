# Exact Solidity evaluator improvement for the 32M experiment

Local execution only. No public RPC, broadcast, or deployment. `combined.sol` retains the exact 8,175,493-parameter Q10 N0VA model, selected data catalogs, sampling and output ABI. It is a direct-inference optimization; it does not prove that a particular full swap fits 32M gas.

## Changes

- Replace eight fixed accumulation groups per packed dot with seven statically proven groups for core matrices and six for output heads. There are still 39 exact packed multiplies; only intermediate coefficient extractions are reduced.
- Use sequential accumulator expressions to reduce temporary-stack overhead.
- Evaluate the same inclusive hidden-state and feature limits with bounded assembly loops. Invalid values still revert `InvalidInput`; parameter and decoder checks are unchanged.

The new accumulation schedules are safe only for these exact pinned data. All weights were independently decoded from the selected binary files and matched with `reference.npz`. For every group, the sum of shifted weights multiplied by 2048 remains strictly below 2^25; therefore lower coefficients cannot carry into the central dot coefficient for any allowed hidden state. The measured maxima are 33,077,248 for the core and 33,431,552 for word heads, below 33,554,432. No quantization, pruning, output caching or zero-state-only shortcut is used.

## Results

`combined-results.json` records 31 full ABI parity cases, including extremes, random states, first/last output groups, all temperature bounds, and 8 consecutive model steps carrying nonzero hidden state. All 768 hidden values, 197 scores, token, punctuation, text and terminal flag match byte for byte. A further 1,554 invalid-input cases reject with the same revert bytes as the baseline: both out-of-range values at every 768 hidden slot, every feature slot, and invalid token/punctuation/temperature values.

Direct transaction gas is 8,926,644–9,230,498, mean 9,062,807.68. Each measured input saves 200,693 gas (mean 2.1665%) over the previous exact evaluator. Runtime is 17,179 bytes. The constructor remains restricted to local chain 31337; the original modelHash domain is retained as the unchanged data-layout identity, while the source hash identifies the evaluator change.

`packing-proof.json` contains 70,686 independent scalar dot comparisons and 4,523,904 weight comparisons. These are implementation checks, not an external security audit.

## Reproduce

From the `nova-fast-market` folder, with the repository's existing Node dependencies:

```sh
NOVA_VARIANT_EXPORT=../../selected node evm32/kernel/benchmark.mjs combined --full --ongoing --invalid
python evm32/kernel/prove-packing.py
```

The Python verifier requires NumPy, already present in `experiments/gpt2/.venv`. Test data is installed with local `hardhat_setCode`, not deployed to a network. Other sources record preliminary dot-expression comparisons; `combined.sol` is selected. `validation.sol` alone was not benchmarked successfully; the combined implementation is fully tested.
