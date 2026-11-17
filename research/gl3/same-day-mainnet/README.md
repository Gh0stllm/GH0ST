# GL3 base-chain launch candidate

**Prepared, not live.** The same-day candidate is an official Nitro L3 settling to Robinhood, with native GH0ST gas, a native-token bridge and project-operated fast confirmation. This is an operator-trusted launch. It is not a ZK rollup at launch; the prior ZK, Stylus and full-model proof research remains preserved under `../zk-rollup/`.

## Withdrawals

There is no configured minimum assertion period in the selected candidate. The project validator derives and checks actual child execution, posts an ordinary assertion with its genuine history commitment, then uses its designated fast-confirm authority. A user can claim the resulting withdrawal on Robinhood after that root is confirmed. No fixed seven-day countdown applies to this normal operator-confirmed route. This does not guarantee instantaneous or operator-independent exits: processing, parent-chain fees, availability and the operator's powerful confirmation authority remain material.

The UI must show **Project-run fast confirmation** and **GH0ST-operated key confirms withdrawal roots. ZK verification not live.** An unexpected or zero confirmer disables bridging. The underlying standard optimistic fallback parameters remain recorded; they must not be confused with the normal fast route or claimed as ZK protection.

## Prepared pieces and remaining gates

| Piece | Evidence and current boundary |
| --- | --- |
| Official execution and validator components | Pinned official Nitro and matching validator/JIT/prover; authenticated loopback backend smoke passes |
| Genesis and native backing policy | Exact zero-allocation, zero-owner ArbOS61 genesis reproduced; actual initialized owner/minter state inspected privately |
| Deployment | Standard factory/template and createRollup calls encoded but unsigned; fresh constructor estimates are separate from full sequential deployment |
| Bridge | Prior private round trips and standard disputes are preserved; this exact fast-profile round trip is being rehearsed, with failures preserved |
| RPC and interface | 22 bounded RPC/UI tests pass on Runpod; four unchanged explorer-render checks passed previously; no public endpoint yet |
| Custody | Separate poster and validator roles generated; encrypted recovery copied off the worker and verified; cold funding key stays off the server |
| License | Full current AEP terms linked for explicit operator review; no upfront license payment found; 10% positive net-revenue obligation and the accepted native-GH0ST payment target remain to be finalized |

[Node and validator](node/) · [Unsigned deployment packet](deployment-packet/README.md) · [Bridge rehearsal](bridge-rehearsal/README.md) · [RPC and bridge interface](network/README.md) · [License and payment draft](network/aep-accounting-plan.md).

## Network proposal

- Parent: Robinhood, chain ID 4663.
- Child: GL3, proposed chain ID 4663001, not reserved or live.
- Native backing token on Robinhood: `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`.
- Intended RPC: `https://rpc.gh0st.fyi`.
- Confirmed explorer hostname: `https://scan.gh0st.fyi`.
- Intended bridge: `https://gh0st.fyi/gl3/bridge/`.

All builds and CPU tests run on the existing Runpod worker. No GPU is required for this base launch. No automatic top-ups are configured. Final review must bind exact transactions, spending, custody, terms and receipt-derived addresses before public activation.
