import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeSlot0, rateAndVirtualReserves } from './read-market.mjs';

test('native ETH/token rate direction and virtual reserves use exact Q96 integer math', () => {
  const Q96 = 1n << 96n, unit = 10n ** 18n;
  assert.deepEqual(rateAndVirtualReserves(2n * Q96, 2n * unit), {
    gh0stPerEthX18: 4n * unit, virtualEthWei: unit, virtualGh0stUnits: 4n * unit,
  });
  assert.throws(() => rateAndVirtualReserves(0n, 1n));
  assert.throws(() => rateAndVirtualReserves(1n, 0n));
});
test('Uniswap v4 slot0 decodes signed ticks without corrupting price or fees', () => {
  const price = 123456789n;
  const word = price | (0xffffffn << 160n) | (42n << 184n) | (1000n << 208n);
  assert.deepEqual(decodeSlot0(word), { sqrtPriceX96: price, tick: -1, protocolFee: 42, lpFee: 1000 });
});
test('project-run bond option remains unselected and keeps chess allocations separate', () => {
  const option = JSON.parse(readFileSync(new URL('./bond-option.json', import.meta.url)));
  assert.equal(option.selected, false);
  assert.equal(option.SDKDefaultReference.universalProtocolMinimum, false);
  assert.equal(option.pilotOption.baseStakeUnits, null);
  assert.equal(option.pilotOption.miniStakeValues, null);
  assert.equal(option.guards.GH0STTransferAuthorizedByThisFile, false);
  assert.equal(option.guards.chessPrizeTreasuryRepurposed, false);
  assert.equal(option.guards.chessRewardOrEntryAmountsChanged, false);
});
