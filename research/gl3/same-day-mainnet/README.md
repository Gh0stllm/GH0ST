# GL3 base-chain launch candidate

**R59: all 27 Robinhood deployment transactions confirmed; corrected independent audit passed. Public chain services are not live.** GL3 uses official Nitro, native GH0ST gas, a native-token bridge and project-operated fast confirmation. This is an operator-trusted launch. It is not a ZK rollup at launch; the prior ZK, Stylus and full-model proof research remains preserved under `../zk-rollup/`.

## Withdrawals

There is no configured minimum assertion period in the selected candidate. The project validator derives and checks actual child execution, posts an ordinary assertion with its genuine history commitment, then uses its designated fast-confirm authority. A user can claim the resulting withdrawal on Robinhood after that root is confirmed. No fixed seven-day countdown applies to this normal operator-confirmed route. This does not guarantee instantaneous or operator-independent exits: processing, parent-chain fees, availability and the operator's powerful confirmation authority remain material.

The UI must show **Project-run fast confirmation** and **GH0ST-operated key confirms withdrawal roots. ZK verification not live.** An unexpected or zero confirmer disables bridging. The underlying standard optimistic fallback parameters remain recorded; they must not be confused with the normal fast route or claimed as ZK protection.

## Prepared pieces and remaining gates

| Piece | Evidence and current boundary |
| --- | --- |
| Official execution and validator components | Pinned official Nitro and matching validator/JIT/prover; authenticated loopback backend smoke passes |
| Genesis and native backing policy | Zero-allocation ArbOS61 cold setup-owner genesis reproduced; seven actual private setup calls finish with owners[zero]/no minters and calibrated1e13 fee |
| Deployment | All 27 exact transactions succeeded; actual gas cost 0.001627693426576 ETH. An independent audit binds canonical receipts, runtimes, proxy links, authorities and nonempty genesis. The original final-check failure remains preserved |
| Bridge | Prior private round trips and standard disputes are preserved; genuine SDK confirmation plus a hash-verified persisted-state restart now completes exact payout and replay/unauthorized rejection; failures remain preserved |
| RPC and interface | Both public hostnames have verified HTTPS and honest disabled responses. The main-site draft preserves all 652 existing files and two functions; main production remains unchanged |
| Custody | Separate poster and validator roles generated; encrypted recovery copied off the worker and verified; cold funding key stays off the server |
| License | User explicitly accepted the reviewed AEP terms on the local signing page. The 10% positive net-revenue obligation remains; the native-GH0ST payment target is not yet confirmed |

[Node and validator](node/) · [Actual receipt packet](deployment-packet/receipt-derived/packet.json) · [Bridge rehearsal](bridge-rehearsal/README.md) · [RPC and bridge interface](network/README.md) · [Pod failure and recovery](RECOVERY.md) · [License and payment draft](network/aep-accounting-plan.md).

## Network proposal

- Parent: Robinhood, chain ID 4663.
- Child: GL3, configured chain ID 4663001; public execution services remain inactive at this checkpoint.
- Native backing token on Robinhood: `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559`.
- Intended RPC: `https://rpc.gh0st.fyi`.
- Confirmed explorer hostname: `https://scan.gh0st.fyi`.
- Intended bridge: `https://gh0st.fyi/gl3/bridge/`.

All builds and CPU tests run on the existing Runpod worker. No GPU is required for this base launch. No automatic top-ups are configured. Final review must bind exact transactions, spending, custody, terms and receipt-derived addresses before public activation.

The actual rollup is `0xeE811A8ee20C03E684ECB5BFd6f7721f85451b01`, created by transaction `0xadf4ffccdc68d51fa9c5c6e2480ca14cf9072dbae21e7e9127a70ee8b7d0abcb`. The user's 1,000,000 GH0ST bridge instruction replaces the former 100-token setup plan; those tokens have not moved at this checkpoint. Bounded validator allowance, private node startup, the backed deposit, seven child setup calls and final public activation remain pending. The user explicitly retained Robinhood safe/finalized checks. This is a single operator pod with manual recovery, not automatic failover.
