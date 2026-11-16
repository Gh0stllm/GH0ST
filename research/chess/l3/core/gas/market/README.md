# Parent-market evidence for GH0ST gas and the pilot bond

`read-market.mjs` reads Robinhood `4663` through the same read-only allowlist as the gas preflight. Run it with `--write` to refresh `snapshot.json`. The snapshot records the sampled block, block hash, block timestamp, contract runtime hashes, storage words, pool key, fees, and independent `eth_call` quotations. It never signs or submits a swap, approval, transfer, wrapping operation, contract deployment, or state override. Credential URLs never enter the report.

## What was verified

The main pool ID is `0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01`. Existing Watcher quotation source supplied its addresses as discovery hints. Current chain reads verify `PositionManager.poolKeys(bytes25)`, the full pool-ID hash, both currencies, manager references, hook registration, and the previously recorded manager/position-manager/quoter/hook runtime hashes. The pool is **native ETH / GH0ST**; its currency0 is `address(0)`. Aggregator “WETH” display labels do not change that fact.

The [official Robinhood token-contract list](https://docs.robinhood.com/chain/contracts/) identifies actual WETH as `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. Current RPC reads verify deployed runtime, `name=WETH`, `symbol=WETH`, 18 decimals, total supply, and the contract's native ETH balance. At the saved snapshot, total supply equaled that native balance. This is an identity and accounting snapshot, not a complete WETH implementation audit.

## Rate and liquidity

The saved pool spot was **112,830,781.49445351480608708 GH0ST per ETH**. The pricer's required 18-decimal value is `112830781494453514806087080`. This value comes from the on-chain square-root price using exact integer arithmetic, not an aggregator's displayed price. See `snapshot.json` for its exact block/time; it must be refreshed before any price selection.

Active liquidity implies **virtual** reserves of approximately **2.7562131923 ETH** and **310.985688455 million GH0ST** at that tick. These describe price curvature. They are **not** verified withdrawable balances or the pool's complete reserves. The v4 PoolManager is a singleton: its aggregate ETH and GH0ST balances span pools and must not be attributed wholly to this pool. Pool-specific position ranges and accrued-fee balances have not been enumerated here. Storage decoding follows [Uniswap's StateLibrary](https://github.com/Uniswap/v4-core/blob/main/src/libraries/StateLibrary.sol): pool mapping slot 6, liquidity offset 3, and packed Slot0.

The hook currently reports **150 basis points creator tax** and **100 basis points hook fee**. A read-only 0.001 ETH exact-input quote returned about **109,970.11297 GH0ST**. Independently, selling the spot-equivalent **112,830.78149 GH0ST** quoted only **0.000974646382077848 ETH**, about **2.535% below 0.001 ETH** after fees and impact. Transaction gas is additional. This demonstrates why a spot-only reimbursement rate can underfund the batch poster's eventual ETH conversion.

The reader also requests an exact-output quote and feeds its required input back through an independent exact-input quote. Read `exactInputCrossCheckRecoversRequestedETH`: a mismatch must not be treated as a guaranteed executable conversion, particularly with fee hooks. None of these simulations proves a future fill, locks liquidity, moves funds, or automatically prices the production pricer.

## Unselected manual-pricer proposal

The plausible initial lane is an explicitly reviewed owner-updated rate for a project-operated poster, with current spot and fee-inclusive sell quotations shown side by side. `initialExchangeRateX18` remains **null**. No spread, margin, numerical bond, or reimbursement rate has been silently selected. An exact-output quotation whose cross-check fails is ineligible as a standalone cost estimate.

The proposed snapshot age limit is **five minutes**, measured from the parent block timestamp. Proposed depth checking compares virtual ETH depth with a **0.001 ETH research quotation**, requiring at least **1,000 times** that reference before considering the quotation. This is an unselected engineering screening rule, **not a requirement to deposit 1 ETH**, a capital allocation, or a security guarantee. The saved observed ratio was about **2,756 times**. Successful fee-inclusive quotes, matching identities, current liquidity, and review of changes are also needed. A different intended posting cost requires recalculating the reference and depth screen.

This is **spot-price research, not a secure production oracle or TWAP**. One-block manipulation, stale prices, liquidity withdrawal, tick changes, taxes, and gas can invalidate it. A fee-inclusive quotient cannot be marketed as a risk-free exchange rate. A reviewed manual pricer still needs an owner/custody decision, update policy, and an approved operating reserve; an on-chain pricer that reverts on stale data can obstruct batch posting, so freshness enforcement and liveness need joint review.

## Bond asset option

The pinned SDK's v3.2 configuration defaults `stakeToken=getWethAddress(parent)` and `baseStake=1e18`. On a custom parent, the SDK needs `contracts.weth.address`; the canonical Robinhood WETH above supplies the asset identity. This **1 WETH is a configurable default**, not a universal minimum, deployment fee, or burn. The base-chain gas token and validator bond token are separate fields.

`bond-option.json` prepares a **project-run permissioned GH0ST-bond option**. Its `stakeToken` is the canonical parent GH0ST, while numeric `baseStake`, every `miniStakeValue`, validator identities, and final custody remain unselected. A smaller or volatile GH0ST bond offers less economic deterrence; a project-operated allowlist must state that trust model. The option neither repurposes chess prizes nor changes challenge periods or fast-confirmation settings. All assertion and challenge paths and the economic value of the chosen collateral require review before selection.

The user's removal of the former 100 ICP / 0.003 ETH L3 caps is reflected in the active gas policy. Historical spending remains recorded, no replacement finite cap is invented, and no auto top-up or new financial transaction is performed by these tools.

```sh
node research/chess/l3/core/gas/market/read-market.mjs --write
node --test research/chess/l3/core/gas/test.mjs research/chess/l3/core/gas/market/test.mjs
```

Pinned SDK references: [default stake configuration](https://github.com/OffchainLabs/arbitrum-chain-sdk/blob/9a34cbb6e0bb6bde760fab45fd51dfd589c877c4/src/createRollupPrepareDeploymentParamsConfig/v3.2.ts) and [custom-parent WETH lookup](https://github.com/OffchainLabs/arbitrum-chain-sdk/blob/9a34cbb6e0bb6bde760fab45fd51dfd589c877c4/src/utils/getWethAddress.ts). Parent evidence is in `snapshot.json`; discovery sites are not used as price authorities.
