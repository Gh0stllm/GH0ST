import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const template = fs.readFileSync(new URL('../scripts/deploy-template.html', import.meta.url), 'utf8');
const script = template.match(/<script>([\s\S]*?)<\/script>/)[1];
const PAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559';
const INDEX = '0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0';
const TOKEN_HASH = '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164';
const INDEX_HASH = '0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307';
const SHARD_ROOT = '0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2';
const PRIMARY_ARGS = [TOKEN, INDEX, TOKEN_HASH, INDEX_HASH, SHARD_ROOT];
const TRANSACTION_HASH = '0x' + 'ab'.repeat(32);
const PENDING_SUBMISSION = 'PENDING_OR_UNCERTAIN_SUBMISSION';
function creationData(args) {
  return '0x6000' + args.map(value => value.slice(2).padStart(64, '0')).join('');
}

// Deliberately synthetic runtimes and calldata: these tests exercise the actual
// wallet-helper script without RPC access, signatures or a generated bundle.
const fixturePlan = {
  status: 'UNSIGNED_NOT_DEPLOYED', chainId: 4663,
  metadataBaseURI: 'ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/',
  collectionURI: 'ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq',
  royaltyStandard: 'ERC-2981', royaltyBps: 350, royaltyRecipient: OTHER,
  constructorArgs: [...PRIMARY_ARGS, OTHER],
  maxSupply: 495, maxLifetimeMintsPerWallet: 3,
  burnTokensPerNFT: 200000, protocolShareOfMintTokens: 0,
  deploymentCalldataKeccak256: '0x' + '12'.repeat(32),
  transaction: { chainId: '0x1237', data: creationData([...PRIMARY_ARGS, OTHER]), value: '0x0' },
  pins: {
    tokenAddress: TOKEN, indexAddress: INDEX, tokenCodeHash: TOKEN_HASH,
    indexCodeHash: INDEX_HASH, shardMerkleRoot: SHARD_ROOT,
    tokenRuntime: '0x11', indexRuntime: '0x22',
  }
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(scenario = 'normal', plan = fixturePlan, saved = new Map()) {
  const nodes = new Map();
  const events = new Map();
  const requests = [];
  const broadcasts = [];
  const atIndex = deferred();
  const resumeIndex = deferred();
  const atSend = deferred();
  const resumeSend = deferred();
  const guardsAtSend = [];
  let selected = PAYER;
  let chain = scenario === 'wrong-network' ? '0x1' : '0x1237';
  let readIndex = false;

  const provider = {
    on(name, handler) { events.set(name, handler); },
    async request({ method, params }) {
      requests.push({ method, params });
      if (method === 'wallet_switchEthereumChain') { chain=params[0].chainId; events.get('chainChanged')?.(chain); return null; }
      if (method === 'eth_chainId') {
        const answer = chain;
        // No event is emitted: the submitted transaction must itself bind the
        // chain, even if the provider changes after its last chain response.
        if (readIndex && scenario === 'silent-chain-race') chain = '0x1238';
        return answer;
      }
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [selected];
      if (method === 'eth_getCode') {
        if (params[0] === TOKEN) return scenario === 'wrong-token-code' ? '0x33' : '0x11';
        assert.equal(params[0], INDEX);
        readIndex = true;
        atIndex.resolve();
        if (scenario === 'pause-index') await resumeIndex.promise;
        if (scenario === 'silent-account-change') selected = OTHER;
        if (scenario === 'account-change-event') {
          selected = OTHER;
          events.get('accountsChanged')?.([OTHER]);
          selected = PAYER;
          events.get('accountsChanged')?.([PAYER]);
        }
        if (scenario === 'chain-change-event') {
          chain = '0x1238';
          events.get('chainChanged')?.(chain);
          chain = '0x1237';
          events.get('chainChanged')?.(chain);
        }
        return scenario === 'wrong-index-code' ? '0x33' : '0x22';
      }
      if (method === 'eth_sendTransaction') {
        guardsAtSend.push(Array.from(saved.values()));
        atSend.resolve();
        if (scenario === 'pause-send') await resumeSend.promise;
        // Model a wallet enforcing the transaction's explicit chain binding.
        // Either authorized account could sign; the helper must catch a stale
        // selected account before requesting a transaction from it.
        if (params[0].chainId && BigInt(params[0].chainId) !== BigInt(chain)) {
          throw Error('Wallet rejected explicit chain mismatch.');
        }
        const rejectionCodes = { 'reject-4001': 4001, 'reject-string-4001': '4001', 'reject-action': 'ACTION_REJECTED' };
        if (Object.hasOwn(rejectionCodes, scenario) && guardsAtSend.length === 1) {
          throw Object.assign(Error('User rejected deployment signature.'), { code: rejectionCodes[scenario] });
        }
        broadcasts.push({ chain, transaction: params[0] });
        if (scenario === 'ambiguous-send') {
          throw Object.assign(Error('Connection lost after possible transaction submission.'), { code: 'NETWORK_ERROR' });
        }
        return scenario === 'invalid-hash' ? '0xabc' : TRANSACTION_HASH;
      }
      throw Error('Unexpected wallet request: ' + method);
    }
  };
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: '' });
        return nodes.get(id);
      }
    },
    localStorage: {
      getItem: key => saved.get(key) || null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: key => saved.delete(key),
    },
    window: { ethereum: scenario==='eip6963-only'||scenario==='no-provider'?undefined:provider, addEventListener(name,handler){if(scenario==='eip6963-only'&&name==='eip6963:announceProvider')handler({detail:{provider,info:{name:'Discovered wallet'}}});} },
    setInterval: () => 1,
    clearInterval() {}
  });
  vm.runInContext(script.replace('__DEPLOYMENT_PLAN__', JSON.stringify(plan)), context);
  return {
    nodes, requests, broadcasts, saved, guardsAtSend,
    atIndex: atIndex.promise,
    resumeIndex: resumeIndex.resolve,
    atSend: atSend.promise,
    resumeSend: resumeSend.resolve,
    selectAccount(value) { selected = value; },
    connect() { return nodes.get('connect').onclick(); },
    deploy() { return nodes.get('deploy').onclick(); },
    sends() { return requests.filter(request => request.method === 'eth_sendTransaction'); }
  };
}

test('deployment helper binds normal creation to the selected payer, chain, calldata and zero value', async () => {
  const h = harness();
  await h.connect();
  await h.deploy();
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.broadcasts[0].chain, '0x1237');
  const tx = h.broadcasts[0].transaction;
  assert.equal(tx.from, PAYER);
  assert.equal(tx.chainId, fixturePlan.transaction.chainId);
  assert.equal(tx.data, fixturePlan.transaction.data);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.to, undefined, 'deployment must be a creation transaction');
  assert.equal(h.nodes.get('royaltyRecipient').textContent, OTHER, 'display the explicit payout EOA, independently of payer');
  assert.deepEqual(h.guardsAtSend, [[PENDING_SUBMISSION]], 'persist the guard before opening the wallet prompt');
  assert.deepEqual(Array.from(h.saved.values()), [TRANSACTION_HASH], 'valid hash replaces the pending marker');
  const sendIndex = h.requests.findIndex(request => request.method === 'eth_sendTransaction');
  assert.equal(h.requests[sendIndex - 1].method, 'eth_accounts', 'recheck account immediately before sending');
});

test('deployment helper chain binding prevents a broadcast after a silent last-moment chain switch', async () => {
  const h = harness('silent-chain-race');
  await h.connect();
  await h.deploy();
  assert.equal(h.sends().length, 1, 'wallet may receive a chain-bound request');
  assert.equal(h.sends()[0].params[0].chainId, '0x1237');
  assert.equal(h.broadcasts.length, 0, 'wallet must reject the explicit chain mismatch');
  assert.deepEqual(Array.from(h.saved.values()), [PENDING_SUBMISSION], 'ambiguous provider failures retain the duplicate-request guard');
});

test('deployment helper catches silent account changes during code reads before requesting a signature', async () => {
  const h = harness('silent-account-change');
  await h.connect();
  await h.deploy();
  assert.equal(h.sends().length, 0);
  assert.match(h.nodes.get('status').textContent, /Wallet changed/);
});

test('deployment helper invalidates an account-change event even when the original account is restored', async () => {
  const h = harness('account-change-event');
  await h.connect();
  await h.deploy();
  assert.equal(h.sends().length, 0);
  assert.equal(h.nodes.get('deploy').disabled, true);
  assert.match(h.nodes.get('wallet').textContent, /Reconnect/);
});

test('deployment helper invalidates a chain-change event even when chain 4663 is restored', async () => {
  const h = harness('chain-change-event');
  await h.connect();
  await h.deploy();
  assert.equal(h.sends().length, 0);
  assert.equal(h.nodes.get('deploy').disabled, true);
  assert.match(h.nodes.get('status').textContent, /Wallet changed/);
});

for (const [scenario, label] of [['wrong-token-code', 'token'], ['wrong-index-code', 'index']]) {
  test('deployment helper rejects a substituted ' + label + ' runtime before requesting a signature', async () => {
    const h = harness(scenario);
    await h.connect();
    await h.deploy();
    assert.equal(h.sends().length, 0);
    assert.equal(h.saved.size, 0);
    assert.match(h.nodes.get('status').textContent, /bytecode differs/);
  });
}

test('deployment helper browser record prevents repeated deployment requests', async () => {
  const h = harness();
  await h.connect();
  await h.deploy();
  await h.deploy();
  assert.equal(h.sends().length, 1);
  assert.equal(h.nodes.get('deploy').disabled, true);
  assert.match(h.nodes.get('status').textContent, /already recorded/);
});

test('deployment helper locks Connect while deployment code checks are pending', async () => {
  const h = harness('pause-index');
  await h.connect();
  const pending = h.deploy();
  await h.atIndex;
  assert.equal(h.nodes.get('connect').disabled, true);
  const requestsBefore = h.requests.length;
  h.selectAccount(OTHER);
  await h.connect();
  assert.equal(h.requests.length, requestsBefore, 'busy Connect handler must not mutate the deployment account');
  h.resumeIndex();
  await pending;
  assert.equal(h.sends().length, 0, 'late account recheck must stop the pending transaction');
  assert.equal(h.nodes.get('connect').disabled, false);
});

test('deployment helper retains the guard after an ambiguous error following possible broadcast', async () => {
  const h = harness('ambiguous-send');
  await h.connect(); await h.deploy();
  assert.equal(h.sends().length, 1);
  assert.equal(h.broadcasts.length, 1, 'model a transaction accepted before the response was lost');
  assert.deepEqual(Array.from(h.saved.values()), [PENDING_SUBMISSION]);
  assert.equal(h.nodes.get('deploy').disabled, true);
  assert.match(h.nodes.get('status').textContent, /pending or its submission status is uncertain/i);
  await h.deploy();
  assert.equal(h.sends().length, 1, 'an uncertain request must never be automatically retried');
  assert.deepEqual(Array.from(h.saved.values()), [PENDING_SUBMISSION]);
});

test('deployment helper reload during an open wallet prompt sees the persisted guard and cannot send', async () => {
  const first = harness('pause-send');
  await first.connect(); const pending = first.deploy(); await first.atSend;
  assert.deepEqual(Array.from(first.saved.values()), [PENDING_SUBMISSION]);
  assert.equal(first.broadcasts.length, 0, 'the wallet response is still pending');
  const reloaded = harness('normal', fixturePlan, first.saved);
  assert.match(reloaded.nodes.get('status').textContent, /pending or its submission status is uncertain/i);
  await reloaded.connect();
  assert.equal(reloaded.nodes.get('deploy').disabled, true);
  await reloaded.deploy();
  assert.equal(reloaded.sends().length, 0);
  first.resumeSend(); await pending;
  assert.equal(first.broadcasts.length, 1);
  assert.deepEqual(Array.from(first.saved.values()), [TRANSACTION_HASH]);
  await reloaded.connect();
  assert.equal(reloaded.nodes.get('deploy').disabled, true);
  assert.match(reloaded.nodes.get('status').textContent, /already submitted/);
  assert.match(reloaded.nodes.get('status').textContent, new RegExp(TRANSACTION_HASH));
});

for (const scenario of ['reject-4001', 'reject-string-4001', 'reject-action']) {
  test('deployment helper clears only an explicit ' + scenario + ' rejection and permits a deliberate retry', async () => {
    const h = harness(scenario);
    await h.connect(); await h.deploy();
    assert.equal(h.sends().length, 1);
    assert.equal(h.broadcasts.length, 0);
    assert.equal(h.saved.size, 0, 'proven user rejection clears the marker');
    assert.equal(h.nodes.get('deploy').disabled, false);
    await h.deploy();
    assert.equal(h.sends().length, 2);
    assert.equal(h.broadcasts.length, 1);
    assert.deepEqual(h.guardsAtSend, [[PENDING_SUBMISSION], [PENDING_SUBMISSION]]);
    assert.deepEqual(Array.from(h.saved.values()), [TRANSACTION_HASH]);
    assert.equal(h.nodes.get('deploy').disabled, true);
  });
}

test('deployment helper treats an invalid transaction hash as uncertain and prevents retry', async () => {
  const h = harness('invalid-hash');
  await h.connect(); await h.deploy();
  assert.equal(h.sends().length, 1);
  assert.equal(h.broadcasts.length, 1);
  assert.deepEqual(Array.from(h.saved.values()), [PENDING_SUBMISSION]);
  assert.match(h.nodes.get('status').textContent, /did not return a valid transaction hash/);
  assert.equal(h.nodes.get('deploy').disabled, true);
  await h.deploy();
  assert.equal(h.sends().length, 1);
});

const invalidRoyaltyPlans = [
  ['missing royalty recipient', plan => { delete plan.royaltyRecipient; }, /explicit nonzero royalty recipient/i],
  ['zero royalty recipient', plan => { plan.royaltyRecipient = '0x' + '0'.repeat(40); }, /explicit nonzero royalty recipient/i],
  ['malformed royalty recipient', plan => { plan.royaltyRecipient = '0xnot-an-address'; }, /explicit nonzero royalty recipient/i],
  ['legacy five constructor arguments despite a 350-bps label', plan => { plan.constructorArgs.pop(); }, /exactly six constructor arguments/i],
  ['350-bps label with legacy five-argument creation calldata', plan => {
    plan.transaction.data = creationData(PRIMARY_ARGS);
  }, /exact six reviewed constructor arguments/i],
  ['350-bps label with another recipient encoded in calldata', plan => {
    plan.transaction.data = creationData([...PRIMARY_ARGS, PAYER]);
  }, /exact six reviewed constructor arguments/i],
  ['display recipient differing from the sixth constructor argument', plan => {
    plan.royaltyRecipient = PAYER;
  }, /constructor arguments differ/i],
  ['missing explicit royalty basis points', plan => { delete plan.royaltyBps; }, /350 basis points/i],
  ['a different royalty rate beneath the fixed 3.5% page text', plan => { plan.royaltyBps = 500; }, /350 basis points/i],
  ['absent royalty standard beneath the fixed page text', plan => { delete plan.royaltyStandard; }, /350 basis points/i],
];
for (const [label, mutate, message] of invalidRoyaltyPlans) {
  test('deployment helper blocks ' + label + ' before any wallet request', async () => {
    const plan = structuredClone(fixturePlan); mutate(plan);
    const h = harness('normal', plan);
    assert.equal(h.nodes.get('connect').disabled, true);
    assert.equal(h.nodes.get('deploy').disabled, true);
    assert.match(h.nodes.get('status').textContent, /DEPLOYMENT BLOCKED/);
    assert.match(h.nodes.get('status').textContent, message);
    assert.equal(h.requests.length, 0);
    // Defensive validation also rejects direct handler invocation, even though
    // real disabled buttons cannot initiate these actions.
    await h.connect(); await h.deploy();
    assert.equal(h.requests.length, 0);
    assert.equal(h.sends().length, 0);
    assert.equal(h.saved.size, 0);
  });
}


test('connect requests wallet access before checking or switching a different network', async()=>{
 const h=harness('wrong-network');await h.connect();
 assert.equal(h.requests[0].method,'eth_requestAccounts');
 assert.equal(h.requests.find(r=>r.method==='wallet_switchEthereumChain').params[0].chainId,'0x1237');
 assert.equal(h.nodes.get('wallet').textContent,PAYER);
 assert.equal(h.sends().length,0);
});
test('EIP-6963 wallet can connect without window.ethereum',async()=>{
 const h=harness('eip6963-only');await h.connect();assert.equal(h.nodes.get('wallet').textContent,PAYER);assert.equal(h.sends().length,0);
});
test('missing provider explains extension and mobile wallet browser requirements',async()=>{
 const h=harness('no-provider');await h.connect();assert.match(h.nodes.get('status').textContent,/No wallet detected/);assert.equal(h.requests.length,0);assert.equal(h.nodes.get('deploy').disabled,true);
});
