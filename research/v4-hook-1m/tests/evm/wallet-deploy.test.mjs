import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ethers from 'ethers';

const source = readFileSync(new URL('../../deployment/wallet-deploy.js', import.meta.url), 'utf8');
const planBytes = readFileSync(new URL('../../deployment/robinhood-mainnet-plan.json', import.meta.url));
const plan = JSON.parse(planBytes);

function harness() {
  const elements = new Map();
  const handlers = new Map();
  const state = { chain: '0x1237', accounts: [plan.sender.address], sends: [], deployed: new Map(),
    fetchBytes: planBytes, fetchStatus: 200, fetchCalls: [] };
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', files: [], disabled: true, value: 0,
      addEventListener: (event, fn) => handlers.set(`${id}:${event}`, fn) });
    return elements.get(id);
  };
  const signer = {
    getAddress: async () => plan.sender.address,
    estimateGas: async () => 5_000_000n,
    sendTransaction: async request => {
      state.sends.push(request);
      const entry = plan.transactions.find(row => row.unsigned_transaction.data === request.data);
      state.deployed.set(entry.predicted_address.toLowerCase(), `runtime:${entry.order}`);
      return { hash: `0x${'01'.repeat(32)}`, wait: async () => ({ status: 1 }) };
    },
  };
  class Provider {
    async send(method) {
      if (method === 'eth_chainId') return state.chain;
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return state.accounts;
      throw Error(`Unexpected method ${method}`);
    }
    async getSigner() { return signer; }
    async getCode(address) {
      if (address.toLowerCase() === plan.dependencies.pool_manager.toLowerCase()) return 'manager-code';
      if (address.toLowerCase() === plan.dependencies.create2_deployer.toLowerCase()) return 'factory-code';
      return state.deployed.get(address.toLowerCase()) ?? '0x';
    }
    async getTransactionReceipt() { throw Error('Unexpected pending transaction lookup'); }
  }
  const hash = value => value === 'manager-code' ? plan.dependencies.pool_manager_code_hash
    : value === 'factory-code' ? plan.dependencies.create2_deployer_code_hash
    : typeof value === 'string' && value.startsWith('runtime:')
      ? plan.transactions[Number(value.slice(8))].runtime_code_hash : ethers.keccak256(value);
  const saved = new Map();
  const context = vm.createContext({ document: { getElementById: element }, window: { ethereum: {} },
    ethers: { ...ethers, BrowserProvider: Provider, keccak256: hash }, TextDecoder, Uint8Array,
    fetch: async (url, options) => {
      state.fetchCalls.push({ url, options });
      return { ok: state.fetchStatus === 200, status: state.fetchStatus,
        arrayBuffer: async () => Uint8Array.from(state.fetchBytes).buffer };
    },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } });
  vm.runInContext(source, context, { filename: fileURLToPath(new URL('../../deployment/wallet-deploy.js', import.meta.url)) });
  return { state, element,
    async upload(bytes = planBytes) {
      element('plan').files = [{ arrayBuffer: async () => Uint8Array.from(bytes).buffer }];
      await handlers.get('plan:change')();
    },
    async click(id) { await handlers.get(`${id}:click`)(); },
  };
}

test('wallet accepts only the exact reviewed plan and discards a previously loaded plan on mismatch', async () => {
  const app = harness();
  await app.upload();
  assert.equal(app.element('error').textContent, '');
  assert.equal(app.element('connect').disabled, false);
  const altered = structuredClone(plan);
  altered.transactions[0].unsigned_transaction.data += '00';
  const entry = altered.transactions[0];
  entry.init_code_hash = ethers.keccak256(`0x${entry.unsigned_transaction.data.slice(66)}`);
  entry.predicted_address = ethers.getCreate2Address(plan.dependencies.create2_deployer, entry.salt, entry.init_code_hash);
  await app.upload(Buffer.from(JSON.stringify(altered)));
  assert.match(app.element('error').textContent, /differs from the reviewed deployment/);
  assert.equal(app.element('connect').disabled, true);
  assert.equal(app.element('deploy').disabled, true);
  assert.equal(app.state.sends.length, 0);
});

test('reviewed-plan button loads exact same-origin bytes without connecting or signing', async () => {
  const app = harness();
  await app.click('load-reviewed');
  assert.equal(app.element('error').textContent, '');
  assert.equal(app.element('connect').disabled, false);
  assert.equal(app.element('deploy').disabled, true);
  assert.equal(app.state.sends.length, 0);
  assert.equal(app.state.fetchCalls.length, 1);
  assert.equal(app.state.fetchCalls[0].url, './robinhood-mainnet-plan.json');
  assert.equal(app.state.fetchCalls[0].options.cache, 'no-store');
  assert.equal(app.state.fetchCalls[0].options.credentials, 'same-origin');
});

test('reviewed-plan button rejects substituted bytes and clears old plan after failed fetch', async () => {
  const app = harness();
  await app.upload();
  app.state.fetchBytes = Buffer.from(JSON.stringify({ ...plan, chain_id: 1 }));
  await app.click('load-reviewed');
  assert.match(app.element('error').textContent, /differs from the reviewed deployment/);
  assert.equal(app.element('connect').disabled, true);
  await app.upload();
  app.state.fetchStatus = 404;
  await app.click('load-reviewed');
  assert.match(app.element('error').textContent, /Unable to load the reviewed plan/);
  assert.equal(app.element('connect').disabled, true);
  assert.equal(app.state.sends.length, 0);
});

test('wallet refuses chain or selected account changes before sending', async () => {
  const app = harness();
  await app.upload();
  await app.click('connect');
  assert.equal(app.element('error').textContent, '');
  app.state.accounts = ['0x0000000000000000000000000000000000000001'];
  await app.click('deploy');
  assert.match(app.element('error').textContent, /confirmed deployment wallet/);
  assert.equal(app.state.sends.length, 0);
  app.state.accounts = [plan.sender.address];
  app.state.chain = '0x1';
  await app.click('deploy');
  assert.match(app.element('error').textContent, /Robinhood Chain/);
  assert.equal(app.state.sends.length, 0);
});

test('one user click sends only the next pinned zero-value CREATE2 deployment', async () => {
  const app = harness();
  await app.upload();
  await app.click('connect');
  await app.click('deploy');
  assert.equal(app.element('error').textContent, '');
  assert.equal(app.state.sends.length, 1);
  const sent = app.state.sends[0];
  assert.equal(sent.from, plan.sender.address);
  assert.equal(sent.to.toLowerCase(), plan.dependencies.create2_deployer.toLowerCase());
  assert.equal(sent.data, plan.transactions[0].unsigned_transaction.data);
  assert.equal(sent.value, 0n);
  assert.equal(sent.chainId, 4663n);
  assert.equal(sent.gasLimit, 7_500_000n);
  assert.equal(app.element('progress').value, 1);
});

test('resume skips only an exact runtime match and stops on conflicting code', async () => {
  const matching = harness();
  matching.state.deployed.set(plan.transactions[0].predicted_address.toLowerCase(), 'runtime:0');
  await matching.upload();
  await matching.click('connect');
  assert.equal(matching.element('error').textContent, '');
  assert.equal(matching.element('progress').value, 1);
  assert.equal(matching.state.sends.length, 0);

  const conflicting = harness();
  conflicting.state.deployed.set(plan.transactions[0].predicted_address.toLowerCase(), '0x6000');
  await conflicting.upload();
  await conflicting.click('connect');
  assert.match(conflicting.element('error').textContent, /Conflicting code/);
  assert.equal(conflicting.state.sends.length, 0);
});
