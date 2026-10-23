# Sentence-model quality and Uniswap v4 integration

This is a local optimization of the recovered 534,751-coefficient sentence
model. The original integer payloads and single-pool hook remain available as
the baseline. See `RECOVERY.md` for source provenance and the missing
original full-precision checkpoint.

## What changed

The quality experiment fine-tunes the recovered integer model locally, uses
balanced expressive-language training examples, and exposes persistent memory
to changes between successive sentences. It retains the 8,192-word vocabulary,
32-dimensional recurrent state, integer tensor layout, and onchain decoder.
Quality measurements are limited to a controlled synthetic language domain.
They do not establish open-domain language quality or trading insight.

## Selected result

Use `swap-speaker-535k/quality-candidate-final`. Its exact hashes and report
paths are recorded in `selected-quality-model.json`. The original `model/`
directory is unchanged. Earlier candidate directories are experiments, not
the selected export.

The final export stores 534,751 coefficients; 534,451 are unconstrained during
fine-tuning. Three existing hidden units have fixed feature-conditioning rows
for current movement, swap direction, and exact-input/output mode. Historical
movement, acceleration, and elapsed-time feature columns are inactive. This
explicit conditioning prevents old sentence context from masking the inputs
the text is meant to describe; it adds no operations or tensors to inference.

The reserved confirmation run (seed 523951) contains 600 synthetic swaps with evolving
pool-consistent tick, time, and EWMA state. Results are diagnostic counts, not
claims of general language competence:

| Measurement | Recovered baseline | Selected candidate |
| --- | ---: | ---: |
| Movement-category wording agrees with input | 356/600 (59.3%) | 504/600 (84.0%) |
| Natural sentence completion | 600/600 | 599/600 |
| Controlled grammar match | 600/600 | 588/600 (98.0%) |
| Article agreement | 600/600 | 600/600 |
| Distinct sentences | 46 | 84 |
| Outputs with repeated bigrams | 0 | 0 |

This is a relevance and diversity improvement with a small grammar regression
and one capped output. Every failed grammar/length example remains in the
saved reports. No post-processing hides them.
The separate 300-case stress audit improves movement agreement from 128/300 to
265/300, but diversity declines from 75 to 65 outputs on that input set.
Training and held-out phrases share compositional templates; neither set is
an out-of-domain evaluation. General-language retention is unmeasured because
the original text-data cache and full-precision checkpoint were unavailable.

The selected weights also pass the complete real local PoolManager suite:
9 tests, 19 behavioral checks, and 14 adversarial model fixtures. All generated
tokens, text, and recurrent states match the independent integer reference
during the tested swaps. Full spoken swap transactions use
3,575,471–4,046,224 gas in this local setup; those values include AMM execution,
hook inference, token settlement, and events. They are not chain-specific
deployment or production-router estimates.

`SentenceSpeakerV4Hook.sol` adds a separate reusable adapter:

- Independent memory and swap context for each initialized pool.
- Real swaps in both directions and exact-input/exact-output modes.
- ERC20 and native currency pools, static fees, and a configurable fixed initial
  fee for dynamic pools. No learned fee policy or custom accounting deltas.
- Bounded model execution, bounded return-data decoding, output validation,
  and an immutable direct-model runtime code hash.
- Optional speech when hook data is empty. Low gas or invalid inference emits
  `SentenceSkipped`, resets that pool's language memory, and allows the swap
  to continue when sufficient core swap/settlement gas remains.
- Required speech when hook data is exactly `0x53504b31` (`SPK1`). Estimation
  then funds inference; a speech failure reverts only that opt-in transaction.

See `swap-speaker-535k/V4-ADAPTER.md` for constructor arguments and integration
behavior. The CREATE2 permission mask remains `0x1040`.

## Reproduction

Use Node with pnpm and a Python environment containing the pinned NumPy
dependency. All commands run from this directory.

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-quality.txt
pnpm verify:model
pnpm verify:quality
pnpm test:evm
pnpm test:v4
pnpm test:v4:quality
.venv/bin/python swap-speaker-535k/python/quality_eval.py
```

The baseline integration report is
`swap-speaker-535k/reports/v4-poolmanager-integration.json`. Tests deploy the
unmodified v4-core 1.0.2 PoolManager on a local Cancun EVM, add liquidity,
execute AMM swaps, and settle actual token deltas. They check integer-reference
parity, pool isolation, failure handling, opt-in gas estimation, and transaction
rollback. PoolManager is compiled with Solidity 0.8.26; the model and adapter
use 0.8.30. Contract-size limits are enforced.

The candidate's integration report is
`swap-speaker-535k/reports/quality-final-v4-integration.json`, and its complete
development comparison is `swap-speaker-535k/reports/quality-finetune.json`.
The reserved confirmation reports are
`swap-speaker-535k/reports/quality-confirmation-baseline.json` and
`swap-speaker-535k/reports/quality-confirmation-candidate.json`.

## Remaining deployment work

The requested target is Robinhood mainnet (chain ID 4663). Confirm the supported
assets and deployment signer. Verify these changes on a fork of that chain and with
the intended production router. Deploy and verify the model data shards, model,
and mined hook address before initializing a funded pool. This task has not
broadcast transactions. Publication status is tracked by the branch commit,
not by this local report.

The tests provide local integration evidence, not an external security audit.
The model is a compact expressive-language experiment. Its statements should
not be treated as predictions, liquidity analysis, or financial advice.
