// Pure validation tests: importing the worker does not instantiate providers or read keys.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { HERE } from '../scripts/build.mjs';
import { validateConfig } from '../scripts/worker.mjs';

const example = JSON.parse(fs.readFileSync(path.join(HERE, 'config/runtime.example.json')));
function validConfig() {
  const config = structuredClone(example);
  config.sessionId = '0x' + '12'.repeat(32);
  for (const [index, chain] of config.chains.entries()) {
    for (const [fieldIndex, field] of ['router', 'engine', 'root'].entries()) {
      chain[field] = '0x' + (index * 3 + fieldIndex + 1).toString(16).padStart(40, '0');
    }
  }
  return config;
}

test('fully populated configuration validates without any RPC or signing', () => {
  const config = validConfig(); assert.equal(validateConfig(config), config);
});
test('unconfigured example with null addresses is rejected', () => assert.throws(() => validateConfig(example)));
test('duplicate chains, endpoints and stage keys are rejected', () => {
  for (const field of ['chainId', 'eid', 'key']) {
    const config = validConfig(); config.chains[1][field] = config.chains[0][field];
    assert.throws(() => validateConfig(config), /Duplicate/);
  }
});
test('stage ordering must be contiguous', () => {
  const config = validConfig(); config.chains[2].stage = 4;
  assert.throws(() => validateConfig(config), /contiguous/);
});
test('zero and missing contract addresses are rejected', () => {
  for (const field of ['router', 'engine', 'root']) for (const value of [null, '0x' + '00'.repeat(20)]) {
    const config = validConfig(); config.chains[0][field] = value;
    assert.throws(() => validateConfig(config), /Unconfigured/);
  }
});
test('transaction gas cannot exceed 16777216 or be too small', () => {
  for (const gas of ['16777217', '100000', '-1']) {
    const config = validConfig(); config.chains[0].maxTransactionGas = gas;
    assert.throws(() => validateConfig(config), /gas ceiling/);
  }
});
test('RPC endpoints must be environment variable names', () => {
  for (const name of ['https://example.invalid/rpc', 'rpc key', 'abc', '1_RPC']) {
    const config = validConfig(); config.chains[0].rpcEnv = name;
    assert.throws(() => validateConfig(config), /environment variable/);
  }
});
test('negative fee budgets and invalid confirmation counts are rejected', () => {
  const fee = validConfig(); fee.chains[0].maxMessageFeeWei = '-1'; assert.throws(() => validateConfig(fee));
  const confirmation = validConfig(); confirmation.chains[0].confirmations = 0; assert.throws(() => validateConfig(confirmation));
});
