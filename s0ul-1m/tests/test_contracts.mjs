import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, ZeroHash, encodeBytes32String, toUtf8Bytes, toUtf8String } from 'ethers';

const base = fileURLToPath(new URL('../', import.meta.url));
const sources = Object.fromEntries(['S0ULMemory.sol', 'S0ULActionGate.sol', 'S0ULInt8Kernel.sol'].map(name =>
  [name, { content: readFileSync(`${base}contracts/${name}`, 'utf8') }]));
sources['TestBalanceToken.sol'] = { content: `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract TestBalanceToken {
    mapping(address => uint256) public balanceOf;
    constructor(address account) { balanceOf[account] = 37; }
}` };
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
})));
const errors = (output.errors ?? []).filter(error => error.severity === 'error');
assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
let rpc, provider, alice, bob, aliceAddress, bobAddress, memory, gate, token, kernel;
const key = encodeBytes32String;
const bytes = toUtf8Bytes;
const proposal = (kind, args = {}) => ({ kind, key: ZeroHash, value: '0x', taskId: 0, token: ZeroAddress, ...args });
async function deploy(file, name, args = []) {
  const artifact = output.contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, alice).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { deterministic: true } });
  provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  alice = await provider.getSigner(0);
  bob = await provider.getSigner(1);
  aliceAddress = await alice.getAddress();
  bobAddress = await bob.getAddress();
  memory = await deploy('S0ULMemory.sol', 'S0ULMemory');
  token = await deploy('TestBalanceToken.sol', 'TestBalanceToken', [aliceAddress]);
  gate = await deploy('S0ULActionGate.sol', 'S0ULActionGate', [[await token.getAddress()]]);
  kernel = await deploy('S0ULInt8Kernel.sol', 'S0ULInt8Kernel');
});

after(async () => {
  await provider?.destroy();
  await rpc?.disconnect();
});

test('memory writes and deletes are isolated to msg.sender', async () => {
  const slot = key('theme');
  await (await memory.remember(slot, bytes('dark'))).wait();
  assert.equal(toUtf8String(await memory.recall(slot)), 'dark');
  assert.equal(await memory.connect(bob).recall(slot), '0x');
  assert.equal(await memory.connect(bob).forget.staticCall(slot), false);
  await (await memory.connect(bob).remember(slot, bytes('light'))).wait();
  assert.equal(toUtf8String(await memory.recall(slot)), 'dark');
  assert.equal(toUtf8String(await memory.connect(bob).recall(slot)), 'light');
  await (await memory.connect(bob).forget(slot)).wait();
  assert.equal(toUtf8String(await memory.recall(slot)), 'dark');
  assert.equal(await memory.entryCount(bobAddress), 0n);
});

test('memory enforces nonempty keys and values and the exact byte bound', async () => {
  await assert.rejects(memory.remember.staticCall(ZeroHash, bytes('dark')));
  await assert.rejects(memory.remember.staticCall(key('empty'), '0x'));
  await assert.rejects(memory.remember.staticCall(key('long'), bytes('x'.repeat(129))));
  await assert.rejects(memory.forget.staticCall(ZeroHash));
  await (await memory.remember(key('boundary'), bytes('x'.repeat(128)))).wait();
  assert.equal((await memory.recall(key('boundary'))).length, 258);
});

test('memory caps entries, permits replacement at capacity and recovers a slot after delete', async () => {
  const local = await deploy('S0ULMemory.sol', 'S0ULMemory');
  for (let index = 0; index < 32; index++) await (await local.remember(key(`slot_${index}`), bytes('value'))).wait();
  assert.equal(await local.entryCount(aliceAddress), 32n);
  await assert.rejects(local.remember.staticCall(key('overflow'), bytes('value')));
  await (await local.remember(key('slot_0'), bytes('replacement'))).wait();
  assert.equal(await local.entryCount(aliceAddress), 32n);
  await (await local.forget(key('slot_0'))).wait();
  assert.equal(await local.entryCount(aliceAddress), 31n);
  await (await local.remember(key('overflow'), bytes('allowed'))).wait();
  assert.equal(await local.entryCount(aliceAddress), 32n);
});

test('native and allowlisted token reads bind the queried account to the caller', async () => {
  assert.equal(await gate.nativeBalance(), await provider.getBalance(aliceAddress));
  assert.equal(await gate.tokenBalance(await token.getAddress()), 37n);
  assert.equal(await gate.connect(bob).tokenBalance(await token.getAddress()), 0n);
  await assert.rejects(gate.tokenBalance(ZeroAddress));
  await assert.rejects(gate.tokenBalance(bobAddress));
});

test('constructor rejects EOAs and duplicate token entries', async () => {
  await assert.rejects(deploy('S0ULActionGate.sol', 'S0ULActionGate', [[bobAddress]]));
  await assert.rejects(deploy('S0ULActionGate.sol', 'S0ULActionGate', [[await token.getAddress(), await token.getAddress()]]));
});

test('all supported typed actions and canonical clarification/refusal arguments validate', async () => {
  const vectors = [proposal(0), proposal(1), proposal(2, { token: await token.getAddress() }),
    proposal(3, { key: key('theme'), value: bytes('dark') }), proposal(4, { key: key('mode') }),
    proposal(5, { value: bytes('review_1') }), proposal(6), proposal(7, { taskId: 1 }), proposal(7, { taskId: 9999 })];
  for (const field of ['asset', 'key', 'value', 'title', 'task_id', 'request']) vectors.push(proposal(8, { key: key(field) }));
  for (const reason of ['unsupported', 'unauthorized', 'unsafe']) vectors.push(proposal(9, { key: key(reason) }));
  for (const vector of vectors) assert.equal(await gate.validateProposal(vector), true);
});

test('unknown actions, unsupported keys, unsafe slugs, out-of-range IDs and extra fields fail', async () => {
  const vectors = [proposal(10), proposal(255), proposal(0, { taskId: 1 }),
    proposal(1, { token: await token.getAddress() }), proposal(2, { token: bobAddress }),
    proposal(3, { key: key('owner'), value: bytes('alice') }), proposal(4, { key: key('theme'), value: bytes('dark') }),
    proposal(7, { taskId: 0 }), proposal(7, { taskId: 10000 }), proposal(8, { key: key('arbitrary') }),
    proposal(9, { key: key('arbitrary') })];
  for (const value of ['', 'UPPER', '0first', 'bad-hyphen', 'bad|pipe', 'x'.repeat(25), 'é']) {
    vectors.push(proposal(3, { key: key('theme'), value: bytes(value) }));
    vectors.push(proposal(5, { value: bytes(value) }));
  }
  for (const vector of vectors) await assert.rejects(gate.validateProposal(vector));
});

test('proposal checks leave memory untouched and expose no arbitrary execution entrypoint', async () => {
  const before = await memory.recall(key('theme'));
  await gate.validateProposal(proposal(3, { key: key('theme'), value: bytes('changed') }));
  assert.equal(await memory.recall(key('theme')), before);
  const functions = output.contracts['S0ULActionGate.sol'].S0ULActionGate.abi.filter(item => item.type === 'function');
  assert.ok(functions.every(item => item.stateMutability === 'view' || item.stateMutability === 'pure'));
  assert.ok(!functions.some(item => /execute|transfer|approve|call|setToken/.test(item.name)));
});

// Independent arithmetic oracle: no model or exporter arithmetic is imported.
const packed = values => '0x' + values.map(value => ((value + 256) % 256).toString(16).padStart(2, '0')).join('');
const oracle = (weights, activations) => weights.reduce((sum, weight, index) => sum + BigInt(weight) * BigInt(activations[index]), 0n);
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function deployDataShard(weights) {
  const runtime = '00' + packed(weights).slice(2); // STOP prefix, then packed signed-byte row.
  const length = (runtime.length / 2).toString(16).padStart(4, '0');
  // PUSH2 len; PUSH1 0x0e; PUSH1 0; CODECOPY; PUSH2 len; PUSH1 0; RETURN.
  const init = `61${length}600e60003961${length}6000f3${runtime}`;
  const tx = await alice.sendTransaction({ data: '0x' + init });
  const receipt = await tx.wait();
  assert.equal(await provider.getCode(receipt.contractAddress), '0x' + runtime);
  return receipt.contractAddress;
}

test('integer dot matches an independent BigInt oracle at odd dimensions and signed extremes', async () => {
  const vectors = [
    { weights: [-128], activations: [-2147483648] },
    { weights: [127], activations: [2147483647] },
    { weights: [-128, 127, 0], activations: [-2147483648, 2147483647, -1] },
    { weights: [127, -128, 1, -1, 0], activations: [7, -8, -9, 10, 2147483647] },
  ];
  let state = 4731;
  for (const width of [7, 31, 128, 640]) {
    const weights = [], activations = [];
    for (let index = 0; index < width; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      weights.push((state & 255) - 128);
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      activations.push(state | 0);
    }
    vectors.push({ weights, activations });
  }
  for (const { weights, activations } of vectors) assert.equal(await kernel.dot(packed(weights), activations), oracle(weights, activations));
});

test('integer dot rejects empty, mismatched and oversized dimensions and INT32 overflow', async () => {
  await assert.rejects(kernel.dot('0x', []));
  await assert.rejects(kernel.dot('0x01', []));
  await assert.rejects(kernel.dot('0x0102', [1]));
  await assert.rejects(kernel.dot(packed(Array(641).fill(1)), Array(641).fill(1)));
  await assert.rejects(kernel.dot('0x01', [2147483648]));
  await assert.rejects(kernel.dot('0x01', [-2147483649]));
});

test('bytecode rows match the oracle and reject absent code, bad offsets and cross-boundary reads', async () => {
  const weights = [-128, 0, 127, -1, 1];
  const activations = [2147483647, -1, -2147483648, 12, -44];
  const address = await deployDataShard(weights);
  assert.equal(await kernel.dotFromCode(address, 1, activations), oracle(weights, activations));
  assert.equal(await kernel.dotFromCode(address, 2, activations.slice(1)), oracle(weights.slice(1), activations.slice(1)));
  await assert.rejects(kernel.dotFromCode(bobAddress, 0, [1]));
  await assert.rejects(kernel.dotFromCode(address, 7, [1]));
  await assert.rejects(kernel.dotFromCode(address, 2, activations));
  await assert.rejects(kernel.dotFromCode(address, (1n << 256n) - 1n, [1]));
  await assert.rejects(kernel.dotFromCode(address, 0, []));
});

test('record measured local EVM row-dot gas with compiler and bytecode hashes', async () => {
  const measurements = [];
  for (const width of [128, 640]) {
    const weights = Array.from({ length: width }, (_, index) => ((index * 37 + 11) % 255) - 127);
    const activations = Array.from({ length: width }, (_, index) => ((index * 104729 + 19) % 2000001) - 1000000);
    const address = await deployDataShard(weights);
    const expected = oracle(weights, activations);
    for (const [method, args] of [['dot', [packed(weights), activations]], ['dotFromCode', [address, 1, activations]]]) {
      const txRequest = await kernel[method].populateTransaction(...args);
      const receipt = await (await alice.sendTransaction(txRequest)).wait();
      assert.equal(await kernel[method](...args), expected);
      measurements.push({ method, width, expected_sum: expected.toString(), measured_transaction_gas: receipt.gasUsed.toString(),
        calldata_bytes: (txRequest.data.length - 2) / 2, transaction_includes_intrinsic_gas: true,
        weights_sha256: sha256(Buffer.from(packed(weights).slice(2), 'hex')) });
    }
  }
  const artifact = output.contracts['S0ULInt8Kernel.sol'].S0ULInt8Kernel;
  const sourceBytes = readFileSync(`${base}contracts/S0ULInt8Kernel.sol`);
  const report = {
    schema_version: 1, scope: 'local EVM signed INT8 row-dot primitive; NOT complete inference, agent execution or Robinhood Chain gas',
    network: 'in-process Ganache, no external chain transactions', solc_version: solc.version(),
    optimizer: { enabled: true, runs: 200 }, evm_version: 'shanghai',
    arithmetic: { weights: 'signed INT8 [-128,127]', activations: 'signed INT32', accumulator: 'signed INT256',
      max_width: 640, scaling: 'none', rounding: 'none' },
    source_sha256: sha256(sourceBytes), init_code_sha256: sha256(Buffer.from(artifact.evm.bytecode.object, 'hex')),
    runtime_code_sha256: sha256(Buffer.from(artifact.evm.deployedBytecode.object, 'hex')),
    runtime_code_bytes: artifact.evm.deployedBytecode.object.length / 2, measurements,
  };
  mkdirSync(`${base}reports`, { recursive: true });
  writeFileSync(`${base}reports/evm-kernel.json`, JSON.stringify(report, null, 2) + '\n');
  assert.equal(measurements.length, 4);
});
