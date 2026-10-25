# Optimized four-chain inference costs

This report prices the complete 124,439,808-parameter INT8/Q12 GPT-2 model at the public fee snapshot from **2026-10-25T10:10:55.583128+00:00**. Values are research estimates from local receipts and live price/provider reads, not paid mainnet inference. Each unit below is one processed token position; the selected row is the second position, with a two-token context.

**Model plus activation-import execution: $91.8786 before → $21.7087 after (76.37% lower).** This compares both layouts under the same local profiles, including native Monad metering and declared-gas billing. It excludes transport from the before/after comparison.

The optimized route is **RH input → BNB block 0 → Arc block 1 → Monad blocks 2–11 and full vocabulary head → RH result**. The code preserves all weights and INT8/Q12 precision. Every remote chain performs real model computation. This minimizes expensive-chain exposure within the implemented whole-block partition; other architectures could improve further.

| Chain | Model + import | Provider components | Source gas allowance | Total with allowance |
| --- | ---: | ---: | ---: | ---: |
| Robinhood | $0.0569 | $0.2664 | $0.7811 | $1.1044 |
| BNB | $8.6282 | $0.2587 | $0.6186 | $9.5055 |
| Arc | $4.8914 | $0.2527 | $0.3507 | $5.4948 |
| Monad | $8.1322 | $0.2736 | $0.0359 | $8.4417 |
| **Total** | **$21.7087** | **$1.0513** | **$1.7863** | **$24.5463** |

The measured-model-plus-provider subtotal is **$22.7600**. Adding the explicit source execution allowance and RH raw-byte posting scenario gives **$24.5463**. This span is a planning scenario, not a hard bound: treasury fees and exact production OApp quotes remain unmeasured.

Provider components are read-only quotes for the exact four directed pathways, three 3,488-byte activation packets and one 416-byte result packet, two candidate DVNs, 20 confirmations, and 500,000 receive gas. The sender is a dummy address. Destination execution is included in the executor quote and is not added again. Source dispatch allows up to 16,777,216 gas per hop at the captured prices; this is a conservative operator budget rather than measured LayerZero source gas. Local mock transport costs are excluded.

Robinhood's extra posting scenario uses the captured parent-byte price, actual model/import calldata lengths and the fixed transaction envelope charge once. It is **$0.00001515** for this position. Exact compressed posting fees require target-network estimates. See [fee sources](FEE-SOURCES.md) and [machine-readable accounting](../evidence/optimized-costs.json).

## One-time initial installation

| Chain | Transactions | Billed gas scenario | Execution USD |
| --- | ---: | ---: | ---: |
| Robinhood | 1,781 | 9165796071 | $426.7207 |
| BNB | 329 | 1574961443 | $58.0720 |
| Arc | 329 | 1574918496 | $32.9236 |
| Monad | 4,819 | 24360459460 | $52.1466 |

These deployment figures exclude mock endpoints, RH parent posting and production messaging security setup. They are not included in the per-token price. Weight catalogs can be reused for future sessions on the same chain; engine/session state is separate.

## Validation and reproduction

Both full-model scenarios generated token IDs 198 and 464, checked 172 phase commitments, 100,514 output logits and 72 KV vectors. No host-computed activation was injected. All 7,930 baseline and 7,836 optimized receipts were successful and reconciled. Monad used native local MONAD_TEN semantics; the other three nodes used generic Cancun with target chain IDs. These are not complete mainnet-client equivalence tests.

```sh
npm run benchmark:baseline-native -- --tokens=2
npm run benchmark:optimized -- --tokens=2 --out=reports/optimized-native-full
npm run costs -- --markdown=docs/COSTS.md
```

A prompt of N tokens requires N processed positions before its first next-token result; each additional output adds a position. Attention and KV costs grow with context. This one/two-position benchmark must not be presented as a constant long-context chat price. Longer-context tests and exact deployed-OApp quotes are the next pricing work.
