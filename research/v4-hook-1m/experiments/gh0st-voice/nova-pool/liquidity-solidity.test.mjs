// Independent differential checks against the pinned Uniswap v4 Solidity libraries.
// Ganache is in-process and separate from the integration fixture's Hardhat network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';
import { buildLiquidityPlan, quoteExactInput, quoteExactInputSingleStep, amountsForLiquidity, Q96, WAD } from './liquidity-plan.mjs';

const research = fileURLToPath(new URL('../../../', import.meta.url));
const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {SwapMath} from "@uniswap/v4-core/src/libraries/SwapMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TickBitmap} from "@uniswap/v4-core/src/libraries/TickBitmap.sol";
contract NovaLiquidityMathOracle {
    using TickBitmap for mapping(int16 => uint256);
    mapping(int16 => uint256) private bitmap;
    int24 public immutable lower;
    int24 public immutable upper;
    constructor(int24 a, int24 b) { lower = a; upper = b; bitmap.flipTick(a, 1); bitmap.flipTick(b, 1); }
    function step(uint160 p, uint160 target, uint128 L, uint256 input, uint24 fee)
      external pure returns (uint160, uint256, uint256, uint256) {
      return SwapMath.computeSwapStep(p, target, L, -int256(input), fee);
    }
    function amounts(uint160 p, uint128 L) external view returns(uint256 a0, uint256 a1) {
      a0 = SqrtPriceMath.getAmount0Delta(p, TickMath.getSqrtPriceAtTick(upper), L, true);
      a1 = SqrtPriceMath.getAmount1Delta(TickMath.getSqrtPriceAtTick(lower), p, L, true);
    }
    function quote(uint160 p, int24 tick, uint128 L, uint256 input, uint24 fee, bool zeroForOne)
      external view returns(uint160 next, uint256 used, uint256 out, uint256 paidFee, int24 finalTick, uint256 steps) {
      uint160 limit = TickMath.getSqrtPriceAtTick(zeroForOne ? lower : upper);
      next = p;
      uint256 remaining = input;
      while(remaining != 0 && next != limit) {
        (int24 nextTick,) = bitmap.nextInitializedTickWithinOneWord(tick, 1, zeroForOne);
        uint160 nextTickPrice = TickMath.getSqrtPriceAtTick(nextTick);
        uint256 amountIn; uint256 amountOut; uint256 feeAmount;
        (next, amountIn, amountOut, feeAmount) = SwapMath.computeSwapStep(
          next, SwapMath.getSqrtPriceTarget(zeroForOne, nextTickPrice, limit), L, -int256(remaining), fee);
        remaining -= amountIn + feeAmount;
        out += amountOut; paidFee += feeAmount;
        if(next == nextTickPrice) tick = zeroForOne ? nextTick - 1 : nextTick;
        else tick = TickMath.getTickAtSqrtPrice(next);
        steps++;
      }
      return(next, input - remaining, out, paidFee, tick, steps);
    }
}`;

test('BigInt pricing and exact-input quotes match pinned v4 Solidity libraries', async t => {
  const compilation = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
    sources: { 'NovaLiquidityMathOracle.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  }), { import: name => {
    try { return { contents: readFileSync(path.join(research, 'node_modules', name), 'utf8') }; }
    catch (error) { return { error: String(error) }; }
  } }));
  assert.deepEqual((compilation.errors ?? []).filter(e => e.severity === 'error'), []);
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' },
    wallet: { deterministic: true }, miner: { blockGasLimit: 30_000_000 } });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  try {
    const p = buildLiquidityPlan();
    const artifact = compilation.contracts['NovaLiquidityMathOracle.sol'].NovaLiquidityMathOracle;
    const oracle = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, await provider.getSigner()).deploy(p.tick_lower, p.tick_upper);
    await oracle.waitForDeployment();
    const position = { sqrtPriceX96: p.initial_sqrt_price_x96, sqrtPriceLowerX96: p.sqrt_price_lower_x96,
      sqrtPriceUpperX96: p.sqrt_price_upper_x96, liquidity: p.liquidity, fee: 3000 };
    await t.test('deposit rounding consumes exactly predicted ETH and N0VA', async () => {
      const actual = await oracle.amounts(position.sqrtPriceX96, position.liquidity);
      const expected = amountsForLiquidity(position.sqrtPriceX96, position.sqrtPriceLowerX96, position.sqrtPriceUpperX96, position.liquidity);
      assert.equal(actual[0], expected.amount0);
      assert.equal(actual[1], expected.amount1);
    });
    await t.test('one-step fee, input and output rounding agrees including tiny input', async () => {
      for (const zeroForOne of [true, false]) for (const fee of [0, 1, 3000, 999999]) {
        for (const amountIn of [1n, 17n, 10n ** 15n, 3n * WAD]) {
          const expected = quoteExactInputSingleStep({ ...position, amountIn, zeroForOne, fee });
          const actual = await oracle.step(position.sqrtPriceX96, zeroForOne ? position.sqrtPriceLowerX96 : position.sqrtPriceUpperX96,
            position.liquidity, amountIn, fee);
          assert.deepEqual([...actual], [expected.sqrtPriceX96, expected.netAmountIn, expected.amountOut, expected.feeAmount]);
        }
      }
    });
    await t.test('whole-position swaps agree across empty tick bitmap words in both directions', async () => {
      for (const zeroForOne of [true, false]) for (const amountIn of [1n, 10n ** 12n, 10n ** 15n, WAD / 100n, WAD / 10n, WAD, 10n * WAD, 1000000n * WAD]) {
        const expected = quoteExactInput({ ...position, amountIn, zeroForOne });
        const actual = await oracle.quote(position.sqrtPriceX96, p.initial_tick, position.liquidity, amountIn, 3000, zeroForOne);
        assert.deepEqual([...actual], [expected.sqrtPriceX96, expected.amountIn, expected.amountOut, expected.feeAmount, BigInt(expected.currentTick), BigInt(expected.steps)]);
      }
    });
    await t.test('no initial external token allocation is required for immediate reselling after purchase', async () => {
      const initialVaultDust = p.locked_dust_nova_wei;
      const initialPoolTokens = p.active_principal_nova_wei;
      assert.equal(initialVaultDust + initialPoolTokens, p.total_supply_wei);
      const before = { buyerTokens: 0n, poolTokens: initialPoolTokens, vaultTokens: initialVaultDust };
      assert.equal(before.buyerTokens, 0n);
      const buy = quoteExactInput({ ...position, amountIn: WAD / 100n, zeroForOne: true });
      const afterBuy = { buyerTokens: buy.amountOut, poolTokens: initialPoolTokens - buy.amountOut, vaultTokens: initialVaultDust };
      assert(afterBuy.buyerTokens > 0n);
      assert.equal(afterBuy.buyerTokens + afterBuy.poolTokens + afterBuy.vaultTokens, p.total_supply_wei);
      const sell = quoteExactInput({ ...position, sqrtPriceX96: buy.sqrtPriceX96, currentTick: buy.currentTick,
        amountIn: afterBuy.buyerTokens, zeroForOne: false });
      const actual = await oracle.quote(buy.sqrtPriceX96, buy.currentTick, position.liquidity, afterBuy.buyerTokens, 3000, false);
      assert.equal(actual[2], sell.amountOut);
      assert(sell.amountOut > 0n && sell.amountOut < WAD / 100n);
      assert.equal(initialPoolTokens - buy.amountOut + sell.amountIn + initialVaultDust, p.total_supply_wei);
    });
  } finally {
    await provider.destroy(); await rpc.disconnect();
  }
});
