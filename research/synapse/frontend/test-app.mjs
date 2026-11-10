// Local-only integration test: a simulated DOM/wallet/RPC drives the actual production bundle.
// No public RPC, wallet, payment, or deployment is used.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { ethers, ganache } from '../scripts/lib.mjs';
import { TOKEN_ADDRESS, PUBLIC_RPC } from './core.mjs';
const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const model = read('../candidates/domain/model.json'), alternate = read('../candidates/domain/alternate-expert.json');
const raw = read('../results/v2/build/artifacts.json');
const v2 = Object.values(raw).some(x => x.abi) ? raw : Object.assign({}, ...Object.values(raw));
const v1 = read('../results/build/artifacts.json');
const provider1193 = ganache.provider({ logging: { quiet: true }, chain: { chainId: 4663, hardfork: 'shanghai' }, wallet: { mnemonic: 'test test test test test test test test test test test junk', defaultBalance: 1000 }, miner: { blockGasLimit: 60_000_000 } });
const provider = new ethers.BrowserProvider(provider1193, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 20;
const payer = await provider.getSigner(0), beneficiary = await payer.getAddress();
const packed = values => '0x' + values.map(value => ((value + 65536) % 65536).toString(16).padStart(4, '0')).join('');
async function deploy(name, args, artifacts = v2) {
  const a = artifacts[name], bytecode = a.bytecode || '0x' + a.evm.bytecode.object;
  const contract = await new ethers.ContractFactory(a.abi, bytecode, payer).deploy(...args); await contract.waitForDeployment(); return contract;
}
const tokenTemplate = await deploy('LocalTestToken', [], v1);
await provider1193.request({ method: 'evm_setAccountCode', params: [TOKEN_ADDRESS, await provider.getCode(tokenTemplate.target)] });
const token = new ethers.Contract(TOKEN_ADDRESS, v1.LocalTestToken.abi, payer);
await (await token.mint(beneficiary, ethers.parseEther('100'))).wait();
const backbone = await deploy('SynapseBackboneV2', [beneficiary, ethers.parseEther('1'), model.vocab.length, model.contextSize, model.hiddenSize, packed([...model.embeddings, ...model.headWeights, ...model.headBias])]);
const spaceId = await backbone.spaceId();
const experts = [];
for (const [index, expert] of [...model.experts, alternate].entries()) experts.push(await deploy('SynapseExpertV2', [beneficiary, ethers.parseEther(String(index + 2)), spaceId, model.hiddenSize, packed([...expert.weights, ...expert.bias])]));
const graphs = [await deploy('SynapseGraphV2', [TOKEN_ADDRESS, backbone.target, [experts[0].target, experts[1].target]]), await deploy('SynapseGraphV2', [TOKEN_ADDRESS, backbone.target, [experts[0].target, experts[2].target]])];
async function moduleConfig(contract, id) { return { id, address: contract.target, spaceId: await contract.spaceId(), weightsHash: await contract.weightsHash(), codeHash: ethers.keccak256(await provider.getCode(contract.target)), beneficiary, fee: (await contract.fee()).toString() }; }
const config = { ...read('./deployment.json'), status: 'live', token: { address: TOKEN_ADDRESS, symbol: 'TEST', decimals: 18 }, backbone: await moduleConfig(backbone, 'backbone'), experts: await Promise.all(experts.map((expert, i) => moduleConfig(expert, `expert${i}`))), graphs: await Promise.all(graphs.map(async (graph, i) => ({ id: i ? 'alternate' : 'base', address: graph.target, graphId: await graph.graphId(), totalFee: (await graph.totalFee()).toString(), expertIds: ['expert0', i ? 'expert2' : 'expert1'], codeHash: ethers.keccak256(await provider.getCode(graph.target)) }))) };
const abi = { graph: v2.SynapseGraphV2.abi, backbone: v2.SynapseBackboneV2.abi, expert: v2.SynapseExpertV2.abi };

class Element {
  constructor(id = '') { this.id = id; this.textContent = ''; this.disabled = false; this.dataset = {}; this.style = {}; this.children = []; this.listeners = {}; this.value = ''; this._html = ''; this.classList = { values: new Set(), toggle: (value, on) => on === undefined ? this.classList.values.has(value) ? this.classList.values.delete(value) : this.classList.values.add(value) : on ? this.classList.values.add(value) : this.classList.values.delete(value), add: value => this.classList.values.add(value), remove: value => this.classList.values.delete(value) }; }
  set innerHTML(value) { this._html = value; if (this.id === 'token-selectors') selectors = Array.from({ length: model.contextSize }, (_, i) => new Element(`select${i}`)); }
  get innerHTML() { return this._html; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  async click() { assert.equal(this.disabled, false, `${this.id} is disabled: ${element('notice').textContent}`); return this.listeners.click?.({}); }
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
}
const elements = new Map();
function element(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); }
let selectors = [];
const graphButtons = ['base', 'alternate'].map((graph, i) => { const node = element(`graph-${graph}`); node.dataset.graph = graph; return node; });
const presetButtons = Array.from({ length: 4 }, (_, i) => element(`preset${i}`));
const flowButtons = ['hidden', 'expert0', 'expert1', 'merged', 'logits'].map(stage => { const node = element(stage); node.dataset.stage = stage; return node; });
globalThis.document = { getElementById: element, createElement: () => new Element(), body: element('body'), querySelectorAll: selector => selector === '[data-graph]' ? graphButtons : selector === '[data-prompt]' ? presetButtons : selector === '[data-stage]' || selector === '.flow-node' ? flowButtons : selector === '#token-selectors select' ? selectors : selector.includes(',') ? [...graphButtons, ...presetButtons, ...flowButtons, ...selectors, element('reset'), element('apply-prompt')] : [] };
const local = new Map(); globalThis.localStorage = { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
let sends = 0, reject = false, wrongNetwork = false, tamperPreview = false;
globalThis.window = { ethereum: { on: () => {}, request: async request => {
  if (request.method === 'eth_requestAccounts' || request.method === 'eth_accounts') return [beneficiary];
  if (request.method === 'eth_chainId' && wrongNetwork) return '0x1';
  if (request.method === 'wallet_switchEthereumChain') { wrongNetwork = false; return null; }
  if (request.method === 'eth_sendTransaction') { if (reject) throw Object.assign(new Error('User rejected request'), { code: 4001 }); sends++; }
  return provider1193.request(request);
} } };
const assets = { 'deployment.json': JSON.stringify(config), 'model.json': readFileSync(new URL('../candidates/domain/model.json', import.meta.url), 'utf8'), 'alternate-expert.json': JSON.stringify(alternate), 'abi.json': JSON.stringify(abi) };
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('./')) return new Response(assets[String(url).slice(2)], { status: 200 });
  assert.equal(String(url), PUBLIC_RPC, 'Production bundle attempted an unexpected network request');
  const requests = JSON.parse(typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body)); const run = async request => { try {
    let result = await provider1193.request({ method: request.method, params: request.params });
    if (tamperPreview && request.method === 'eth_call' && request.params[0].data?.startsWith(graphs[0].interface.getFunction('preview').selector)) {
      const trace = graphs[0].interface.decodeFunctionResult('preview', result)[0];
      result = graphs[0].interface.encodeFunctionResult('preview', [{ hidden: trace.hidden, expertActivations: trace.expertActivations, merged: trace.merged, logits: trace.logits, token: (Number(trace.token) + 1) % model.vocab.length }]);
    }
    return { jsonrpc: '2.0', id: request.id, result };
  } catch (error) { return { jsonrpc: '2.0', id: request.id, error: { code: error.code || -32000, message: error.message, data: error.data } }; } };
  return new Response(JSON.stringify(Array.isArray(requests) ? await Promise.all(requests.map(run)) : await run(requests)), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const wait = async predicate => { const started = Date.now(); while (!predicate()) { if (Date.now() - started > 20000) throw new Error(`Timeout: ${element('notice').textContent}`); await new Promise(resolve => setTimeout(resolve, 20)); } };
try {
  await import(`./dist/synapse/app.js?simulation=${Date.now()}`);
  await wait(() => element('chain-status').textContent.includes('verified') && !element('graph-alternate').disabled);
  assert.equal(element('prediction').textContent, 'context');
  assert.match(element('model-description').textContent, /128 vocabulary.*4-token.*32 hidden/);
  assert.equal(sends, 0);
  await element('graph-alternate').click(); assert.equal(element('prediction').textContent, 'tokens');
  await element('graph-base').click();
  wrongNetwork = true; await element('connect').click(); assert.equal(element('connect').textContent, 'Switch to Robinhood'); assert.equal(element('infer').disabled, true);
  await element('connect').click(); assert.equal(element('approve').disabled, false); assert.equal(element('infer').disabled, true);
  reject = true; await element('approve').click(); assert.match(element('notice').textContent, /declined/); assert.equal(sends, 0); reject = false;
  await (await token.approve(graphs[0].target, ethers.parseEther('9'))).wait();
  await element('refresh').click(); assert.equal(element('approve').textContent, 'Reset old allowance'); assert.equal(element('infer').disabled, true);
  await element('approve').click(); assert.equal(sends, 1); assert.equal(await token.allowance(beneficiary, graphs[0].target), 0n); assert.equal(element('infer').disabled, true);
  await element('approve').click(); assert.equal(sends, 2); assert.equal(await token.allowance(beneficiary, graphs[0].target), ethers.parseEther('6')); assert.equal(element('infer').disabled, false);
  await element('infer').click(); assert.equal(sends, 3); assert.equal(await token.allowance(beneficiary, graphs[0].target), 0n); assert.equal(await graphs[0].credits(beneficiary), ethers.parseEther('6')); assert.match(element('trace-origin').textContent, /Confirmed paid/); assert.match(element('notice').textContent, /receipt checked/);
  await element('claim').click(); assert.equal(sends, 4); assert.equal(await graphs[0].credits(beneficiary), 0n); assert.equal(await token.balanceOf(beneficiary), ethers.parseEther('100'));
  await element('generate').click(); assert.match(element('notice').textContent, /<eos>|12 free read/); assert.equal(sends, 4);
  tamperPreview = true; await element('preview').click(); assert.equal(element('chain-status').textContent, 'Trace verification failed'); assert.equal(element('infer').disabled, true); assert.equal(element('approve').disabled, true); assert.equal(sends, 4);
  const report = { simulation: true, publicTransactions: 0, model: model.id, checks: ['actual production bundle initializes and verifies local V2 contracts', '128-vocabulary/4-context/32-hidden UI', 'alternate expert context → tokens', 'wrong network blocks payment', 'wallet rejection sends nothing', 'old nonexact allowance resets through its own click', 'exact 6 TEST approval requires a separate click', 'paid next token validates dynamic full trace and 3 module credits', 'allowance consumed', 'beneficiary withdrawal receipt and balance verified', 'free continuation emits no transaction', 'tampered preview disables paid actions'], localTransactionsFromUi: sends, finalBalance: (await token.balanceOf(beneficiary)).toString() };
  mkdirSync(new URL('./test-results/', import.meta.url), { recursive: true }); writeFileSync(new URL('./test-results/app-integration.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { globalThis.fetch = nativeFetch; provider.destroy(); await provider1193.disconnect(); }
