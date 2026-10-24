# N0VA-8M: second Solidity optimization

**32 local swaps generated the same 90 neural words with 15.33% less average gas.** The unchanged 8,175,493-parameter Q10 model continues its saved story state, producing one to three new words on every successful swap. All tests were unforked and local. Nothing was sent to a public chain.

| Complete PoolManager swap | Previous implementation | Selected implementation |
| --- | ---: | ---: |
| Minimum gas | 11,740,540 | 9,090,549 |
| Mean gas, 32 swaps | 26,346,158.41 | 22,307,148.75 |
| Maximum gas | 28,513,802 | 23,806,866 |
| Neural words / natural sentence endings | 90 / 7 | 90 / 7 |

These are full local transaction receipts, including inference, validation, state writes, events, token transfers and pool settlement. Every transaction and block used a 32M ceiling. The workload alternated buys and sells; separate cases tested failure rollback and adversarial inputs. It is not a mainnet throughput or deployment-cost measurement. Ten swaps per second remains unproven.

## Selected code

- Model: [model/GRU2PackedModel.sol](model/GRU2PackedModel.sol).
- Hook: [decoder/NovaPackedBatchTextHookTuned.sol](decoder/NovaPackedBatchTextHookTuned.sol).
- Exact data representation: `profile/signed`, regenerated from the existing checkpoint export. The model domain changes to identify this representation; the learned weights and calculations do not change.
- Summary and hashes: [RESULTS.json](RESULTS.json). Actual output: [final-local-test/actual-transcript.txt](final-local-test/actual-transcript.txt).

The compute loop reuses feature contributions and head buffers, avoids recurrent products for an initially zero state, and uses exact signed polynomial packing with aligned data shards. The fixed-format result keeps every intermediate hidden-state cell and score while reducing the ABI return from 93,312 to 7,168 bytes. The packer checks ranges before narrowing; the hook validates the canonical payload, state bounds, vocabulary, punctuation, unused slots and padding. Three-word decoder execution fell from about 2.14M to 0.237M gas. The decoder cap is 800k, with a 2M callback reserve and a maximum 26M model-call allowance.

The fixed token supply, locked liquidity, pool/model commitments, sequence checks and strict transaction rollback remain. Preflight chooses a smaller word cap when available gas requires it. After a call starts, any inference or validation failure reverts the entire trade. A partial sentence continues on later swaps; there is no inserted punctuation, phrase library, external inference or forced sentence completion.

## Verification

- Independent scalar Q10 replay matched all 90 words, every final 768-value hidden state, and every state-hash link across all 32 swaps. The text, input features and numerical states also match the prior 32-swap run.
- 24 direct batch comparisons matched every returned token, punctuation, hidden-state value, score and text against the prior model. Three original single-step API comparisons and 11 invalid-input categories also passed.
- 29 real-model integration checks and 111 adversarial PoolManager checks passed, including strict rollback, identity and pool guards, reentrancy, contract-wallet paths and gas headroom. The expensive mock used 25,799,998 gas inside the 26M model cap; its complete swap used 26,869,000 gas.
- 214 independent decoder oracle cases and all 65,536 int16 encodings passed.
- All 4,523,904 repacked dynamic weights matched the original, with 70,686 scalar dot-product comparisons and coefficient bounds checked across every row.

This is local engineering validation, not an external security audit. GPU access was unavailable to the process; exact numerical checks ran on CPU, and gas was measured in the local EVM. The work preserves the existing model's language quality rather than retraining it.

## Reproduce

Use the existing research Node dependencies and a Python environment with NumPy. Run from `research/v4-hook-1m`. Large model data is regenerated locally; receipt reports over 50KB are published as deterministic `.json.gz` files. Decompress those files before replaying saved reports.

```sh
python experiments/gh0st-voice/nova-fast-market/prepare-selected.py
python experiments/gh0st-voice/nova-fast-market/evm32-round2/profile/align-core.py
python experiments/gh0st-voice/nova-fast-market/evm32-round2/profile/signed-packing.py
python experiments/gh0st-voice/nova-fast-market/evm32-round2/profile/audit-signed-data.py
python experiments/gh0st-voice/nova-fast-market/evm32-round2/compute/build.py
python experiments/gh0st-voice/nova-fast-market/evm32-round2/compute/build-signed.py
python experiments/gh0st-voice/nova-fast-market/evm32-round2/model/build.py
node experiments/gh0st-voice/nova-fast-market/evm32-round2/model/benchmark.mjs --export=evm32-round2/profile/signed
node experiments/gh0st-voice/nova-fast-market/evm32/test-text.mjs --source=evm32-round2/model/GRU2PackedModel.sol --hook=evm32-round2/decoder/NovaPackedBatchTextHookTuned.sol --budget=26000000 --export=evm32-round2/profile/signed --swaps=32 --out=evm32-round2/final-local-test
python experiments/gh0st-voice/nova-fast-market/evm32/verify-text.py --report experiments/gh0st-voice/nova-fast-market/evm32-round2/final-local-test/text-results.json --out experiments/gh0st-voice/nova-fast-market/evm32-round2/final-local-test/independent-reference.json
node experiments/gh0st-voice/nova-fast-market/evm32-round2/decoder/test-oracle.mjs
python experiments/gh0st-voice/nova-fast-market/evm32-round2/decoder/prove-representation.py
node experiments/gh0st-voice/nova-fast-market/evm32-round2/decoder/test-packed-tuned-security.mjs --source=evm32-round2/model/GRU2PackedModel.sol --export=selected --hook=evm32-round2/decoder/NovaPackedBatchTextHookTuned.sol --out=evm32-round2/decoder/packed-tuned-headroom --budget=26000000 --tx-gas=32000000 --sentence-security
python experiments/gh0st-voice/nova-fast-market/evm32-round2/finalize.py
```

The adversarial security harness replaces the model with a calibrated mock; its receipts are not production-model performance figures. The selected 32-swap report above uses the real neural model.
