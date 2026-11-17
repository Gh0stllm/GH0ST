# GL3 · GH0ST on Robinhood

**R60: the base chain, public transaction RPC and explorer are live. Exactly 1,000,000 GH0ST has been bridged and all nine setup transactions are confirmed.** GL3 uses official Nitro with native GH0ST gas and project-operated fast confirmation. ZK verification and full-model proofs remain separate research, not launch features.

[Live explorer](https://scan.gh0st.fyi/) · [Public RPC](https://rpc.gh0st.fyi/) · [Receipt evidence](network/evidence/live-mainnet-20261118/) · [Research history](../HISTORY.md)

## Network

| Setting | Verified value |
| --- | --- |
| Chain | GL3, chain ID **4663001** (`0x4726d9`) |
| Parent | Robinhood, chain ID **4663** |
| Native currency | **GH0ST**, 18 decimals |
| RPC | `https://rpc.gh0st.fyi/`, public signed-transaction submission enabled |
| Explorer | `https://scan.gh0st.fyi/`, actual RPC blocks and transactions |
| Bridge destination | `https://bridge.gh0st.fyi/` — requested dedicated domain; dedicated publication and DNS checks in progress at R60; the working bridge is already published at [gh0st.fyi/gl3/bridge/](https://gh0st.fyi/gl3/bridge/) |
| Chain introduction | `https://l3.gh0st.fyi/` — new animated introduction and FAQ in progress at R60 |
| Parent backing token | `0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559` |
| Canonical genesis | `0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483` |

Native GH0ST is created through backed bridge deposits; the child genesis allocates zero tokens. The launch deposit is exactly **1,000,000 GH0ST**, replacing the earlier 100-token proposal. Native wallet balances subsequently change with transaction fees and treasury receipts. The separate 100,000-GH0ST validator stake is on Robinhood and is not child circulating supply.

## Confirmed launch checks

All 27 exact deployment transactions succeeded, with actual combined fees of **0.001627693426576 ETH**. The independent receipt-derived audit binds runtime code, proxy links, authorities and the actual nonempty genesis. The original failed empty-genesis comparison remains preserved; no deployment transaction was resent.

The user completed the subsequent nine-action local signing flow: exact parent allowance and deposit, followed by seven child fee, treasury and renunciation calls. Canonical receipts and final readbacks confirm the sole child owner is the zero address, no native minters, no scheduled native management or ArbOS upgrade, minimum fee of `10000000000000` base units, and all three fee recipients set to the reviewed cold treasury. The cold key stays off the server.

The public RPC independently returns the exact chain ID and genesis and forwards signed transactions through guarded methods. The explorer displays real blocks. It is a lightweight RPC explorer; indexed address history and source verification are not represented as implemented. Public routes do not expose admin/debug methods or unlocked wallets.

## Blocks and activity

The configured block-speed target is **100 ms**, approximately ten blocks per second when transaction demand permits. Nitro produces blocks for actual messages/transactions; an idle chain does not continuously create empty blocks. This is a target, not a measured throughput guarantee.

A separate, clearly labelled demo activity worker is being prepared on the existing pod, with counter, NFT and test-token examples. It will use a dedicated finite wallet, persisted transaction intents and balance/pending-queue guards. At R60 no demo wallet is funded and no demo transaction is claimed. The running chain is not stopped or reconfigured for this work.

## Withdrawals and trust

The project validator derives and checks child execution and posts an ordinary assertion with genuine history before using its designated fast-confirm authority. The normal route has no configured minimum assertion waiting period. A claim still needs a confirmed withdrawal root, parent processing and transaction fees. The user explicitly retained Robinhood safe/finalized checks; these can add substantial latency.

**Project-run fast confirmation. GH0ST-operated keys confirm withdrawal roots. ZK verification is not live.** Parent upgrade authority remains with the reviewed cold account. This is an operator-trusted launch, not an operator-independent exit guarantee.

The exact-profile private rehearsal completed a nonzero payout across a verified persisted-state restart, including actual unauthorized, altered-amount and replay reverts. The live validator has posted a genuine SDK assertion and `fastConfirmAssertion` transaction. That observed assertion retains the genesis child header and empty send root; it does not establish confirmation of all subsequent setup blocks or a live nonzero mainnet withdrawal payout.

## Operations and evidence

- [Actual deployment packet](deployment-packet/receipt-derived/packet.json)
- [Nine setup receipts and live public readback](network/evidence/live-mainnet-20261118/)
- [Live poster and genuine fast-confirmation evidence](node/live-readonly/run-02/)
- [Private bridge lifecycle](bridge-rehearsal/README.md)
- [Node and validator](node/)
- [Pod failure and recovery](RECOVERY.md)
- [AEP accounting plan](network/aep-accounting-plan.md)

The user accepted the reviewed AEP terms: 10% of positive protocol net revenue; the native-GH0ST remittance destination remains unconfirmed and no payment is claimed. A single pod and persistent volume are running; encrypted operator recovery is verified off-pod. Automatic failover and a replacement-pod recovery rehearsal of the populated chain are not claimed. No automatic top-ups are configured.

All CPU builds/tests run on Runpod. Public-site work and demo preparation must leave the live chain running. Historic fee-capped proposals and earlier failed experiments remain dated evidence; the user subsequently authorized fresh market gas without an aggregate fee ceiling.
