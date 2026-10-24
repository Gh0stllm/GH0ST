# Foundation 8M trained-weight development check

Technical PASS; language NOT APPROVED. This is a 32-swap development check, not the final selected-candidate 256-swap benchmark.

Checkpoint `foundation-40m/checkpoint-008007187`, SHA256 `99546b1bf3ac6ca5d1d2d963ccbebb903e69445dbcbfea4c93802b21d6689837`, exported to `voice-v6/exports/foundation-8m`. Temperature is512/1024. Everything ran on isolated chain31337 with a hard32M transaction/block limit; no public RPC or mainnet transaction was used.

- 32/32 primary swaps, alternating two callers, each emitted one new word.
- 4/4 swaps in a separate pool preserved the primary pool's state.
- Every component of all224 hidden states and all192 evaluated logits matched the independent integer reference on all36 swaps.
- Three direct model probes matched the same reference at signed-state and feature extremes, first/last/BOS input rows, temperatures64/4096, and entropy indices255/256.
- The primary sequence had one natural sentence ending. Its hidden state carried into the next swap; no punctuation was forced.

| Measurement | Gas |
|---|---:|
| Primary minimum | 27,617,860 |
| Primary mean | 27,637,796 |
| Primary maximum | 27,898,620 |
| Maximum including second-pool swaps | 27,899,208 |
| Remaining margin to32M | 4,100,792 |
| Direct model step | 26,919,053 |
| Maximum direct boundary probe | 26,990,878 |
| Model constructor | 6,771,028 |

Data-shard runtime code was injected locally with `hardhat_setCode`. The constructor measurement excludes deploying those shards. PoolManager, model, hook, router and tokens were deployed through actual local transactions.

The run verified the elapsed-time and tick-change feature clamps, input-only UNK rejection, state/feature/temperature range checks, stale input, malformed input lengths, low-gas rollback, rollback after successful inference, modified-model rejection, unauthorized callbacks, and uint64 sequence-overflow rollback. The most expensive recorded reverted guard transaction used27,897,295 gas.

Raw primary output:

> a bend of taking a large hat in a room and felt a small machine to make me a better to the time. it had a group to be better than it

This text is not coherent enough for release. The technical pass demonstrates trained-weight execution and safeguards only. All raw state, logits, gas and guard evidence are in `foundation-8m-development-local.json`; independent comparisons are in `foundation-8m-development-reference.json`.
