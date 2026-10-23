# GH0ST / native ETH liquidity

The selected pool is native ETH / GH0ST on Robinhood Chain mainnet (4663), with the sampled sentence hook `0x25E6366C490225358625d941C7B147360b155040`. Its pool ID is `0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7`. Native ETH is currency0 and GH0ST (`0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`) is currency1. The proposed static LP fee is 0.30% and tick spacing is 60.

The user selected **$100 of each token, $200 total, with gas additional**. The signing page proposes full-range ticks `[-887220, 887220]`. It uses the canonical PositionManager `0x58daec3116aae6d93017baaea7749052e8a04fa7` and Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`, checked against live bytecode and PositionManager getters. See [Uniswap's deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments) and [position minting guide](https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/mint-position).

## Signing flow

Open the [private signing page](https://gh0st-v4-signing.netlify.app), log in to the Netlify team, load the reviewed deployment plan, and connect the confirmed wallet. Complete the 57 data-shard deployments, model deployment and hook deployment. Each transaction requires a wallet signature; existing contracts are accepted only when their runtime hashes match.

Once the model and hook are verified, refresh the liquidity quote. The page reads the ETH/GH0ST source pool from the supplied GMGN market's linked Pons pool and obtains ETH/USD from the [Coinbase spot endpoint](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices). The source Pons pool is only a price reference. Funds go into the separate sentence-hook pool above.

Review the displayed token caps and full-range position. Approve the exact GH0ST cap to Permit2, then the exact cap to PositionManager with a 15-minute expiry. An existing different ERC20 allowance is first reset to zero. Finally, sign the liquidity transaction; it atomically initializes the pool if necessary and mints a position NFT to the confirmed wallet. The helper checks the receipt, NFT owner, pool key and position liquidity. It prevents a second mint while the outcome of an earlier transaction is unresolved.

All transaction gas limits are **150% of a fresh estimate**. The wallet supplies current network fee pricing. Higher gas limits do not force all reserved gas to be consumed.

The fixed liquidity amount is chosen conservatively over a 0.5% price band with hard maximums on both tokens. Actual spending can be slightly below $100 per side; unused native ETH is refunded and unspent GH0ST stays in the wallet. USD amounts are quote-time estimates. Market prices can change before settlement. Quotes older than five minutes must be refreshed, and transactions expire after 15 minutes.

## Recorded preflight

At block **96,049,862** (2026-10-23 15:38:27 UTC), none of the 57 planned data shards, the model or hook existed on mainnet. The intended pool was uninitialized with zero liquidity. Publishing the signing page does not deploy contracts or add liquidity.

The recorded source-pool price was 18,113,539.696258702829761879 GH0ST per ETH. The separate ETH/USD observation was $2,398.48 at 15:39:02 UTC. At those prices, the maximums were **0.041693072279110103 ETH** and **755,209.119786644159207576 GH0ST**. These are historical reference amounts, not a current quote. Exact evidence is in `ghost-eth-liquidity-preflight.json`.

A complete Alchemy-backed mainnet fork at block **96,065,017** passed all **59** actual CREATE2 deployments with matching runtime hashes, two exact-cap approvals, and the canonical PositionManager initialize-and-mint. The isolated position received 0.041588708980812855 ETH and 753,318.731040104642230998 GH0ST, about $99.75 per side under the reference prices. Its owner, pool, range, liquidity, refund and allowance revocations were verified. All 64 transactions were local simulations; no mainnet transactions were sent. See `ghost-eth-liquidity-fork-validation.json`. Earlier attempts against the public RPC stopped on unavailable historical state; the Alchemy run supersedes that incomplete result.

Four direct-transfer and transferFrom checks against the actual GH0ST token on an isolated local fork credited exactly the requested amount, including transfers into and out of PoolManager. This supports compatibility at the observed state; it does not prove every future token behavior. The GMGN/Pons venue's displayed fee must not be assumed to be this new pool's fee.

## Reproduction

`node scripts/prepare-ghost-eth-pool.mjs` performs read-only deployment and pool-state checks. It records configured USD intent but does not fix a market price or broadcast transactions. `deployment/liquidity-plan.js` contains the unsigned calldata and exact integer math used by the browser. Run `npm run test:wallet` for the deployment, amount-cap, calldata and browser-flow checks.
