import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, ContractFactory, ZeroAddress, ZeroHash, encodeBytes32String, keccak256, toUtf8Bytes, toUtf8String } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportPath = join(root, 'reports/solidity-agent-local.json');
const abi = AbiCoder.defaultAbiCoder();
const modelId = keccak256(toUtf8Bytes('agent-test-model'));
const checkpoint = keccak256(toUtf8Bytes('agent-test-checkpoint'));
const b32 = encodeBytes32String;
const hex = text => '0x' + Buffer.from(text).toString('hex');
const actionHash = text => keccak256(toUtf8Bytes(text));
const mask = kind => 1 << kind;
const allActions = 1023;
let rpc, provider, alice, bob, aliceAddress, bobAddress, tokenizer, compiled, temporary, references;
const completed = [];
const report = { format: 's0ul-agent-local-security-v1', recorded_utc: new Date().toISOString(), chain: { kind: 'in-process Ganache', chain_id: 31337, hardfork: 'shanghai', block_gas_limit: 30000000, unlimited_contract_size: false, public_transactions: 0 }, completed_cases: completed, suite_complete: false, full_trained_model_executed: false };
const mark = name => completed.push(name);
const mined = async transaction => { const tx = await transaction; return await provider.getTransactionReceipt(tx.hash) ?? tx.wait(); };
function artifact(file, name) { const value = compiled.contracts[file]?.[name]; assert.ok(value, `${file}:${name}`); return value; }
async function deploy(file, name, args = [], signer = alice) {
  const value = artifact(file, name);
  const contract = await new ContractFactory(value.abi, value.evm.bytecode.object, signer).deploy(...args, { gasLimit: 15000000 });
  await contract.waitForDeployment(); return contract;
}
async function fixture() {
  const model = await deploy('tests/fixtures/S0ULAgentMocks.sol', 'MockS0ULModel', [modelId, checkpoint]);
  const engine = await deploy('tests/fixtures/S0ULAgentMocks.sol', 'MockS0ULEngine', [await model.getAddress(), await tokenizer.getAddress()]);
  const token = await deploy('tests/fixtures/S0ULAgentMocks.sol', 'MockS0ULBalanceToken');
  const engineHash = keccak256(await provider.getCode(await engine.getAddress()));
  const agent = await deploy('contracts/S0ULAgent.sol', 'S0ULAgent', [await engine.getAddress(), engineHash, modelId, await token.getAddress()]);
  return { model, engine, token, engineHash, agent };
}
async function outputIds(text) { return [...Array.from(await tokenizer.encode(text), Number), 2]; }
async function begin(f, allowed = allActions, owner = alice, expected = null) {
  const id = await f.engine.nextRequestId();
  if (expected === null) await mined(f.agent.connect(owner).begin('fixture', 32, allowed));
  else await mined(f.agent.connect(owner).beginConstrained('fixture', 32, allowed, actionHash(expected)));
  return id;
}
async function finalize(f, id, outcome = 2, reason = null, caller = bob) {
  const receipt = await mined(f.agent.connect(caller).finalize(id, { gasLimit: 2000000 }));
  const request = await f.agent.requests(id);
  assert.equal(Number(request.outcome), outcome);
  if (reason !== null) assert.equal(Number(request.reason), reason);
  return receipt;
}
async function complete(f, id, text, outcome = 2, reason = null) {
  await mined(f.engine.setOutput(id, await outputIds(text), true));
  await finalize(f, id, outcome, reason);
}

before(async () => {
  rmSync(reportPath, { force: true }); temporary = mkdtempSync(join(tmpdir(), 's0ul-agent-test-'));
  const generated = spawnSync(process.env.PYTHON ?? 'python', ['-c', String.raw`
import hashlib,json,random,sys,torch
from pathlib import Path
from s0ul.actions import parse_action
from s0ul.integer import IntegerModel
from s0ul.model import ModelConfig,S0ULModel
from s0ul.tokenizer import S0ULTokenizer
from s0ul.solidity_export import build_export
torch.set_num_threads(2)
valid=['WAIT','BALANCE|SELF|ETH','BALANCE|SELF|GH0ST','TASK_LIST|SELF','TASK_DONE|1','TASK_DONE|9999']
valid += ['MEM_SET|'+k+'|'+v for k in ['theme','language','mode'] for v in ['a','dark_mode9','a'*24]]
valid += ['MEM_GET|'+k for k in ['theme','language','mode']]
valid += ['TASK_ADD|a','TASK_ADD|'+'z'*24]
valid += ['CLARIFY|'+k for k in ['asset','key','value','title','task_id','request']]
valid += ['REFUSE|'+k for k in ['unsupported','unauthorized','unsafe']]
raw=[x.encode() for x in valid]
bad=['',' WAIT','WAIT\n','WAIT|','wait','BALANCE|BOB|ETH','BALANCE|SELF|USDC','MEM_GET|other','MEM_SET|theme|','MEM_SET|theme|9abc','MEM_SET|theme|a-b','MEM_SET|theme|'+'a'*25,'TASK_DONE|0','TASK_DONE|01','TASK_DONE|10000','TASK_DONE|-1','TASK_LIST','TASK_LIST|SELF|x','CLARIFY|owner','REFUSE|oops','WAIT\x00','WАIT','a'*101]
raw += [x.encode('utf-8') for x in bad]+[bytes([255]),bytes([0]),b'WAIT\r\n']
rng=random.Random(7301)
for _ in range(240):
 if rng.randrange(2):
  value=bytearray(rng.choice(raw[:len(valid)])); pos=rng.randrange(len(value)+1)
  value[pos:pos]=bytes([rng.randrange(256)]);raw.append(bytes(value))
 else:raw.append(bytes(rng.randrange(256) for _ in range(rng.randrange(106))))
names={'WAIT':0,'MEM_SET':3,'MEM_GET':4,'TASK_ADD':5,'TASK_LIST':6,'TASK_DONE':7,'CLARIFY':8,'REFUSE':9}
vectors=[]
for value in raw:
 try:
  a=parse_action(value.decode('utf-8'));kind=1+(a.args[1]=='GH0ST') if a.kind=='BALANCE' else names[a.kind]
  key=a.args[0] if a.kind in ('MEM_SET','MEM_GET','CLARIFY','REFUSE') else ''
  val=a.args[1] if a.kind=='MEM_SET' else a.args[0] if a.kind=='TASK_ADD' else ''
  vectors.append({'hex':'0x'+value.hex(),'valid':True,'kind':kind,'key':key,'value':val,'taskId':int(a.args[0]) if a.kind=='TASK_DONE' else 0})
 except (ValueError,UnicodeError):vectors.append({'hex':'0x'+value.hex(),'valid':False})
c=ModelConfig(vocab_size=512,dim=8,n_layers=1,n_heads=2,hidden_dim=16,max_seq_len=12)
m=S0ULModel(c).eval()
with torch.no_grad():
 for p in m.parameters():p.zero_()
 m.token_embedding.weight[3,0]=.01
 m.token_embedding.weight[268,0]=.02;m.token_embedding.weight[268,1]=.02
 m.token_embedding.weight[2,1]=.05
 m.norm.weight.fill_(1)
 m.layers[0].attn_norm.weight.fill_(1);m.layers[0].ffn_norm.weight.fill_(1)
integer=IntegerModel.from_state_dict(m.state_dict(),c.to_dict());integer.tokenizer_spec=S0ULTokenizer().spec()
integer.source_checkpoint_sha256=hashlib.sha256(b'constructed agent integration fixture; not a trained checkpoint').hexdigest()
prefix=[1,*S0ULTokenizer().encode('Wait.'),3];decisions=[];tokens=list(prefix)
for _ in range(2):
 logits=integer.forward(tokens)[-1].tolist();n=max(range(len(logits)),key=lambda i:logits[i]);decisions.append({'prefix':list(tokens),'logits':logits,'next_id':n});tokens.append(n)
 if n==2:break
assert tokens[len(prefix):]==[268,2],tokens
build_export(integer,Path(sys.argv[1])/'tiny-wait')
print(json.dumps({'grammar':vectors,'tiny':{'prefix':prefix,'output':[268,2],'decisions':decisions,'parameter_count':sum(p.numel() for p in m.parameters())}}))
`, temporary], { cwd: root, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr); references = JSON.parse(generated.stdout);
  const sources = Object.fromEntries(readdirSync(join(root, 'contracts')).filter(name => name.endsWith('.sol')).map(name => [`contracts/${name}`, { content: readFileSync(join(root, 'contracts', name), 'utf8') }]));
  for (const name of ['S0ULAgentMocks.sol', 'S0ULActionCodecHarness.sol']) sources[`tests/fixtures/${name}`] = { content: readFileSync(join(root, 'tests/fixtures', name), 'utf8') };
  const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } };
  let cached = null, compileSources = sources;
  if (process.env.S0UL_AGENT_BUILD) {
    cached = JSON.parse(readFileSync(process.env.S0UL_AGENT_BUILD, 'utf8'));
    assert.equal(cached.compiler, solc.version()); assert.equal(cached.optimizerRuns, 200); assert.equal(cached.viaIR, true); assert.equal(cached.evmVersion, 'shanghai');
    for (const [name, hash] of Object.entries(cached.sourceSha256)) assert.equal(createHash('sha256').update(sources[`contracts/${name}`].content).digest('hex'), hash);
    compileSources = Object.fromEntries(Object.entries(sources).filter(([name]) => name.startsWith('tests/') || name === 'contracts/S0ULActionCodec.sol'));
  }
  compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: compileSources, settings })));
  const errors = (compiled.errors ?? []).filter(error => error.severity === 'error'); assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
  if (cached) { compiled.contracts = { ...Object.fromEntries(Object.entries(cached.contracts).map(([name, contracts]) => [`contracts/${name}`, contracts])), ...compiled.contracts }; report.production_build = 'Verified cached production artifact; fixtures compiled locally'; }
  report.compiler = { version: solc.version(), optimizer_runs: 200, via_ir: true, evm_version: 'shanghai' };
  report.source_sha256 = Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, createHash('sha256').update(value.content).digest('hex')]));
  report.runtime_code_bytes = Object.fromEntries(['S0ULAgent', 'S0ULInference', 'S0ULTokenizer'].map(name => [name, artifact(`contracts/${name}.sol`, name).evm.deployedBytecode.object.length / 2]));
  assert.ok(Object.values(report.runtime_code_bytes).every(length => length <= 24576));
  rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: false }, miner: { blockGasLimit: 30000000 }, wallet: { deterministic: true, defaultBalance: 1000000 } });
  provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, batchStallTime: 0 }); provider.pollingInterval = 10;
  alice = await provider.getSigner(0); bob = await provider.getSigner(1); aliceAddress = await alice.getAddress(); bobAddress = await bob.getAddress();
  tokenizer = await deploy('contracts/S0ULTokenizer.sol', 'S0ULTokenizer');
});
after(async () => {
  report.suite_complete = completed.length === 12;
  mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  await provider?.destroy(); await rpc?.disconnect(); if (temporary) rmSync(temporary, { recursive: true, force: true });
});

test('strict action codec matches Python canonical, malformed-byte and seeded mutation vectors', async () => {
  const harness = await deploy('tests/fixtures/S0ULActionCodecHarness.sol', 'S0ULActionCodecHarness');
  for (const vector of references.grammar) {
    const [valid, value] = await harness.parse(vector.hex); assert.equal(valid, vector.valid, vector.hex);
    if (valid) { assert.equal(Number(value.kind), vector.kind); assert.equal(value.key, vector.key ? b32(vector.key) : ZeroHash); assert.equal(value.value, hex(vector.value)); assert.equal(Number(value.taskId), vector.taskId); }
  }
  report.grammar = { vectors: references.grammar.length, valid: references.grammar.filter(vector => vector.valid).length, invalid: references.grammar.filter(vector => !vector.valid).length, all_exact: true, oracle: 's0ul.actions.parse_action' };
  mark('python_grammar_parity');
});

test('constructor and ongoing model, engine and tokenizer identity pins fail closed', async () => {
  const f = await fixture();
  await assert.rejects(deploy('contracts/S0ULAgent.sol', 'S0ULAgent', [await f.engine.getAddress(), ZeroHash, modelId, await f.token.getAddress()]));
  await assert.rejects(deploy('contracts/S0ULAgent.sol', 'S0ULAgent', [await f.engine.getAddress(), f.engineHash, checkpoint, await f.token.getAddress()]));
  const id = await begin(f, mask(0)); await mined(f.engine.setOutput(id, await outputIds('WAIT'), true));
  await mined(f.model.setIdentity(modelId, ZeroHash)); await assert.rejects(f.agent.finalize.staticCall(id));
  await mined(f.model.setIdentity(modelId, checkpoint));
  await mined(f.engine.configurePins(await f.model.getAddress(), bobAddress, modelId)); await assert.rejects(f.agent.finalize.staticCall(id));
  await mined(f.engine.configurePins(await f.model.getAddress(), await tokenizer.getAddress(), modelId));
  const code = await provider.getCode(await f.engine.getAddress()); await rpc.request({ method: 'evm_setAccountCode', params: [await f.engine.getAddress(), '0x00'] });
  await assert.rejects(f.agent.finalize.staticCall(id)); await rpc.request({ method: 'evm_setAccountCode', params: [await f.engine.getAddress(), code] });
  await finalize(f, id); mark('identity_pins');
});

test('controller begins for its caller and permissionless progress cannot escape the owner namespace', async () => {
  const f = await fixture(), id = await begin(f, mask(3));
  for (const [rows, steps] of [[0, 1], [129, 1], [32, 0], [32, 5]]) await assert.rejects(f.agent.advanceBatch.staticCall(id, rows, steps));
  assert.equal((await f.agent.requests(id)).owner, aliceAddress); assert.equal((await f.engine.status(id)).owner, await f.agent.getAddress());
  const prompt = Array.from(await f.engine.tokens(id), Number); assert.equal((await f.agent.requests(id)).promptHash, keccak256(abi.encode(['uint16[]'], [prompt])));
  await mined(f.engine.setCompletion(id, await outputIds('MEM_SET|theme|dark')));
  await mined(f.agent.connect(bob).advance(id, 32));
  assert.equal(await f.engine.lastAdvanceOwner(), await f.agent.getAddress()); await finalize(f, id);
  assert.equal(await f.agent.memoryOf(aliceAddress, b32('theme')), hex('dark')); assert.equal(await f.agent.memoryOf(bobAddress, b32('theme')), '0x');
  assert.equal((await f.agent.requests(id)).outputHash, keccak256(abi.encode(['uint16[]'], [await outputIds('MEM_SET|theme|dark')])));
  await assert.rejects(f.agent.finalize.staticCall(id)); mark('owner_bound_permissionless_progress');
});

test('direct requests can only be adopted by their engine owner and cancellation preserves that authority', async () => {
  const f = await fixture(); const direct = await f.engine.nextRequestId(); await mined(f.engine.beginText('fixture', 32));
  await assert.rejects(f.agent.connect(bob).adopt.staticCall(direct, mask(3)));
  await mined(f.agent.adopt(direct, mask(3))); assert.equal((await f.agent.requests(direct)).adopted, true);
  await complete(f, direct, 'MEM_SET|mode|quiet'); assert.equal(await f.agent.memoryOf(aliceAddress, b32('mode')), hex('quiet'));
  const controlled = await begin(f, mask(0)); await assert.rejects(f.agent.connect(bob).cancel.staticCall(controlled));
  await mined(f.agent.cancel(controlled)); assert.equal((await f.engine.status(controlled)).cancelled, true); assert.equal(Number((await f.agent.requests(controlled)).outcome), 4);
  await assert.rejects(f.agent.finalize.staticCall(controlled));
  const adopted = await f.engine.nextRequestId(); await mined(f.engine.beginText('fixture', 32)); await mined(f.agent.adopt(adopted, mask(0)));
  await mined(f.agent.cancel(adopted)); assert.equal((await f.engine.status(adopted)).cancelled, false);
  await assert.rejects(f.engine.connect(bob).cancel.staticCall(adopted)); await mined(f.engine.cancel(adopted));
  await assert.rejects(f.agent.finalize.staticCall(adopted)); mark('adoption_and_cancel_authority');
});

test('completion requires terminal EOS and rejects control, reserved, inconsistent and truncated provenance', async () => {
  const f = await fixture();
  const malformed = [[268], [2], [268, 2, 4], [268, 2, 2], [0, 268, 2], [1, 268, 2], [3, 268, 2], [421, 2], [511, 2], [512, 2]];
  for (const ids of malformed) { const id = await begin(f, mask(0)); await mined(f.engine.setOutput(id, ids, true)); await finalize(f, id, 3, 2); await assert.rejects(f.agent.finalize.staticCall(id)); }
  const pending = await begin(f, mask(0)); await assert.rejects(f.agent.finalize.staticCall(pending));
  const inconsistent = await begin(f, mask(0)); await mined(f.engine.setOutput(inconsistent, [268, 2], true));
  const status = await f.engine.status(inconsistent); await mined(f.engine.setCounters(inconsistent, status.promptLength, 32, 3)); await finalize(f, inconsistent, 3, 2);
  const ownerChanged = await begin(f, mask(0)); await mined(f.engine.setOutput(ownerChanged, [268, 2], true)); await mined(f.engine.setOwner(ownerChanged, bobAddress)); await assert.rejects(f.agent.finalize.staticCall(ownerChanged));
  const cancelled = await begin(f, mask(0)); await mined(f.engine.setFlags(cancelled, 18, false, true, 0)); await finalize(f, cancelled, 3, 1);
  mark('eos_and_output_provenance');
});

test('each action needs its explicit mask bit and rejected or executed requests cannot replay', async () => {
  const f = await fixture();
  await assert.rejects(f.agent.begin.staticCall('fixture', 32, 1024));
  const none = await begin(f, 0); await complete(f, none, 'WAIT', 3, 4);
  for (const text of ['MEM_SET|theme|dark', 'CLARIFY|request', 'REFUSE|unsafe']) { const id = await begin(f, mask(0)); await complete(f, id, text, 3, 4); await assert.rejects(f.agent.finalize.staticCall(id)); }
  const okay = await begin(f, mask(0)); await complete(f, okay, 'WAIT'); await assert.rejects(f.agent.finalize.staticCall(okay));
  assert.equal(await f.agent.memoryOf(aliceAddress, b32('theme')), '0x'); assert.equal(await f.agent.stateRevision(aliceAddress), 0n); mark('mask_and_replay');
});

test('owner commitments reject canonical actions with wrong arguments and accept only the committed bytes', async () => {
  const f = await fixture();
  const wrong = await begin(f, mask(5), alice, 'TASK_ADD|audit'); await complete(f, wrong, 'TASK_ADD|ee', 3, 11);
  assert.equal(await f.agent.taskCount(aliceAddress), 0n); assert.equal(await f.agent.stateRevision(aliceAddress), 0n);
  const okay = await begin(f, mask(5), alice, 'TASK_ADD|audit'); await complete(f, okay, 'TASK_ADD|audit');
  assert.equal(toUtf8String((await f.agent.taskOf(aliceAddress, 1)).title), 'audit'); assert.equal(await f.agent.taskCount(bobAddress), 0n);
  await assert.rejects(f.agent.finalize.staticCall(okay));
  const direct = await f.engine.nextRequestId(); await mined(f.engine.beginText('fixture', 32));
  await assert.rejects(f.agent.connect(bob).adoptConstrained.staticCall(direct, mask(5), actionHash('TASK_ADD|audit')));
  mark('canonical_argument_commitments');
});

test('three memory keys and bounded slugs stay owner scoped while stale writes reject terminally', async () => {
  const f = await fixture();
  const old = await begin(f, mask(3)), first = await begin(f, mask(3)); await complete(f, first, 'MEM_SET|theme|dark');
  await complete(f, old, 'MEM_SET|theme|light', 3, 5); await assert.rejects(f.agent.finalize.staticCall(old));
  assert.equal(await f.agent.memoryOf(aliceAddress, b32('theme')), hex('dark'));
  for (const [key, value] of [['language', 'english'], ['mode', 'a'.repeat(24)]]) { const id = await begin(f, mask(3)); await complete(f, id, `MEM_SET|${key}|${value}`); assert.equal(await f.agent.memoryOf(aliceAddress, b32(key)), hex(value)); }
  const invalid = await begin(f, mask(3)); await complete(f, invalid, 'MEM_SET|other|dark', 3, 3);
  const long = await begin(f, mask(3)); await complete(f, long, 'MEM_SET|mode|' + 'a'.repeat(25), 3, 3);
  const read = await begin(f, mask(4)); await complete(f, read, 'MEM_GET|theme'); const result = await f.agent.resultOf(read); assert.equal(abi.decode(['bytes'], result[1])[0], hex('dark'));
  const other = await begin(f, mask(3), bob); await complete(f, other, 'MEM_SET|theme|cyan'); assert.equal(await f.agent.memoryOf(bobAddress, b32('theme')), hex('cyan')); assert.equal(await f.agent.memoryOf(aliceAddress, b32('theme')), hex('dark'));
  const staleAdd = await begin(f, mask(5)), bump = await begin(f, mask(3)); await complete(f, bump, 'MEM_SET|mode|focus'); await complete(f, staleAdd, 'TASK_ADD|audit', 3, 5);
  const task = await begin(f, mask(5)); await complete(f, task, 'TASK_ADD|audit'); const staleDone = await begin(f, mask(7)), changed = await begin(f, mask(3)); await complete(f, changed, 'MEM_SET|mode|quiet'); await complete(f, staleDone, 'TASK_DONE|1', 3, 5); assert.equal((await f.agent.taskOf(aliceAddress, 1)).done, false);
  mark('memory_bounds_and_stale_revision');
});

test('tasks have a lifetime cap of 64 and completion/listing never escape their owner namespace', async () => {
  const f = await fixture(), driver = await deploy('tests/fixtures/S0ULAgentMocks.sol', 'AgentBatchDriver');
  const titleIds = await outputIds('TASK_ADD|a');
  for (let i = 0; i < 8; ++i) await mined(driver.run(await f.agent.getAddress(), await f.engine.getAddress(), titleIds, mask(5), 8, { gasLimit: 28000000 }));
  const owner = await driver.getAddress(); assert.equal(await f.agent.taskCount(owner), 64n); assert.equal((await f.agent.tasksOf(owner)).length, 64); assert.equal(await f.agent.taskCount(aliceAddress), 0n);
  const capId = await f.engine.nextRequestId(); await mined(driver.runOne(await f.agent.getAddress(), await f.engine.getAddress(), titleIds, mask(5), { gasLimit: 2000000 }));
  assert.equal(Number((await f.agent.requests(capId)).outcome), 3); assert.equal(Number((await f.agent.requests(capId)).reason), 6);
  await mined(driver.runOne(await f.agent.getAddress(), await f.engine.getAddress(), await outputIds('TASK_DONE|1'), mask(7), { gasLimit: 2000000 })); assert.equal((await f.agent.taskOf(owner, 1)).done, true); assert.equal(await f.agent.taskCount(owner), 64n);
  const missing = await begin(f, mask(7)); await complete(f, missing, 'TASK_DONE|1', 3, 7);
  const listing = await begin(f, mask(6)); await complete(f, listing, 'TASK_LIST|SELF'); assert.equal(abi.decode(['tuple(bytes title,bool done)[]'], (await f.agent.resultOf(listing))[1])[0].length, 0);
  mark('task_cap_and_namespace');
});

test('SELF balance reads resolve the original owner and token failures use bounded static calls', async () => {
  const f = await fixture(); await mined(f.token.setBalance(aliceAddress, 777)); await mined(f.token.setBalance(await f.agent.getAddress(), 999));
  const native = await begin(f, mask(1)); await mined(f.engine.setOutput(native, await outputIds('BALANCE|SELF|ETH'), true)); const balance = await provider.getBalance(aliceAddress); await finalize(f, native); assert.equal(abi.decode(['uint256'], (await f.agent.resultOf(native))[1])[0], balance);
  const token = await begin(f, mask(2)); await mined(f.engine.setOutput(token, await outputIds('BALANCE|SELF|GH0ST'), true));
  let guardedGas = null;
  for (let gasLimit = 100000; gasLimit <= 250000; gasLimit += 25000) {
    try { await f.agent.connect(bob).finalize.staticCall(token, { gasLimit }); }
    catch (error) { try { if (f.agent.interface.parseError(error.data)?.name === 'InsufficientGas') { guardedGas = gasLimit; break; } } catch { /* ordinary out-of-gas is not the targeted guard */ } }
  }
  assert.ok(guardedGas !== null, 'Fixed-budget token read must expose its insufficient-gas guard');
  await assert.rejects(async () => { const tx = await f.agent.connect(bob).finalize(token, { gasLimit: guardedGas }); await tx.wait(); });
  assert.equal(Number((await f.agent.requests(token)).outcome), 1, 'Low-gas third-party finalizer must not settle the request');
  await finalize(f, token); assert.equal(abi.decode(['uint256'], (await f.agent.resultOf(token))[1])[0], 777n);
  for (const mode of [1, 2, 3, 5, 6]) { await mined(f.token.setMode(mode)); const id = await begin(f, mask(2)); await mined(f.engine.setOutput(id, await outputIds('BALANCE|SELF|GH0ST'), true)); const receipt = await finalize(f, id, 3, 10); assert.ok(receipt.gasUsed < 750000n); }
  await mined(f.token.setMode(0)); const changed = await begin(f, mask(2)); await mined(f.engine.setOutput(changed, await outputIds('BALANCE|SELF|GH0ST'), true)); const code = await provider.getCode(await f.token.getAddress()); await rpc.request({ method: 'evm_setAccountCode', params: [await f.token.getAddress(), '0x00'] }); await finalize(f, changed, 3, 9); await rpc.request({ method: 'evm_setAccountCode', params: [await f.token.getAddress(), code] });
  mark('self_balances_and_bounded_token_calls');
});

test('engine callbacks cannot reenter controller begin or finalize', async () => {
  const f = await fixture(); const nested = f.agent.interface.encodeFunctionData('begin', ['nested', 32, mask(0)]);
  await mined(f.engine.configureReentry(await f.agent.getAddress(), nested, true, false, false)); const id = await begin(f, mask(0)); assert.equal(await f.engine.reentryAttempted(), true); assert.equal(await f.engine.lastReentrySucceeded(), false);
  await mined(f.engine.configureReentry(await f.agent.getAddress(), f.agent.interface.encodeFunctionData('finalize', [id]), false, true, false)); await mined(f.engine.setCompletion(id, await outputIds('WAIT'))); await mined(f.agent.connect(bob).advance(id, 32)); assert.equal(await f.engine.lastReentrySucceeded(), false); await finalize(f, id);
  await assert.rejects(f.agent.finalize.staticCall(id)); mark('reentrancy');
});

test('real tiny integer engine emits exact WAIT/EOS logits and controller executes the committed action', { timeout: 180000 }, async () => {
  const directory = join(temporary, 'tiny-wait'), manifest = JSON.parse(readFileSync(join(directory, 'model.json'))), addresses = [];
  for (const shard of manifest.shards) { const receipt = await mined(alice.sendTransaction({ data: shard.initCodeHex, gasLimit: 6000000 })); addresses.push(receipt.contractAddress); assert.equal(keccak256(await provider.getCode(receipt.contractAddress)), shard.runtimeKeccak256); }
  const a = manifest.constructor;
  const model = await deploy('contracts/S0ULModel.sol', 'S0ULModel', [a.config, a.sourceCheckpoint, a.manifestHash, addresses, manifest.shards.map(shard => shard.runtimeKeccak256), a.shardBytes]);
  const engine = await deploy('contracts/S0ULInference.sol', 'S0ULInference', [await model.getAddress(), await tokenizer.getAddress()]);
  const token = await deploy('tests/fixtures/S0ULAgentMocks.sol', 'MockS0ULBalanceToken');
  const agent = await deploy('contracts/S0ULAgent.sol', 'S0ULAgent', [await engine.getAddress(), keccak256(await provider.getCode(await engine.getAddress())), await model.modelId(), await token.getAddress()]);
  const id = await engine.nextRequestId(); await mined(agent.beginConstrained('Wait.', 2, mask(0), actionHash('WAIT')));
  let steps = 0, decisions = 0, gas = 0n;
  while (true) { const state = await engine.status(id); if (state.done) break; if (Number(state.phase) === 16) { const expected = references.tiny.decisions[decisions++]; assert.deepEqual(Array.from(await engine.tokens(id), Number), expected.prefix); assert.deepEqual(Array.from(await engine.logits(id), Number), expected.logits); } const receipt = await mined(agent.connect(bob).advanceBatch(id, 128, 4, { gasLimit: 12000000 })); gas += receipt.gasUsed; assert.ok(++steps < 250); }
  assert.equal(decisions, 2); assert.deepEqual(Array.from(await engine.outputTokens(id), Number), [268, 2]);
  assert.equal(await agent.advanceBatch.staticCall(id, 128, 4), true, 'Done requests must stop without another engine step');
  await mined(agent.connect(bob).finalize(id)); assert.equal(Number((await agent.requests(id)).outcome), 2); assert.equal(Number((await agent.requests(id)).action), 0); assert.equal((await agent.resultOf(id))[0], hex('WAIT')); assert.equal(await agent.stateRevision(aliceAddress), 0n);
  report.real_engine_integration = { source_kind: 'constructed tiny fixture; not trained checkpoint', parameter_count: references.tiny.parameter_count, exact_logit_values: 1024, output_ids: [268, 2], committed_action: 'WAIT', executed: true, permissionless_batch_transactions: steps, maximum_steps_per_batch: 4, select_boundaries_observed: decisions, continuation_gas: String(gas), saturation_count: String((await engine.status(id)).saturationCount) };
  mark('real_tiny_engine_wait_eos_integration');
});
