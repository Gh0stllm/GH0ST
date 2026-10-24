# Exact memory KV reuse

This local variant retains the original 1,235,968 Q12 parameters and all 4,019 output logits. `forward` and `inspect` retain the frozen unrolled implementation. `generate` caches per-layer keys and values in memory for the duration of its call, avoiding recomputation of earlier tokens. No storage persists between transactions.

The prefix is processed once. Prefix positions omit final-layer query, attention, output projection, and MLP work, which cannot affect the final position. Every generated output still runs the complete current-token transformer and vocabulary projection. The public API, token limit, context limit, greedy selection, and EOS handling are unchanged.

The full local test matched all selected hidden-state and full-vocabulary reference fixtures. All four generation fixtures matched their complete expected token lists, EOS flags, and final full-logit hashes. Original model artifacts remained unchanged. The compiled runtime is 12,010 bytes, within EIP-170.

Measured real v4 swaps in the isolated higher-limit diagnostic environment:

| Input tokens | New output tokens | Gas used |
| ---: | ---: | ---: |
| 1 | 1 | 19,844,938 |
| 1 | 4 | 78,339,885 |
| 10 | 1 | 109,246,061 |
| 10 | 4 | 172,514,497 |

Memory reuse reduces repeated generation work, but it does not make a four-token continuation or complete ten-token-question prefill fit 32M gas. The diagnostic environment's higher configured limit must not be confused with the target transaction limit.

The first normal-limit run configured a 29.5M model subcall budget. Its callback gas guard rejected the call before inference, even for the small case; this is preserved in the results rather than presented as a model execution failure. A separate two-input-token budget scan found that a 29.20M budget reached model execution but ran out of gas (transaction: 29,300,914 gas), while 29.25M, 29.30M, and 29.35M budgets were rejected by the callback guard before inference. None of those four configurations completed a normal-limit two-token swap.

Evidence: `../benchmark/gas-benchmark-swar8cached.json` and `../benchmark/gas-benchmark-swar8cached-budget-scan.json`, with the exact executed runners alongside. `variant.json` records the frozen source used to derive this implementation. The reproducible builder is `../design/build_cached_variant.py`.

Every EVM action was on isolated, unforked local Anvil. No mainnet RPC, deployment, signing, website update, or repository publication occurred.
