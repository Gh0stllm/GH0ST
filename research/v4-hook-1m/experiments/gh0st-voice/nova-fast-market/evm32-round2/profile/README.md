# Exact gas profiling and signed packing

Local-only research. No public-chain requests, signing, or deployment. The checkpoint, every Q10 weight, model inputs, sampling, and generated outputs remain unchanged.

## What costs gas

The instrumented single-step model spends about 7.65M gas in the GRU, 408k in the group head, 174–177k in the word head, and roughly 80–100k in sampling. Instrumentation adds eight `gasleft()` measurements; it is diagnostic source, not the selected candidate. The GRU is about 89% of the measured execution body. See `profile-results.json`.

PyTorch 2.14.1 reports `mps.is_built() = true` and `mps.is_available() = false` in this execution environment. Exact integer proofs were run on CPU; no GPU work is claimed.

## Core shard alignment

`aligned/` packs 18 complete 1,312-byte rows into each 24,000-byte code shard, with 384 zero bytes after the rows. The evaluator no longer needs a row-crossing branch or a second shard read. All 3,456 row payloads are byte-identical; 73,728 padding bytes are added to the core data. Six complete-ABI comparisons pass. Savings relative to the previous checked batch are 109,181 / 225,320 / 341,459 gas for 1 / 2 / 3 words. This layout remains in `signed/`.

## Signed polynomial packing

` signed/GRU2BatchCheckedModel.sol` retains 10 lanes with radix B = 2^25. Instead of making every weight and activation nonnegative, it packs their original signed values as a polynomial. All EVM operations are evaluated modulo 2^256. Reverse weight order makes the desired dot product the coefficient at B^9. Each multiplication therefore still computes ten products.

For a group of packed products, every polynomial coefficient has absolute value bounded by 1,024 times the sum of absolute weights in that group. We checked that bound against all weight rows: it is strictly below B/2 = 16,777,216. The maximum observed bound is 16,437,248. Consequently, the sum of all terms below B^9 has absolute magnitude less than B^9/2. Adding B^9/2 and shifting by 225 extracts the exact nearest coefficient. The result is interpreted as a signed 25-bit integer. Modulo 2^256 preserves this coefficient because the top of the extracted 25-bit window is below bit 256.

This supports 19+20 packed products per GRU row and 26+13 per output row, rather than seven or six extraction groups. It also removes the original activation-shift and weight-offset correction arithmetic. It neither rounds the dot product nor modifies Q10 rounding at later model stages.

` signed-proof.json` checks every row bound plus 70,686 row/vector dot products. `signed-data-audit.json` independently decodes all 4,523,904 packed dynamic weights and compares them to the original checkpoint export. The padding layout is independently checked by `aligned-proof.json`.

## Actual EVM results

Solc 0.8.30, viaIR, optimizer 200, Cancun, unforked local Hardhat chain 31337. Test data was injected locally; these are inference benchmarks, not deployment-cost measurements. The entire returned ABI — tokens, punctuation, all intermediate 768-value hidden states, all 197 scores per word, text, count, and terminal status — matches the previous checked batch for all six initial comparisons.

| Words | Previous checked batch | Signed + aligned | Saving |
|---|---:|---:|---:|
| 1 | 9,447,131 | 9,014,213 | 432,918 |
| 2 | 17,281,970 | 16,410,007 | 871,963 |
| 3 | 25,110,841 | 23,799,833 | 1,311,008 |

These are direct model-call costs. Pool settlement, caller validation, storage, and logs are excluded. The combined candidate still requires full integration/security testing; `signed/` alone is not a deployment recommendation.

## Reproduction

From the research root, run `profile/make-profile.py`, `profile/profile.mjs`, `profile/align-core.py`, `profile/aligned-benchmark.mjs`, `profile/signed-packing.py`, `profile/audit-signed-data.py`, and `profile/signed-benchmark.mjs` under `experiments/gh0st-voice/nova-fast-market/evm32-round2/`. Python needs NumPy; Node uses the existing research dependencies.
