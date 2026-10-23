# GHOST / native ETH pool preparation

The selected pair is native ETH and the user-specified GHOST token at `0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`, on Robinhood Chain mainnet (4663). The proposed pool uses the existing planned sentence hook `0x25E6366C490225358625d941C7B147360b155040` and canonical PoolManager `0x8366a39cc670b4001a1121b8f6a443a643e40951`.

Native ETH is `currency0 = address(0)`; GHOST is `currency1`. WETH is not substituted. The disclosed proposal is a 0.30% static LP fee (`3000`) and tick spacing `60`. A different fee, tick spacing or hook identifies a different pool.

## Inputs still needed

The supplied GMGN market link identified the existing Pons ETH/GH0ST v4 pool. Its onchain reference was **17,333,971.896490555095140237106220669711550712 GH0ST per ETH** at block 96,020,379 (23 October 2026, 20:17:49 IST). `ghost-eth-market-reference.json` contains the exact price, pool key, fixed-block RPC requests and timestamp. Refresh this spot price before preparing the initialization signature; the saved observation is not a current execution quote.

Liquidity is separate. Before producing a liquidity transaction, the user must supply maximum ETH and GHOST amounts and a position range (or approve an explicit range proposal). The current configuration generates no token approvals, liquidity transfers, or swaps.

## Read-only readiness

```sh
node scripts/prepare-ghost-eth-pool.mjs
```

This reads chain identity, token metadata, expected model/hook code, and the exact proposed pool's initialization state. It writes `deployment/ghost-eth-pool-readiness.json`. Missing inputs remain null, and an uninitialized pool has no unsigned initialization transaction until an initial price is supplied.

After the user chooses a price:

```sh
node scripts/prepare-ghost-eth-pool.mjs --ghost-per-eth USER_CHOSEN_DECIMAL_PRICE
```

The price is parsed as an exact decimal fraction, adjusted for the token's live decimals and ETH's 18 decimals, and converted to `floor(sqrt(raw GHOST units / wei) * 2^96)` without floating-point arithmetic. Prices outside v4's allowed range are rejected. The script never broadcasts. It estimates initialization gas only after the expected model and hook exist.

Initialization fixes the starting price but adds no liquidity. Anyone can initialize a particular pool key, so its state must be rechecked before signing. An already initialized pool is reported and is never reinitialized by the preparer. [Uniswap's pool creation guide](https://developers.uniswap.org/docs/protocols/v4/guides/create-pool) documents native currency ordering, fee units, initial-price encoding, and the distinction between initialization and liquidity.

## Validation scope

`node --test tests/evm/ghost-eth-pool.test.mjs` checks decimal scaling, exact square-root rounding, invalid price rejection, pool ID encoding, and unsigned initialization calldata. It also initializes an actual v4 PoolManager pool and settles native/token liquidity in an isolated Cancun EVM, using clearly test-only prices, budgets and a test token. This validates the preparation mechanics, not the live token's transfer behavior or a chosen market price.

The existing model deployment plan and its pinned wallet helper remain unchanged. Pair setup will need a separate reviewed transaction after the missing price and liquidity decisions are supplied.

GMGN displayed 2.5% / 2.5% total tax. The source Pons pool uses LP fee zero plus a separate Pons hook; that supports a venue-fee explanation but does not establish that ordinary GH0ST transfers are untaxed. Verified token source was unavailable. Check actual token-transfer behavior before funding this separate pool.
