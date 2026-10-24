# N0VA genesis liquidity: local mathematical plan

This plan does not call an RPC, create an account, sign, or broadcast. It is a deterministic scenario at **$2,359.235 per ETH**, an explicit input rather than a live-price claim. Dollar values change when ETH changes. The target **$25,000 FDV** means the initial marginal N0VA price multiplied by the fixed 1,000,000-token supply; it is not $25,000 of backing or an exit guarantee.

## Funding and immutable position parameters

| Parameter | Value |
|---|---|
| Currency 0 | Native ETH, 18 decimals |
| Currency 1 | N0VA ERC20, 18 decimals |
| Total N0VA supply | 1,000,000 |
| ETH funding | 1 ETH |
| Swap fee | 3,000 pips = 0.3% |
| Tick spacing | 1; v4 permits spacing independent of fee |
| Initial square-root price, Q96 | `24338576879254872154097982964888` |
| Initial tick | `114555` |
| Lower / upper position ticks | `68471` / `116331` |
| Liquidity | `3616332570012485039524` |
| Active principal ETH | **1 ETH exactly** |
| Active principal N0VA | **999,999.673447628178549341** |
| Permanently locked N0VA dust | **0.326552371821450659** |
| Unused ETH | **0** |

All 1,000,000 N0VA go to the immutable vault. The distinction between active pool principal and non-withdrawable rounding dust is disclosed above. The leftover is approximately **0.00003266%** of supply, not an allocation to the creator. Direct `PoolManager` positions do not require an NFT; a vault can own an unwithdrawable position directly and expose no removal/collection route.

## Why the range is asymmetric

Uniswap stores the price as `currency1/currency0`: N0VA per ETH. At the stated initial dollar price that ratio is `94,369.4`. A N0VA **buy** supplies ETH, takes N0VA, and moves the square-root price **down**. A N0VA **sell** supplies N0VA, takes ETH, and moves it **up**.

The initial spot price is encoded independently of ticks with integer square root:

```
P = supply * ETHUSD / targetFDV
sqrtPriceX96 = floor(sqrt(P * 2^192))
```

For current square-root price `S`, lower endpoint `a`, upper endpoint `b`, and liquidity `L`, active principal is:

```
ETH  = ceil(L * Q96 * (b - S) / (b * S))
N0VA = ceil(L * (S - a) / Q96)
```

The solver scans 401 possible lower ticks near a 100-times initial-FDV upper price, solves the corresponding upper endpoint analytically, tries both adjacent upper ticks, and minimizes fractional unused funding. Its chosen bounds correspond to:

- N0VA maximum FDV at the buy-side boundary: **$2,507,622.329497**.
- N0VA minimum FDV at the sell-side boundary: **$20,933.057085**.
- Approximately **106.44727935 gross ETH** would buy the position to its upper-N0VA-price boundary, if no intervening sales occur and ETHUSD is unchanged.
- Hypothetically, approximately **103,440.285596 gross N0VA** sold at the initial state reaches the ETH-exhaustion boundary. This is a stress calculation: no external wallet has that initial token inventory.

At either endpoint the only position has no remaining active liquidity in that direction. The application must protect users from partial fills, and additional liquidity or a new range would be needed for trading farther in that direction. Locked liquidity is not infinite liquidity.

## No external holders at genesis does not prevent later selling

If every token is allocated to the locked vault and pool as specified, no external wallet starts with N0VA. However, **the first buyer can sell immediately after buying**, including in the same block or transaction through a composable router. Buys add ETH to the pool before those tokens are resold. A sell path must therefore work correctly from the first purchase onward.

These fresh-state quotes include the 0.3% pool fee and exact integer rounding; network gas is extra:

| ETH paid to buy | N0VA received | ETH returned by immediately selling all received N0VA |
|---:|---:|---:|
| 0.001 | 94.078324118508 | 0.000994009252532509 |
| 0.01 | 940.066756655916 | 0.009940115234076145 |
| 0.1 | 9,329.614805639296 | 0.099403404391763264 |
| 1 | 86,740.099253687458 | 0.994241889155761609 |

The JSON contains additional hypothetical initial sell stress quotes. These are deliberately labelled hypothetical because they should not be simulated by minting extra real N0VA into wallets in the production fixture. Tests can buy their token inventory first; low-level arithmetic stress tests can evaluate other states independently.

## Verification scope

`liquidity-plan.test.mjs` tests TickMath known values and inversion, integer square-root boundaries, exact price encoding, both funding caps, maximal liquidity, 100 varied funding/range properties, immediate buy/sell round trips, boundary exhaustion, and invalid inputs. All eight tests pass.

`liquidity-solidity.test.mjs` compiles a separate local oracle using the installed Uniswap v4-core 1.0.2 libraries. It matches the JavaScript results to Solidity `SqrtPriceMath`, `SwapMath`, and `TickBitmap`, including tiny input, fee rates of 0 / 1 / 3,000 / 999,999 pips, both trade directions, empty bitmap-word crossings, range exhaustion, and an immediate buyer resale. Its five tests pass, with 50 direct Solidity comparisons. The swap helper mirrors the actual pool's separate rounding at each bitmap word; treating the whole position as one step can differ by a few wei. These quotes assume the local pool's protocol fee is zero.

All arithmetic that sets prices, budgets, ticks, and token amounts uses BigInt; decimal strings are display values. The deployment fixture must additionally match principal amounts and swap outputs against the actual local Uniswap v4 `PoolManager`. This document alone is not an integration execution proof or an independent audit.
