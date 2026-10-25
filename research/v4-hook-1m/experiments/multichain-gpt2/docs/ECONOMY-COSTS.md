# Cheapest fully on-chain research route

Robinhood receives the prompt and final result; opBNB runs all 124,439,808 GPT-2 parameters. BNB Smart Chain, Arc and Monad are not charged by this route. Precision and canonical weights are unchanged.

**Recommended-bid scenario: $2.940897 per output token before session setup. Observed-low-bid scenario: $0.101402.** These are a two-output, one-token EOS benchmark, not a long-chat price. The low bid has no demonstrated inclusion guarantee.

| Cost for the complete two-output job | Recommended bid | Observed low bid |
| --- | ---: | ---: |
| Robinhood | $0.119009 | $0.119009 |
| opBNB | $5.762786 | $0.083795 |
| BNB Smart Chain | $0.000000 | $0.000000 |
| Arc | $0.000000 | $0.000000 |
| Monad | $0.000000 | $0.000000 |
| **Total with delivery/posting allowances** | **$5.881795** | **$0.202804** |
| Average per generated token | $2.940897 | $0.101402 |
| Extra session setup execution estimate per job | $0.245466 | $0.239059 |
| Average including session setup execution | $3.063631 | $0.220931 |

Session setup posting remains additional. Existing contracts are single-use: do not describe their deployment as permanently amortized. The complete first installation used 27932135306 local gas, including reusable weights/catalogs plus routers and engine, before production messaging setup.

## What is measured

- Model/control: 7787263841 gas across 633 transactions; 172 phase vectors, 100,514 logits and 72 KV vectors match the independent reference.
- Exact local-fork GPO posting quote for those transactions: 4132224041145 wei BNB. Fee state pinned to block 199271251.
- Official forked source sends: 326603 RH gas and 251404 opBNB gas. Total two-DVN quotes are approximately $0.013537 per job.
- opBNB bid: 1,000,000 wei recommended; 10,000 wei low scenario. USD conversion captured 2026-10-25T13:26:17.393Z. RH uses 20082000 wei/gas.

## What remains an allowance

The table budgets 2000000 gas on each destination for commitVerification plus lzReceive, $0.01 RH posting and $0.01 other opBNB posting per job. These are unmeasured planning allowances, not guarantees. DVN verification gas is already paid through each source quote and is not counted again. The extra session row includes measured deployment/send-configuration gas plus 1,000,000 gas per chain for unmeasured receive configuration.

Default managed LayerZero executors reject this direct pair in the captured state. The optional self-operated executor preserves both DVNs and charges no service fee, but needs a live relayer and confirmed DVN support. Public destination delivery has not been demonstrated. Hosting, margin and setup posting are excluded.

## Comparison and tradeoff

The previous four-chain second-position **model/import-only** estimate reprices to $22.743869. The new recommended model/control plus exact posting averages $2.868870 per output. This comparison excludes transport on both sides and uses separate short-context runs. The older $24.55 total was a different snapshot and allowance model, not a paid receipt.

Colocating the model removes 38,839,376 duplicated bytes: 38,798,404 for the tied embedding/output table and 40,972 for lookup tables. Sending one request and one final result removes per-token activation bridges. Computation remains fully on-chain; the CPU only tokenizes and verifies the benchmark.

Larger prompts require N + M - 1 processed positions for N input and M output tokens, and attention/KV costs grow with context. Do not multiply this short-context number into a promised flat reply price.

See [machine-readable costs](../evidence/economy-costs.json), [deployment/relay guide](JOB-DEPLOYMENT.md), [fee sources](ECONOMY-FEE-SOURCES.md) and [opBNB snapshot](../research/opbnb-snapshot.json). Recompute offline with `npm run costs:economy`.
