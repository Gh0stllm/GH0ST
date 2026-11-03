import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlatformToken} from './platform-token.js';

const ghost = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';

test('the exact mainnet GH0ST address matches regardless of letter case', () => {
  assert.equal(isPlatformToken('mainnet', ghost), true);
  assert.equal(isPlatformToken('mainnet', ghost.toLowerCase()), true);
});

test('other networks, lookalike addresses and token names are excluded', () => {
  for (const network of ['testnet', 'ethereum', undefined]) assert.equal(isPlatformToken(network, ghost), false);
  for (const address of [ghost.slice(0,-1)+'8', ghost+'0', ' '+ghost, 'GH0ST', undefined]) assert.equal(isPlatformToken('mainnet', address), false);
});
