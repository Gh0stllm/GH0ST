# Compositional onchain sentence model

The selected release uses `swap-speaker-535k/composition-candidate-v2/` with seeded word sampling at temperature **0.25**. `selected-quality-model.json` records its exact artifacts, runtime identity and reports. The recovered baseline and previous fine-tune remain unchanged.

This is a small recurrent neural language model, not a large general-purpose language model or a transformer. Solidity computes each next word from learned weights, prior words, recurrent state and swap features. No full-sentence lookup, inference grammar, output filter or external AI service selects the text.

## What changed

The previous fine-tune reproduced known training sentences in 579 of 600 tested outputs. The new local NumPy run trains on 2,400 composed sentences and reserves 300 validation and 300 test sentences with entire object/tail pairs held out. Thirty epochs took about 18 seconds; checkpoint selection uses validation loss, not final generation results. Article agreement was corrected before the selected run.

The model retains 534,751 stored coefficients, an 8,192-word vocabulary and a 32-unit recurrent state. Three units have fixed feature conditioning; 534,451 values are unconstrained in training. The hook retains independent pool memory and its existing optional/required speech policy.

`generateSampled` traverses learned binary probabilities using an integer Q16 sigmoid table. Temperature is fixed at Q10 value 256. One Keccak hash per word supplies thirteen nonoverlapping 16-bit draws. The hook supplies its swap input commitment, which includes pool identity, sequence and state, as the seed. This gives reproducible creative variation; it is not secure randomness. Legacy greedy `generate` remains available. The runtime identity domain includes the decoder version and temperature.

## Reserved confirmation

The final sampled run uses trajectory seed 792461 and sampling seed 823114. All 600 raw outputs, inputs and failures are in `swap-speaker-535k/reports/composition-v2-sampled-keccak.json`.

| Diagnostic | Result |
| --- | ---: |
| Exact matches to known authored training sentences | 16/600 (2.7%) |
| Distinct output strings | 536/600 |
| Natural completions | 600/600 |
| Productive grammar passes | 574/600 |
| Article agreement | 600/600 |
| Movement-category agreement | 566/600 |
| Joint noncopy, complete, grammar, article and movement passes | 529/600 |
| Distinct sentences among those joint passes | 473 |

The independent audit also excludes repeated-bigram outputs, leaving 522 noncopies passing that stricter set. An independent assistant reviewed 48 balanced diagnostic samples: 46 were complete, interpretable and grounded in movement. This is qualitative review, not a human participant study or an unbiased population estimate.

The result generates fresh combinations within a narrow learned grammar. It does not guarantee every output is new: 521 of 600 outputs are within two word edits of a known training sentence. Only 25 use an object/tail pair absent from supplied training corpora. The original WikiText pretraining prefix is unavailable, so absence from all historical training cannot be established. The model does not demonstrate broad reasoning or general English ability. Failed examples remain in the reports, including the fragment “another shifting market.”

The selected low temperature trades some joint quality for diversity: the decoder comparison found 478 distinct joint-valid new sentences at temperature 0.25 versus 128 with greedy decoding. Temperature 0.75 was rejected for poorer grammar. These development results are separate from the reserved confirmation.

## Onchain checks

The selected model passes 9 real local v4 PoolManager tests, 19 behavior checks and 14 adversarial fixtures. Six independent Python Keccak fixtures match all 78 branch scores, complete sentences and hidden states in Solidity; legacy greedy parity also passes. Spoken swaps use **4,108,881–5,034,650 gas** locally. Required-speech gas estimation funds the inference budget. Empty hook data may estimate the cheaper skip path; use exact `SPK1` data when speech is required.

The new unsigned Robinhood mainnet plan contains 59 locally executed and verified deployments. It supersedes the previous plan; no public transactions have been broadcast by this task. GH0ST/native ETH remains the selected pair. Liquidity amounts and token transfer compatibility still need to be settled before funding.

## Reproduction

From this directory, with Node and Python available:

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 -m pip install -r requirements-quality.txt
pnpm verify:quality
python3 swap-speaker-535k/python/finetune_composition.py --epochs 30 --output /tmp/gh0st-composition-reproduction
python3 swap-speaker-535k/python/evaluate_sampled.py --out /tmp/gh0st-sampled-reproduction.json
pnpm quality:novelty
pnpm test:v4:quality
pnpm test:pool
node --test tests/evm/wallet-deploy.test.mjs
```

See `swap-speaker-535k/reports/composition-v2-sampled-novelty-audit.json`, `composition-v2-sampled-manual-review.json`, and `composition-v2-sampled-v4-integration.json` for the detailed evidence. Earlier `reports/QUALITY.md` describes the superseded fine-tune.
