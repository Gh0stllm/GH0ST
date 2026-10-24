# GH0ST N0VA-8M: two swaps per 32M block

**Completed local experiment. No mainnet calls, signing or deployment.**

The selected candidate processes two full ETH/N0VA swaps in one locally enforced 32,000,000-gas block. Each successful swap produces one neural word and commits the next shared recurrent state. The original 8,175,493 model parameters, Q10 values, vocabulary, sampling and punctuation rules are unchanged. This is an execution optimization, not retraining or a quality upgrade.

## Measured result

| Metric | Previous pool candidate | Selected optimization |
| --- | ---: | ---: |
| Queued swaps tested | 44 | 44 |
| Successful / failed | 44 / 0 | 44 / 0 |
| Largest pending batch | 16 | 16 |
| Observed swaps per 32M block | 1 | 2 |
| Mean complete swap gas | 22,743,274 | 14,333,315 |
| Minimum complete swap gas | 22,705,038 | 14,295,948 |
| Maximum complete swap gas | 23,581,964 | 15,174,932 |

Mean gas fell **36.98%**. The first word costs more because it initializes persistent neural storage. In the selected load run, the first four buys used three blocks; the subsequent eight buys, sixteen buys and sixteen sells used four, eight and eight blocks respectively. All 44 emitted nonempty words with consecutive sequence numbers. Queued users share sequential execution, not parallel model instances.

Direct model comparisons used **12,580,932–12,894,626 gas** across 23 cases and matched every return byte against the original model: token, punctuation, text, all 768 state values, all 197 scores and terminal flag. Tests include state and feature bounds, temperatures, sequence limits, all punctuation classes and forced first/last words in the first/last vocabulary groups.

The separate complete integration run passed **64 checks** and 32 primary real-model buys/sells, plus ancillary trades. Independent scalar replay matched all 32 words, all 768 state values and all 197 scores per step. It finished at sequence 37 after ancillary successful trades.

## What changed

- Exact SIMD11 packing uses 35 packed products per row instead of 48. Per-row offsets preserve every signed Q10 weight; there is no further quantization. The carry bound is 8,318,976, below 2^23.
- Unrolled dot products and assembly readers/activation arithmetic remove repeated loop and conversion work while preserving signed rounding.
- Four matrix-page addresses are cached as immutable values after the original complete catalog validation. Their fixed sizes fit one page. The larger fused table retains the general multi-page reader.

Selected runtime: [selected/GRU2SIMDModel.sol](selected/GRU2SIMDModel.sol), SHA-256 `1ee3a4dcb586c4e2d04026bb55daece53121e46f6a4f5162ccebaaf967c6a2c8`.

The storage representation and runtime code hashes change, so a future deployment must pin the new derived identity. The underlying accepted checkpoint remains `904e4ee0426dc62c06b5551db19d2ee40d0c0c618fdb62c4a49a39af80d390d3`.

## Security scope

The selected candidate uses the **original [pool hook](../nova-pool/contracts/NovaPoolHook.sol), token, locked vault and router unchanged**. The 2M callback reserve, 1.5M decoder limit, exact pool binding, code/model checks, canonical ABI checks, numeric limits, vocabulary validation, atomic rollback, reentrancy protection, minimum output and deadlines all remain. An inference failure still reverts the whole buy or sell. No cached-word or fail-open path was added.

The configured inference allowance is 13.3M; the tested transaction gas limit is 17.5M and the block limit is 32M. Actual consumed gas, rather than two declared limits added together, determines the observed block packing. The pending-transaction test confirms placement on the local chain. These are local results for this router and gas schedule, not measured mainnet throughput or an external security audit.

The optional packed-state hook under `audit/` was tested separately but **was not selected** and contributes nothing to the reported gas savings.

## Evidence

- [RESULTS.json](RESULTS.json): compact result and source/report hashes.
- [record-verification.json](record-verification.json): independent state hashes, features, supply, LP and same-block word sequencing.
- [flat-full-test/](flat-full-test/): complete integration receipts, independent neural replay and actual transcript.
- [flat-load-test/](flat-load-test/): all 44 queued swaps and block placement.
- [dot/flat-summary.json](dot/flat-summary.json): 23 original/optimized full-return comparisons.
- [audit/SECURITY-REVIEW.md](audit/SECURITY-REVIEW.md): arithmetic, bounds, catalog and unchanged-hook review.
- [audit/packing-independent-audit.json](audit/packing-independent-audit.json): independent comparison of all 4,523,904 repacked dynamic weights, offsets, biases and unchanged tables.
- [layout/packing-proof.json](layout/packing-proof.json): full-domain carry proof plus 94,248 row/vector equality checks.
- [layout/reproducibility.json](layout/reproducibility.json): restore and re-export from the published compressed baseline.

Large raw receipt reports are published as deterministic `.json.gz` files. Restore them with `gzip -dk` before replay/verification. Their uncompressed hashes are recorded in RESULTS.json. Baseline receipts remain in `../nova-pool/`; no earlier evidence was replaced.

## Reproduce locally

Run from `research/v4-hook-1m` with the repository's Node dependencies and Python/NumPy environment. Restore the accepted baseline from the existing compressed repository artifacts, then derive the selected runtime:

```sh
python experiments/gh0st-voice/nova-optimization/layout/restore_baseline.py
python experiments/gh0st-voice/nova-optimization/prepare-selected.py
node experiments/gh0st-voice/nova-optimization/test-optimized.mjs --source=selected/GRU2SIMDModel.sol --export=selected --out=flat-full-test --budget=13300000 --tx-gas=17500000
node experiments/gh0st-voice/nova-optimization/test-optimized.mjs --source=selected/GRU2SIMDModel.sol --export=selected --out=flat-load-test --budget=13300000 --tx-gas=17500000 --load-only
python experiments/gh0st-voice/voice-v8/evm/reference.py --model-dir experiments/gh0st-voice/nova-optimization/selected --report experiments/gh0st-voice/nova-optimization/flat-full-test/integration-results.json --out experiments/gh0st-voice/nova-optimization/flat-full-test/independent-neural-reference.json
node experiments/gh0st-voice/nova-optimization/verify-results.mjs
```

The full integration and load runs deploy the complete data set into separate unforked local chains. The direct microbenchmark injects local data code and must not be used as a deployment-cost measurement. All scripts and selected contracts remain local-chain-only.
