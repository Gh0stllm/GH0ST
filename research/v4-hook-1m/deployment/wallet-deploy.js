'use strict';
// Browser wallet signing is user-driven. This file contains no keys or public-RPC write client.
const EXPECTED = {
  chain: 4663n,
  sender: '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6',
  manager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
  modelHash: '0x03047f3adb84443ebbd6f1ba45d948fe4872f51ce0f6326e3f35a434c5b02f62',
  // Pin the exact reviewed plan, including every deployment's calldata and runtime hash.
  planSha256: '0x2d4f3d60ef3208c92d0dff3295cc4cc0b89d53d6ebb4da7dd63324cc5b4b7911',
};
const el = id => document.getElementById(id);
let plan, provider, signer, cursor = 0, busy = false, receipts = {};
const statusListeners = new Set();
// Read-only access for the separately gated liquidity panel. Loading this API never connects a wallet.
globalThis.GH0STDeployment = Object.freeze({
  getContext: () => ({ plan, provider, signer, busy, allDeployed: !!plan && cursor === plan.transactions.length }),
  subscribe: listener => { statusListeners.add(listener); return () => statusListeners.delete(listener); },
});
const lower = value => value.toLowerCase();
const storageKey = () => `gh0st-v4:${plan.chain_id}:${plan.hook_address.toLowerCase()}`;
function log(text) { el('log').textContent += `${new Date().toISOString()}  ${text}\n`; }
function save() { localStorage.setItem(storageKey(), JSON.stringify(receipts)); }
function assert(ok, message) { if (!ok) throw Error(message); }
async function act(fn) {
  if (busy) return;
  busy = true; el('error').textContent = ''; buttons();
  try { await fn(); } catch (error) { el('error').textContent = error.shortMessage || error.message; }
  finally { busy = false; buttons(); }
}
function buttons() {
  el('plan').disabled = busy;
  el('load-reviewed').disabled = busy;
  el('connect').disabled = busy || !plan;
  el('refresh').disabled = busy || !signer || !plan;
  el('deploy').disabled = busy || !signer || !plan || cursor >= (plan?.transactions.length ?? 0);
  for (const listener of statusListeners) listener();
}
async function verify() {
  assert(BigInt(await provider.send('eth_chainId', [])) === EXPECTED.chain, 'Switch the wallet to Robinhood Chain mainnet (4663).');
  const accounts = await provider.send('eth_accounts', []);
  assert(accounts.length > 0 && lower(accounts[0]) === lower(EXPECTED.sender), 'Select the confirmed deployment wallet.');
  assert(lower(await signer.getAddress()) === lower(EXPECTED.sender), 'Select the confirmed deployment wallet.');
  for (const [address, hash] of [[plan.dependencies.pool_manager, plan.dependencies.pool_manager_code_hash],
    [plan.dependencies.create2_deployer, plan.dependencies.create2_deployer_code_hash]]) {
    assert(ethers.keccak256(await provider.getCode(address)) === hash, `Dependency code does not match: ${address}`);
  }
}
async function locate() {
  await verify();
  cursor = 0;
  for (const entry of plan.transactions) {
    const code = await provider.getCode(entry.predicted_address);
    if (code !== '0x') {
      assert(ethers.keccak256(code) === entry.runtime_code_hash, `Conflicting code at ${entry.predicted_address}. Stop and inspect.`);
      cursor++;
      continue;
    }
    const pending = receipts[entry.order];
    if (pending?.hash) {
      const receipt = await provider.getTransactionReceipt(pending.hash);
      assert(receipt, `Transaction ${pending.hash} is still pending or was replaced. Check it before retrying.`);
      if (receipt.status === 0) { delete receipts[entry.order]; save(); throw Error(`Transaction ${pending.hash} failed. Review before retrying.`); }
      throw Error(`Confirmed transaction ${pending.hash} has no expected contract. Stop and inspect.`);
    }
    break;
  }
  el('progress').value = cursor;
  const next = plan.transactions[cursor];
  el('next').textContent = next ? `${cursor}/${plan.transactions.length} verified\nNext: ${next.kind}\nExpected address: ${next.predicted_address}`
    : `${cursor}/${plan.transactions.length} contracts verified.\nModel: ${plan.model_address}\nHook: ${plan.hook_address}`;
  buttons();
}
function clearPlan() {
  plan = undefined;
  cursor = 0;
  el('summary').textContent = 'No reviewed plan loaded.';
  el('next').textContent = 'Load the reviewed plan first.';
  el('progress').value = 0;
}
async function loadPlanBytes(encoded) {
  clearPlan();
  assert(ethers.sha256(encoded) === EXPECTED.planSha256, 'Plan differs from the reviewed deployment. Do not sign it.');
  const candidate = JSON.parse(new TextDecoder().decode(encoded));
  assert(candidate.status === 'PREPARED_UNSIGNED_NOT_BROADCAST', 'Choose a prepared unsigned deployment plan.');
  assert(BigInt(candidate.chain_id) === EXPECTED.chain, 'Wrong chain.');
  assert(lower(candidate.sender?.address ?? '') === lower(EXPECTED.sender), 'Plan sender does not match the confirmed wallet.');
  assert(candidate.selected_model.model_hash === EXPECTED.modelHash, 'Plan model does not match the selected model.');
  assert(lower(candidate.dependencies.pool_manager) === lower(EXPECTED.manager), 'Wrong canonical PoolManager.');
  assert(lower(candidate.dependencies.create2_deployer) === lower(EXPECTED.factory), 'Wrong CREATE2 deployer.');
  assert(candidate.transactions.length === 59, 'Expected 59 deployments.');
  for (const entry of candidate.transactions) {
    const tx = entry.unsigned_transaction;
    assert(BigInt(tx.chainId) === EXPECTED.chain && lower(tx.to) === lower(EXPECTED.factory) && BigInt(tx.value) === 0n, 'Unexpected transaction target or value.');
    assert(tx.data.slice(0, 66) === entry.salt, 'Salt/calldata mismatch.');
    const initCode = `0x${tx.data.slice(66)}`;
    assert(ethers.keccak256(initCode) === entry.init_code_hash, 'Deployment calldata hash mismatch.');
    assert(lower(ethers.getCreate2Address(EXPECTED.factory, entry.salt, entry.init_code_hash)) === lower(entry.predicted_address), 'Predicted address mismatch.');
  }
  plan = candidate; receipts = JSON.parse(localStorage.getItem(storageKey()) || '{}');
  el('summary').textContent = `Model hash: ${plan.selected_model.model_hash}\nModel: ${plan.model_address}\nHook: ${plan.hook_address}\nPrepared at block: ${plan.observed_block.number}\n59 unsigned transactions; no tokens transferred.`;
  cursor = 0; buttons(); log('Prepared plan loaded.');
}
el('plan').addEventListener('change', () => act(async () => {
  clearPlan();
  const file = el('plan').files[0]; if (!file) return;
  await loadPlanBytes(new Uint8Array(await file.arrayBuffer()));
}));
el('load-reviewed').addEventListener('click', () => act(async () => {
  clearPlan();
  const response = await fetch('./robinhood-mainnet-plan.json', { cache: 'no-store', credentials: 'same-origin' });
  assert(response.ok, `Unable to load the reviewed plan (${response.status}). Choose the local plan file instead.`);
  await loadPlanBytes(new Uint8Array(await response.arrayBuffer()));
}));
el('connect').addEventListener('click', () => act(async () => {
  assert(window.ethereum, 'Open this page in a browser with an injected Ethereum wallet.');
  provider = new ethers.BrowserProvider(window.ethereum, undefined, { cacheTimeout: -1 });
  await provider.send('eth_requestAccounts', []);
  signer = await provider.getSigner(); await verify();
  el('account').textContent = await signer.getAddress();
  await locate(); log('Wallet and chain verified.');
}));
el('refresh').addEventListener('click', () => act(locate));
el('deploy').addEventListener('click', () => act(async () => {
  await locate();
  const entry = plan.transactions[cursor]; if (!entry) return;
  const request = { from: EXPECTED.sender, to: EXPECTED.factory, data: entry.unsigned_transaction.data,
    value: 0n, chainId: EXPECTED.chain };
  const estimate = await signer.estimateGas(request);
  const tx = await signer.sendTransaction({ ...request, gasLimit: (estimate * 150n + 99n) / 100n });
  receipts[entry.order] = { hash: tx.hash, expected_address: entry.predicted_address }; save();
  log(`${entry.kind} submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  assert(receipt.status === 1, 'Deployment failed.');
  assert(ethers.keccak256(await provider.getCode(entry.predicted_address)) === entry.runtime_code_hash, 'Deployed runtime does not match.');
  receipts[entry.order].verified = true; save();
  log(`${entry.kind} verified: ${entry.predicted_address}`); await locate();
}));
