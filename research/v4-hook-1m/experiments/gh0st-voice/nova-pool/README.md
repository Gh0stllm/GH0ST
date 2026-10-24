# GH0ST N0VA-8M: fixed-supply token and locked hooked pool

**Local test candidate. Nothing has been deployed to mainnet.**

This adds a fixed-supply N0VA token, permanent liquidity vault, exact-pool inference hook and bounded native-ETH swap router around the selected 8,175,493-parameter model. The selected model weights are unchanged. This is a tested candidate, not an externally audited deployment release.

## Token and custody

`NovaToken` uses the pinned OpenZeppelin Contracts 5.0.2 ERC20 sources. Exactly 1,000,000 N0VA (18 decimals) are created once into `NovaLiquidityVault`. The public ABI contains standard ERC20 operations and a fixed-supply getter: no external mint, burn, owner, blacklist, tax, pause, upgrade, or administrative balance changes. Upstream source hashes and the MIT license are included under `contracts/vendor/`.

The vault permanently owns a direct Uniswap v4 liquidity position. There is no transferable LP NFT, withdrawal, collect-fees, rescue, arbitrary-call or ownership-transfer function. **Principal, accrued fees and rounding dust are all permanently locked.** This includes assets accidentally sent to the vault. One-time launch requires exactly 1 ETH and immutable pool settings; anyone funding it receives no management rights or refund.

## Initial liquidity and price

| Item | Local scenario |
| --- | ---: |
| Fixed total supply | 1,000,000 N0VA |
| Active token principal | 999,999.673447628178549341 N0VA |
| Token rounding dust locked in vault | 0.326552371821450659 N0VA |
| Active ETH principal | 1 ETH |
| ETH/USD scenario input | $2,359.235 |
| Initial N0VA price / total-supply valuation | $0.025 / $25,000 |
| Swap fee | 0.3% |
| Price range expressed as FDV | about $20,933 to $2,507,622 |

This is asymmetric concentrated liquidity. The quoted valuation is marginal price times supply, not cash backing. The scenario fixes an ETH/USD input; the contracts do not use a USD oracle or guarantee that dollar valuation. See [exact range and rounding](LIQUIDITY-MATH.md) and [machine-readable plan](liquidity-plan.json).

At genesis, no N0VA is allocated to the deployer, buyers or attackers: all supply is in the pool or locked vault dust. **The first buyer can nevertheless sell immediately.** The local test buys with 0.01 ETH, receives 940.066756655915728257 N0VA, and sells those tokens for 0.009940115234076145 ETH, before network gas. Earlier buys replenish the pool's ETH inventory. The range remains finite and partial fills are rejected by this router.

## Hook and trading protections

- The hook pins the exact ETH/N0VA pool key, fee, tick spacing, authorized initializer and opening price. Other pools cannot use this hook.
- Model hash, model code hash, vocabulary and response shapes are pinned and checked. Each successful trade emits one neural word; the 768-value recurrent state persists.
- The hook reads canonical on-chain state. User-supplied hook data cannot choose a state or make another pending trade stale.
- The router binds the same pool, uses explicit minimum output and deadline, requires full input execution, settles directly with PoolManager and has a reentrancy guard.
- Native settlement resets PoolManager's synced currency. A same-transaction pre-sync regression is tested.
- **As explicitly requested, failed inference reverts buys and sells atomically.** This preserves mandatory text generation but means a model fault or future gas repricing can stop trading. No admin bypass is installed.

Standard ERC20 transfers remain unrestricted. Other pools or venues can trade N0VA without this hook; only the designated pool enforces inference.

## Completed local validation

- **64 integration checks passed** using real Uniswap v4 PoolManager, the real model and all model-data contracts created by local transactions.
- **32 primary real-model buy/sell swaps**, plus 2 overlapping submitted orders, 2 reentrancy regression trades and 1 native-sync regression trade: **37 real-model words**.
- Maximum gas among the 32 primary swaps: **23,581,932**, below 32,000,000. Other successful transactions also ran with the 32M ceiling.
- Independent scalar reference matched every word, punctuation choice, all 768 state values and all 197 logits across the 32 primary swaps.
- Separate record verification checked model-state hashes, feature construction, fixed-supply conservation, unchanged LP liquidity and source digests.
- Fifteen bad-model modes were tested in both buy and sell directions, including reverts, gas exhaustion, malformed or oversized returns, invalid state/logits, and text/vocabulary mismatch. Every rejected trade preserved balances, pool and neural state.
- Token and liquidity test suites passed, including 50 exact comparisons against pinned Uniswap Solidity math.

See [summary](RESULTS.json), [integration records](integration-results.json), [independent neural proof](independent-neural-reference.json), [record verification](record-verification.json), [unaltered generated text](actual-transcript.txt) and [internal security review](SECURITY-REVIEW.md). Passing local tests does not establish complete security or mainnet readiness.

## Concurrent orders

[Local burst testing](LOAD-RESULTS.md) accepted 4, 8 and 16 queued buys, and 16 queued sells: 44/44 successful. Every 32M-gas local block held one swap. This measures queue handling, not parallel inference or mainnet throughput.

## Reproduce locally

Restore the selected model artifacts using the V8 publication restore tool first if needed. From `research/v4-hook-1m`, using its pinned dependencies:

```sh
node --test experiments/gh0st-voice/nova-pool/liquidity-plan.test.mjs experiments/gh0st-voice/nova-pool/liquidity-solidity.test.mjs experiments/gh0st-voice/nova-pool/token.test.mjs
node experiments/gh0st-voice/nova-pool/test-local.mjs
node experiments/gh0st-voice/nova-pool/test-local.mjs --load-only
experiments/gpt2/.venv/bin/python experiments/gh0st-voice/voice-v8/evm/reference.py --model-dir experiments/gh0st-voice/voice-v8/exports/grammar4m --report experiments/gh0st-voice/nova-pool/integration-results.json --out experiments/gh0st-voice/nova-pool/independent-neural-reference.json
node experiments/gh0st-voice/nova-pool/verify-records.mjs
```

The reference Python command requires the existing research environment with NumPy. Local simulations use only an unforked in-process chain 31337, default development accounts and no external RPC. The integration runner pins local base fees to zero solely to isolate token/ETH conservation checks; its gas units remain recorded, but its receipts are not fee quotes.

The downloaded repository stores the large integration record as `integration-results.json.gz`; restore with `gzip -dk integration-results.json.gz` from this folder before the record-verification command. Gzip changes no record contents. The local integration runner automatically selects the complete original `exports/grammar4m` or restored `exports/selected` model. For the Python reference command, use whichever of those folders contains the restored binaries. Both exports are bound to the same manifest digest.

No production deployment command is provided by this candidate.
