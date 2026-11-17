# GL3 · unsigned production packet

**The stock chain works; this packet prepares deployment on Robinhood without chess or a custom state transition. No public deployment or financial action has occurred.** The [operator profile](production-profile.json) deliberately remains unapproved for activation.

## Exact deployment route

Use official Nitro **3.12.2**, standard module root **`0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97`**, ArbOS 61, Robinhood parent **4663**, proposed child **4663001** and the existing eighteen-decimal `$GH0ST` token. The fresh parent [read](evidence/parent-input-read.json) rechecked its exact runtime pin. The child ID remains a proposal, not a reservation.

[The constructor builder](build-unsigned-plan.mjs) pins Nitro contracts `4341b132cfbdcc980ead03765ca5224ff6cb5d97`, verifies every consumed artifact and the genuine `0x4e59…956C` CREATE2 proxy runtime, and prepares a **fresh project namespace**. It accepts no unknown existing factory state. All twenty-six predicted component addresses were empty when quoted. The unaccepted zero-salt attempt and its twenty-two reverted estimates remain [separate evidence](evidence/attempt01-zero-salt-unaccepted/unsigned-deployment-plan.json).

The project namespace contains **25 factory dependencies** and **one fee pricer**. One later `createRollup` call creates the actual rollup proxies. The twenty-five dependencies cover twelve bridge/inbox/outbox templates, BridgeCreator, four one-step provers, OneStepProofEntry, challenge manager, two rollup logic contracts, UpgradeExecutor, validator-wallet creator, DeployHelper and the project-owned RollupCreator. Ownership/role configuration inside `createRollup` is distinct from later owner changes and operator funding.

This is a **self-deployed factory proposal**. Robinhood has no canonical factory in the reviewed official table, and upstream documents noncanonical self-deployment as unsupported. The generic CREATE2 proxy being present does not make Robinhood an upstream-supported Orbit deployment. [Factory documentation](https://docs.arbitrum.io/launch-arbitrum-chain/deploy/canonical-factory-contracts).

## Actual gas evidence

| Scope | Transactions | Gas |
|---|---:|---:|
| Fresh project factory components and manual pricer: actual read-only Robinhood constructor estimates | 26 | **74,414,869** |
| Genuine private Nitro-parent factory/template deployment rehearsal | 26 | 73,001,809 |
| Same rehearsal: proxy funding/bootstrap | 2 | 89,137 |
| Same rehearsal: actual `createRollup` | 1 | **7,327,990** |
| Complete private deployment rehearsal | 29 | **80,418,936** |

At the observed Robinhood gas price of **20,000,000 wei**, the twenty-six real constructor estimates correspond to **0.00148829738 ETH**. Adding the private rehearsal's `createRollup` gas at that same price gives an **illustration of 0.00163485718 ETH**. The latter is not a complete Robinhood quote: the actual factory is not deployed, so a real-chain estimate for its `createRollup` call is unavailable. Gas prices and poster costs can change. Validator collateral, token deposits, recurring batch fees, later owner transactions and licensing are excluded.

The private rehearsal paid **0.0080418936 fake ETH** at its configured price; that was not real ETH expenditure. [Per-category gas and exact private receipts](evidence/factory-gas-rehearsal.json), [all unsigned constructor actions and live quote results](evidence/unsigned-deployment-plan.json). Each live estimate observes current chain state independently; it does not simulate the entire prior unsigned transaction sequence or prove successful deployment.

## GH0ST pricing and genesis

[The manual type-1 pricer candidate](pricer/GH0STManualFeeTokenPricer.sol) implements `getExchangeRate()`, rejects zero owners/rates and transfers ownership in two steps. It provides no oracle, TWAP, automatic update, range guard or freshness guarantee. Its owner can change reimbursement pricing. Thirteen private cloud checks passed, including actual unauthorized/zero-value reverts, ownership handover and the exact conversion **`2,000,000 × 1e18` tokens/ETH × `1 gwei` / `1e18` = `2e15` GH0ST base units**. This is bounded regression evidence, not an independent contract audit. [Tests and receipt](pricer/test-report.json).

The [fresh nonselected market reference](market-reference/snapshot.json) records **72,114,538.846357481775124402 GH0ST/ETH** at block **116502191**. The exact-output quotation and reverse cross-check differ; neither establishes a production oracle or guarantees reimbursement after hook fees, slippage and changing liquidity. The initial manual rate and update policy remain unselected. [The final binder](bind-candidate-packet.mjs) refreshed only the changed pricer constructor estimate; the other twenty-five constructor quotes remain unchanged.

The canonical zero-allocation [candidate genesis](evidence/candidate-genesis.json) was generated on Runpod by the accepted pristine helper. Its block hash is **`0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483`**; its exact initial data-cost candidate is **`1448348398190243`**. The same nonzero value must be passed to `createRollup` for that genesis assertion to match. The source formula is **`(parent block.basefee + parent ArbGasInfo.getL1BaseFeeEstimate()) × rate / 1e18`**. Supply management is disabled and native allocation is zero; real child gas comes from parent-token deposits. These are unsigned economic/owner proposals, not an accepted deployed genesis. [Generator receipt](evidence/candidate-genesis-receipt.json).

## Routine protocol settings and the initial operator proposal

The proposed initial mode is **project-operated permissioned validation**, with no fast confirmer and no public node RPC. The owner proposal remains `0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`; no new administrator or custody scheme was selected. Allowed validators and collateral remain explicit choices. This mode depends on the project validators and is not equivalent to permissionless economic security. A private RPC does not restrict direct calls to a public canonical inbox.

The routine candidate timers use the pinned SDK's mainnet durations: **50,400 confirmation blocks**, **14,400 grace blocks**, **75 minimum assertion blocks**, and **201,600 AFK blocks**. Those use inherited Ethereum block-number semantics, not Robinhood's approximately 100 ms RPC heights. Direct EVM `NUMBER` calls on Robinhood agreed with Multicall and differed from RPC height; the short sample observed thirteen seconds per EVM block. The SDK documents a nominal twelve-second basis and deliberately requires explicit defaults for custom parent 4663. The AFK setting permits removal of a validator allowlist after sufficient inactivity. [Exact timing evidence](evidence/parent-evm-timing.json).

Standard challenge geometry is `2^26` block leaves, `2^19` big-step leaves, `2^23` small-step leaves and one big-step level. The [profile](production-profile.json) contains these candidates, standard inbox time bounds and the permissionless comparison. The SDK's **one WETH** collateral default is a reference, not a universal minimum, fee or approved bond.

## Exact remaining decisions and derived outputs

The missing human choices are: governance/factory/pricer custody and operator identities; the validator security choice and exact stake asset/base stake/mini-stakes; the manual rate/update policy and ETH operating reserve; and the applicable licensing arrangement. Existing proposals are not silently promoted to selections. The AEP/license requirement for this non-One/Nova parent remains unresolved; no terms were accepted. [License source](https://docs.arbitrum.io/launch-arbitrum-chain/overview/license).

The builder already supplies the exact `createRollup` ABI, all routine candidate fields and canonical genesis. Once those choices are supplied, the final calldata, RollupCreated addresses, deployment block and chain-info hashes are deterministic generation/receipt steps. They do not require inventing another protocol design. Public signing and activation remain separate review steps.

The production command is `/workspace/gl3/durable/bin/nitro --conf.file /workspace/gl3/mainnet/config/node.private.json`. State belongs in `/workspace/gl3/mainnet/data/{chain,config}`, using Pebble synchronous writes. Parent RPC and operator keystore references stay outside the public packet. The [bootstrap/supervisor lane](../withdrawal-recovery/launch-readiness/) consumes the hash-bound profile and refuses the current unapproved, incomplete configuration. It has not started a mainnet node. The 100 ms minimum block-spacing target is a sequencer setting, not a guarantee of public latency, finality or availability.
