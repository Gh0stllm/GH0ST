import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, keccak256, toUtf8Bytes, concat, toBeHex, zeroPadValue } from 'ethers';

export const base = fileURLToPath(new URL('../../', import.meta.url));
export const compilationSettings = {
  optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
};

export function compileResearch() {
  const files = ['contracts/GH0STPolicyHook.sol', 'contracts/IFinalizedPolicySource.sol', 'tests/evm/ResearchHarness.sol'];
  const sources = Object.fromEntries(files.map(file => [file, { content: readFileSync(path.join(base, file), 'utf8') }]));
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: compilationSettings }), {
    import(importPath) {
      try {
        return { contents: readFileSync(path.join(base, importPath.startsWith('@') ? 'node_modules' : '', importPath), 'utf8') };
      } catch (error) { return { error: String(error) }; }
    },
  }));
  const errors = (output.errors ?? []).filter(entry => entry.severity === 'error');
  assert.equal(errors.length, 0, errors.map(entry => entry.formattedMessage).join('\n'));
  return output;
}

export const params = { zeroForOne: true, amountSpecified: -1000n, sqrtPriceLimitX96: 4295128740n };
export const hash = value => keccak256(toUtf8Bytes(value));

export async function createFixture(compiled, overrides = {}) {
  const rpc = ganache.provider({
    logging: { quiet: true }, chain: { hardfork: 'shanghai' },
    wallet: { deterministic: true }, miner: { blockGasLimit: 30_000_000, timestampIncrement: 0 },
  });
  const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const alice = await provider.getSigner(0);
  const bob = await provider.getSigner(1);
  const deploy = async (file, name, args = []) => {
    const artifact = compiled.contracts[file][name];
    const instance = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, alice).deploy(...args);
    await instance.waitForDeployment();
    return instance;
  };
  const manager = await deploy('tests/evm/ResearchHarness.sol', 'V4CallbackHarness');
  const source = await deploy('tests/evm/ResearchHarness.sol', 'MockAttestedPolicySource', [await alice.getAddress()]);
  const factory = await deploy('tests/evm/ResearchHarness.sol', 'ResearchCreate2Factory');
  const modelHash = hash('research-fixture-model-hash-not-a-loaded-neural-model');
  const config = {
    manager: await manager.getAddress(), source: await source.getAddress(),
    currency0: '0x0000000000000000000000000000000000000100',
    currency1: '0x0000000000000000000000000000000000000200', tickSpacing: 60,
    modelHash, minimumFee: 500, maximumFee: 10_000, fallbackFee: 3000,
    maximumTickDrift: 120, maximumPolicyAgeSeconds: 600, ...overrides,
  };
  const artifact = compiled.contracts['contracts/GH0STPolicyHook.sol'].GH0STPolicyHook;
  const request = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, alice).getDeployTransaction(config);
  const initHash = keccak256(request.data);
  const factoryAddress = await factory.getAddress();
  let salt, hookAddress, attempts;
  // afterInitialize | beforeSwap | afterSwap, no returned-accounting-delta flags.
  const requiredFlags = (1n << 12n) | (1n << 7n) | (1n << 6n);
  for (attempts = 0; attempts < 2_000_000; attempts++) {
    salt = zeroPadValue(toBeHex(attempts), 32);
    hookAddress = '0x' + keccak256(concat(['0xff', factoryAddress, salt, initHash])).slice(-40);
    if ((BigInt(hookAddress) & ((1n << 14n) - 1n)) === requiredFlags) break;
  }
  assert.ok(attempts < 2_000_000, 'CREATE2 address flag search exhausted');
  const deployment = await (await factory.deploy(salt, request.data, { gasLimit: 8_000_000 })).wait();
  const hook = new Contract(hookAddress, artifact.abi, alice);
  const key = { currency0: config.currency0, currency1: config.currency1, fee: 0x800000, tickSpacing: config.tickSpacing, hooks: hookAddress };
  await (await manager.initialize(key, 0)).wait();
  const poolId = await hook.poolId();
  const policy = async (overrides = {}) => {
    const id = await hook.latestSnapshotId();
    const observation = await hook.snapshot(id);
    return {
      poolId, modelHash, snapshotHash: observation.stateHash, inputHash: hash('fixture-features-no-inference'),
      nonce: 1n, snapshotId: id, notBefore: observation.timestamp,
      expiresAt: observation.timestamp + 300n, lpFee: 5000n, finalized: 1n, ...overrides,
    };
  };
  const publish = async overrides => {
    const value = await policy(overrides);
    await (await source.publish(value)).wait();
    return value;
  };
  const close = async () => { await provider.destroy(); await rpc.disconnect(); };
  return { rpc, provider, alice, bob, manager, source, factory, hook, key, modelHash, config, poolId, policy, publish,
    deployment, close, create2Attempts: attempts + 1, compiled };
}

export const Reason = {
  Accepted: 0n, SourceUnavailable: 1n, NotFinalized: 2n, WrongPool: 3n, WrongModel: 4n,
  InvalidMetadata: 5n, NonceRollback: 6n, SnapshotMissing: 7n, SnapshotMismatch: 8n,
  SameBlockSnapshot: 9n, NotYetValid: 10n, Expired: 11n, WindowTooLong: 12n,
  TickDrift: 13n, FeeOutOfRange: 14n, SnapshotRollback: 15n, NonceReuseMismatch: 16n,
};

export async function expectReason(fixture, expectedReason, expectedFee = 3000n) {
  const actual = await fixture.hook.quotePolicy();
  assert.equal(actual.reason, expectedReason);
  assert.equal(actual.fee, expectedFee);
  return actual;
}
