# Finite observation-report pilot results

The adapted **984,192-parameter transformer reproduced the authored policy on
all 768 held-out synthetic feature vectors**, using both floating-point and
integer inference. This establishes the tested finite mapping. It does **not**
establish financial intelligence, a security audit, real-address generalization
or Aixbt-level research.

| Measurement | Ordinary test | Held-out three-field combination |
| --- | ---: | ---: |
| Examples | 512 | 256 |
| Floating model exact output | 512/512 | 256/256 |
| Integer model exact output | 512/512 | 256/256 |
| Float/integer output agreement | 100% | 100% |
| Unknown or policy-contradictory clauses | 0 | 0 |
| Missing uncertainty statements | 0 | 0 |
| Saturations | 0 | 0 |
| Authored deterministic policy | 100% | 100% |
| Majority output baseline | 2.54% | 8.20% |
| Shuffled-feature exact output | 0.59% | 10.55% |

All six separate missing-data/no-code regressions passed. Two no-code states
were explicitly weighted training/selection regressions, not independent test
generalization. The combination split excludes the triple `owner=nonzero,
pause=true, origin=present` from training and validation. Test examples were
not used to select weights or correct the training procedure.

The deterministic policy authors the labels, scores 100% and is much cheaper.
Learning to reproduce it does not add factual knowledge. The model sees only
fourteen categorical observations and can emit 87 fixed words; it cannot
describe raw amounts, external prices, transaction history, identity, news or
open-ended investment reasoning. Addresses with the same feature categories
produce the same report. Reported getters and interface claims may be deceptive;
bytecode patterns do not prove reachability, relationships or vulnerabilities.

The first development candidate failed the two underrepresented no-code cases.
That failure is preserved. A separate 900-step, 150.48-second continuation used
corrected independent-pattern wording and explicit no-code sampling. Selection
was 128 validation examples plus two identified in-sample regressions. The
checkpoint was frozen after training exited, before sealed evaluation. The
full floating/integer sweep took 268.55 seconds.

The original deployed baseline remains unchanged. Initialization recovered its
INT8/Q24 weights and Q14 gains; every reconstructed integer array round-tripped
exactly. New feature/word embeddings were explicitly remapped, then all model
parameters were fine-tuned. The unavailable original float checkpoint was not
claimed as recovered.

Final checkpoint SHA256:
`9cf0b5ce17109bda877f21ac08731cd1897bf6d160b4b690de809c750e960716`.

Integer payload SHA256:
`12dae909761bd6b990989fd63d5130be9db84e5ede0b86770754316aa853110d`.

Solidity payload SHA256:
`b83416a49a7600136a9eb26c8d13b260ed4d4933ec0b1bff7fb5b6419579d901`.

The cached and full-prefix Python references matched 51,200 logits across 100
decisions from four held-out examples, plus 8,704 logits for the canonical
17-token no-code report. Those paths share arithmetic kernels. Independent
local EVM parity is a separate integration result; this document does not
assert it or any mainnet deployment. The report explicitly records
`production_analyst_capability_established: false`.
