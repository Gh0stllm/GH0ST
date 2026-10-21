import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { AbiCoder, BrowserProvider, ContractFactory, Interface, ZeroHash, keccak256, toUtf8Bytes } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const inlineMock = `pragma solidity 0.8.30;
contract GreetingControllerMock {
 struct Binding{address owner;uint16 allowedActions;uint64 stateRevision;bool adopted;uint8 outcome;uint8 action;uint8 reason;bytes32 promptHash;bytes32 outputHash;bytes32 expectedActionHash;}
 address public engine;address public model;address public tokenizer;bytes32 public modelId;bytes32 public sourceCheckpoint;
 bytes32 public engineCodeHash;bytes32 public modelCodeHash;bytes32 public tokenizerCodeHash;
 mapping(uint256=>Binding)public requests;mapping(uint256=>bytes)private outputs;
 constructor(address e,address m,address t,bytes32 id,bytes32 cp){engine=e;model=m;tokenizer=t;modelId=id;sourceCheckpoint=cp;engineCodeHash=e.codehash;modelCodeHash=m.codehash;tokenizerCodeHash=t.codehash;}
 function set(uint256 id,address owner,uint8 outcome,bytes32 outputHash,bytes32 expected,bytes calldata output)external{requests[id]=Binding(owner,1,0,true,outcome,0,0,0,outputHash,expected);outputs[id]=output;}
 function resultOf(uint256 id)external view returns(bytes memory,bytes memory){return(outputs[id],bytes(''));}
}`;

test('isolated Hello World tool validates real controller provenance, ownership and replay, including CLI', { timeout: 120000 }, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 's0ul-greeting-test-'));
  const reportPath = join(root, 'reports/solidity-agent-greeting-local.json'); rmSync(reportPath, { force: true });
  const production = json(process.env.S0UL_AGENT_BUILD ?? '/tmp/s0ul-agent-build.json');
  for (const [name, hash] of Object.entries(production.sourceSha256)) assert.equal(sha(readFileSync(join(root, 'contracts', name))), hash, 'Existing contract fingerprint changed');
  const greetingSource = readFileSync(join(root, 'extensions/S0ULAgentGreeting.sol'), 'utf8');
  const sources = { 'S0ULAgentGreeting.sol': { content: greetingSource }, 'GreetingControllerMock.sol': { content: inlineMock }, 'S0ULAgentMocks.sol': { content: readFileSync(join(root, 'tests/fixtures/S0ULAgentMocks.sol'), 'utf8') } };
  const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } };
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  assert.equal((compiled.errors ?? []).filter(error => error.severity === 'error').length, 0);
  const artifacts = { ...production.contracts, ...compiled.contracts };
  const rpc = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: false }, miner: { blockGasLimit: 30000000 }, wallet: { deterministic: true, defaultBalance: 1000000 } });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1, batchStallTime: 0 }); provider.pollingInterval = 10;
  const alice = await provider.getSigner(0), bob = await provider.getSigner(1), owner = await alice.getAddress();
  const key = Object.values(rpc.getInitialAccounts())[0].secretKey; // Disposable local fixture only.
  let http, rawBroadcasts = 0;
  const children = new Set();
  const stop = () => { for (const child of children) child.kill('SIGKILL'); }; t.signal.addEventListener('abort', stop);
  const mined = async promise => { const tx = await promise; return await provider.getTransactionReceipt(tx.hash) ?? tx.wait(); };
  const deploy = async (file, name, args = []) => { const a = artifacts[file][name]; const c = await new ContractFactory(a.abi, a.evm.bytecode.object, alice).deploy(...args, { gasLimit: 12000000 }); await c.waitForDeployment(); return c; };
  try {
    const modelId = keccak256(toUtf8Bytes('greeting-fixture-model')), checkpoint = keccak256(toUtf8Bytes('greeting-fixture-checkpoint')), waitHash = keccak256(toUtf8Bytes('WAIT'));
    const tokenizer = await deploy('S0ULTokenizer.sol', 'S0ULTokenizer');
    const model = await deploy('S0ULAgentMocks.sol', 'MockS0ULModel', [modelId, checkpoint]);
    const engine = await deploy('S0ULAgentMocks.sol', 'MockS0ULEngine', [await model.getAddress(), await tokenizer.getAddress()]);
    const token = await deploy('S0ULAgentMocks.sol', 'MockS0ULBalanceToken');
    const codeHash = async address => keccak256(await provider.getCode(address));
    const controller = await deploy('S0ULAgent.sol', 'S0ULAgent', [await engine.getAddress(), await codeHash(await engine.getAddress()), modelId, await token.getAddress()]);
    const controllerHash = await codeHash(await controller.getAddress());
    await assert.rejects(deploy('S0ULAgentGreeting.sol', 'S0ULAgentGreeting', [await controller.getAddress(), ZeroHash, modelId]));
    await assert.rejects(deploy('S0ULAgentGreeting.sol', 'S0ULAgentGreeting', [await controller.getAddress(), controllerHash, checkpoint]));
    const greeting = await deploy('S0ULAgentGreeting.sol', 'S0ULAgentGreeting', [await controller.getAddress(), controllerHash, modelId]);
    const begin = async constrained => { const id = await engine.nextRequestId(); await mined(constrained ? controller.beginConstrained('fixture', 32, 1, waitHash) : controller.begin('fixture', 32, 1)); return id; };
    const ready = async id => { await mined(engine.setOutput(id, [268, 2], true)); await mined(controller.finalize(id)); };
    const id = await begin(true); await ready(id);
    const adapterControllerABI = new Interface(compiled.contracts['S0ULAgentGreeting.sol'].IS0ULGreetingController.abi);
    const rawBinding = await provider.call({ to: await controller.getAddress(), data: controller.interface.encodeFunctionData('requests', [id]) });
    assert.equal(adapterControllerABI.decodeFunctionResult('requests', rawBinding)[0].owner, owner, 'Actual flattened getter/static-tuple ABI mismatch');
    assert.equal(await greeting.messageOf(id), ''); assert.equal(await greeting.used(id), false);
    await assert.rejects(greeting.connect(bob).sayHello.staticCall(id));
    const incomplete = await begin(true); await assert.rejects(greeting.sayHello.staticCall(incomplete));
    const unconstrained = await begin(false); await ready(unconstrained); await assert.rejects(greeting.sayHello.staticCall(unconstrained));
    await mined(engine.setOutput(id, [267, 2], true)); await assert.rejects(greeting.sayHello.staticCall(id)); await mined(engine.setOutput(id, [268, 2], true));
    await mined(model.setIdentity(modelId, ZeroHash)); await assert.rejects(greeting.sayHello.staticCall(id)); await mined(model.setIdentity(modelId, checkpoint));
    assert.equal(await greeting.sayHello.staticCall(id), 'Hello World');
    const receipt = await mined(greeting.sayHello(id));
    const event = receipt.logs.map(log => { try { return greeting.interface.parseLog(log); } catch { return null; } }).find(event => event?.name === 'Greeting');
    assert.ok(event); assert.equal(event.args.requestId, id); assert.equal(event.args.owner, owner); assert.equal(event.args.controller, await controller.getAddress()); assert.equal(event.args.modelId, modelId); assert.equal(event.args.sourceOutputHash, (await controller.requests(id)).outputHash); assert.equal(event.args.sourceActionHash, waitHash); assert.equal(event.args.message, 'Hello World');
    assert.equal(await greeting.used(id), true); assert.equal(await greeting.messageOf(id), 'Hello World'); await assert.rejects(greeting.sayHello.staticCall(id));

    const mockController = await deploy('GreetingControllerMock.sol', 'GreetingControllerMock', [await engine.getAddress(), await model.getAddress(), await tokenizer.getAddress(), modelId, checkpoint]);
    const mockGreeting = await deploy('S0ULAgentGreeting.sol', 'S0ULAgentGreeting', [await mockController.getAddress(), await codeHash(await mockController.getAddress()), modelId]);
    const direct = await engine.nextRequestId(); await mined(engine.beginText('fixture', 32)); await mined(engine.setOutput(direct, [268, 2], true));
    const outputHash = keccak256(AbiCoder.defaultAbiCoder().encode(['uint16[]'], [[268, 2]]));
    await mined(mockController.set(direct, owner, 2, outputHash, keccak256(toUtf8Bytes('MEM_GET|theme')), toUtf8Bytes('WAIT')));
    await assert.rejects(mockGreeting.sayHello.staticCall(direct)); assert.equal(await mockGreeting.used(direct), false);
    await mined(mockController.set(direct, owner, 2, ZeroHash, waitHash, toUtf8Bytes('WAIT'))); await assert.rejects(mockGreeting.sayHello.staticCall(direct));
    await mined(mockController.set(direct, owner, 2, outputHash, waitHash, toUtf8Bytes('WAIT')));
    await mined(engine.setFlags(direct, 16, true, false, 0)); await assert.rejects(mockGreeting.sayHello.staticCall(direct)); await mined(engine.setFlags(direct, 17, true, false, 0));
    await mined(controller.adoptConstrained(direct, 1, waitHash)); await mined(controller.finalize(direct));
    await mined(greeting.sayHello(direct)); assert.equal(await greeting.messageOf(direct), 'Hello World');

    // Focused CLI happy path uses only this loopback node and in-memory test key.
    http = createServer(async (request, response) => {
      let body = ''; for await (const part of request) body += part;
      const serve = async payload => { try { if (payload.method === 'eth_sendRawTransaction') rawBroadcasts++; return { jsonrpc: '2.0', id: payload.id, result: await rpc.request({ method: payload.method, params: payload.params ?? [] }) }; } catch (error) { return { jsonrpc: '2.0', id: payload.id, error: { code: error.code ?? -32000, message: error.message } }; } };
      const value = JSON.parse(body), result = Array.isArray(value) ? await Promise.all(value.map(serve)) : await serve(value); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(result));
    });
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    const basePath = join(temporary, 'base.json'), agentPath = join(temporary, 'agent.json'), buildPath = join(temporary, 'greeting-build.json'), controllerBuildPath = join(temporary, 'controller-build.json'), deployedPath = join(temporary, 'greeting.json'), saidPath = join(temporary, 'said.json');
    const base = { chainId: '31337', complete: true, pending: null, engine: await engine.getAddress(), model: await model.getAddress(), tokenizer: await tokenizer.getAddress(), engineCodeHash: await codeHash(await engine.getAddress()), modelCodeHash: await codeHash(await model.getAddress()), tokenizerCodeHash: await codeHash(await tokenizer.getAddress()), modelId, sourceCheckpoint: checkpoint };
    const agent = { chainId: '31337', complete: true, pending: null, controller: await controller.getAddress(), controllerCodeHash: controllerHash, engine: base.engine, modelId };
    const greetingBuild = { compiler: solc.version(), optimizerRuns: 200, viaIR: true, evmVersion: 'shanghai', sourceSha256: { 'S0ULAgentGreeting.sol': sha(greetingSource) }, contracts: { 'S0ULAgentGreeting.sol': compiled.contracts['S0ULAgentGreeting.sol'] } };
    write(basePath, base); write(agentPath, agent); write(buildPath, greetingBuild); write(controllerBuildPath, production);
    const cliPath = join(root, 'scripts/s0ul-agent-greeting.mjs');
    const run = args => new Promise((resolve, reject) => { const child = spawn(process.execPath, [cliPath, ...args, '--rpc', `http://127.0.0.1:${http.address().port}`, '--rpc-rps', '0', '--chain-id', '31337', '--private-key-env', 'S0UL_LOCAL_GREETING_KEY', '--deployment', basePath, '--agent', agentPath, '--agent-build', controllerBuildPath, '--build', buildPath, '--request-id', String(direct)], { cwd: root, env: { ...process.env, S0UL_LOCAL_GREETING_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child); let stdout = '', stderr = ''; child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; }); child.once('error', reject); child.once('close', code => { children.delete(child); assert.equal((stdout + stderr).includes(key), false); resolve({ code, stdout, stderr }); }); });
    const cliDeploy = await run(['deploy', '--output', deployedPath]); assert.equal(cliDeploy.code, 0, cliDeploy.stderr); assert.equal(json(deployedPath).complete, true);
    const cliSay = await run(['say', '--greeting', deployedPath, '--output', saidPath]); assert.equal(cliSay.code, 0, cliSay.stderr); assert.equal(json(saidPath).event.message, 'Hello World');
    const sends = rawBroadcasts, replay = await run(['say', '--greeting', deployedPath, '--output', join(temporary, 'replay.json')]); assert.notEqual(replay.code, 0); assert.equal(rawBroadcasts, sends);
    const resumed = await run(['say', '--greeting', deployedPath, '--resume', saidPath]); assert.equal(resumed.code, 0, resumed.stderr); assert.equal(rawBroadcasts, sends);
    mkdirSync(dirname(reportPath), { recursive: true });
    write(reportPath, { format: 's0ul-agent-greeting-local-v1', recorded_utc: new Date().toISOString(), extension_sha256: sha(greetingSource), cli_sha256: sha(readFileSync(cliPath)), extension_runtime_bytes: compiled.contracts['S0ULAgentGreeting.sol'].S0ULAgentGreeting.evm.deployedBytecode.object.length / 2, chain_id: 31337, public_transactions: 0, existing_contract_source_fingerprints_unchanged: true, actual_controller_abi_compatible: true, checked: ['constructor pins', 'completed constrained controller-owned request', 'completed constrained directly adopted request', 'wrong owner', 'incomplete request', 'unconstrained request', 'mismatched commitment', 'token-array hash mismatch', 'nonterminal phase', 'changed model checkpoint', 'exact Greeting event and Hello World message', 'used and replay prevention', 'CLI deploy/say', 'CLI no-send replay rejection and exact-hash resume'], cli_signed_broadcasts: rawBroadcasts, message: 'Hello World', message_origin: 'deterministic greeting tool, not neural text', full_trained_model_executed: false, all_checks_passed: true });
  } finally {
    stop(); await Promise.allSettled([...children].map(child => new Promise(resolve => child.once('close', resolve)))); if (http) { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); }
    await provider.destroy(); await rpc.disconnect(); t.signal.removeEventListener('abort', stop); rmSync(temporary, { recursive: true, force: true });
  }
});
