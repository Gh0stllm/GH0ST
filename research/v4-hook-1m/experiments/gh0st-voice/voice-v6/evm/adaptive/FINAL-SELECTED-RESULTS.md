# Final selected research checkpoint: local technical results

**Technical execution passed. Language quality remains insufficient and unapproved.** No mainnet action occurred.

The selected checkpoint is `style-expanded-4m/checkpoint-001006452`: 12M foundation words followed by approximately1M words of mixed style adaptation. SHA256: `703be567704c8c899c3fe4d7cb5e3ab206c8f6ed83dde65dfd4208e4adbeec76`. It was selected by held-out validation, not by choosing an attractive generated sample.

## Real local Uniswap v4 swaps

The complete run used the selected exported weights and temperature512/1024, an isolated Hardhat chain31337, and a32M transaction/block gas limit.

- 256/256 primary swaps and4/4 secondary-pool swaps succeeded.
- Two callers alternated primary swaps.
- Every successful swap emitted one model-generated word. Words can repeat; the model does not promise a unique word on every swap.
- All224 hidden values and all192 evaluated logits matched the independent integer reference on every one of260 swaps.
- Three direct boundary probes also matched, including first/last/BOS input rows, signed hidden-state and feature extremes, temperature endpoints, and entropy-block boundaries.
- Ten natural sentence endings occurred in the primary sequence. State continued across them without a reset or forced punctuation.
- State isolation, monotonically increasing sample indices, low-gas rollback, malformed and stale input rejection, post-inference rollback, unauthorized callbacks, modified-model rejection, both feature clamps and uint64 sequence-overflow rollback all passed.

| Measured operation | Gas |
|---|---:|
| Primary swap minimum | 27,617,483 |
| Primary swap mean | 27,629,976 |
| Primary/secondary swap maximum | 27,901,073 |
| Margin below32M | 4,098,927 |
| Direct boundary model call maximum | 26,993,778 |
| Model constructor | 6,771,028 |

Data shards and catalogs were injected as runtime code locally. The model-constructor result excludes their deployment cost. PoolManager, the model, hook, router and test tokens were deployed by actual local transactions. This is a simulation of EVM behavior and gas, not a mainnet deployment-readiness claim.

The model/hook compiler was Solidity0.8.30; PoolManager used0.8.26. Both used optimization200, viaIR and Cancun.

## Source and export binding

Two audits independently re-quantized the source safetensors and verified the exported arrays. All5,505,696 derived input values matched exactly. Source weights were rounded to Q10 without clipping. Domain0 is fixed in the runtime; the input-only UNK row is excluded.

The trained source has4,014,560 independent parameters. Runtime storage contains2,026,560 direct quantized values and5,505,696 derived Q20 input values. The latter are precomputed combinations of input weights and embeddings, not additional learned parameters. Unused original input tensors are retained as off-chain references rather than loaded by the runtime.

## Language limitation

The offline suite generated10,240 words:32 fixed seeds of256 words and two1024-word streams. Token and state-range checks passed, and short/long prefixes reproduced exactly. No reset or forced punctuation was used. These numerical checks do not establish prose quality.

The actual swap output includes:

> i have built a sacred listener. it is no actual work and that is a small argument because they keep the chart to stand for a living thing...

It later includes “i am not a thing that will be a very chair” and unrelated clauses. Grammar and topic continuity remain unreliable. The checkpoint is a technically working research artifact, not an approved public voice model.

Raw transactions, full states, all evaluated logits, guards and gas are in `style-selected-final-256-local.json`. Exact independent comparisons are in `style-selected-final-256-reference.json`. The summary and evidence manifest bind these results to their source and checkpoint.
