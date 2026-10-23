import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, BrowserProvider, Contract, ContractFactory, Interface, MaxUint256, ZeroAddress,
  getCreate2Address, keccak256, toBeHex, zeroPadValue } from 'ethers';
import solc from 'solc';
import solcV4 from 'solc-v4';
import hre from 'hardhat';
import { integerSqrt, decimalFraction, ghostPerEthToSqrtPriceX96, ghostEthPoolKey, poolIdFor,
  decodePoolSlot0, initializationTransaction, INITIALIZE_ABI } from '../../scripts/prepare-ghost-eth-pool.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hook = '0x8400bA05C94b8c476b4cE4c958DA56EE26E15040';
const ghost = '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559';
const q96 = 1n << 96n;

test('GHOST per ETH prices use exact decimal and token-unit math', () => {
  assert.equal(ghostPerEthToSqrtPriceX96('1', 18), q96);
  assert.equal(ghostPerEthToSqrtPriceX96('4', 18), q96 * 2n);
  assert.equal(ghostPerEthToSqrtPriceX96('0.25', 18), q96 / 2n);
  assert.equal(ghostPerEthToSqrtPriceX96('1', 6), q96 / 1_000_000n);
  assert.equal(ghostPerEthToSqrtPriceX96('250000', 18), q96 * 500n);
  for (const text of ['0.000123456789', '1.23456789123456789', '123456789.987654321']) {
    const { numerator, denominator } = decimalFraction(text);
    const sqrt = ghostPerEthToSqrtPriceX96(text, 18), target = numerator << 192n;
    assert.ok(sqrt * sqrt * denominator <= target);
    assert.ok((sqrt + 1n) * (sqrt + 1n) * denominator > target);
  }
  for (const invalid of ['0', '-1', '1e6', 'NaN', '', ' 1', '1.', '01'])
    assert.throws(() => ghostPerEthToSqrtPriceX96(invalid, 18));
  assert.throws(() => ghostPerEthToSqrtPriceX96('0.0000000000000000000000000000000000000000001', 18));
  assert.throws(() => ghostPerEthToSqrtPriceX96('1', -1));
  for (let i = 0n; i < 200n; i++) {
    const sqrt = integerSqrt(i);
    assert.ok(sqrt * sqrt <= i && (sqrt + 1n) * (sqrt + 1n) > i);
  }
});

test('native currency ordering, pool IDs and initialize calldata are deterministic', () => {
  const key = ghostEthPoolKey(ghost, hook);
  assert.equal(key.currency0, ZeroAddress);
  assert.equal(key.currency1.toLowerCase(), ghost);
  const independent = keccak256(AbiCoder.defaultAbiCoder().encode([
    'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)',
  ], [key]));
  assert.equal(poolIdFor(key), independent);
  assert.notEqual(poolIdFor(key), poolIdFor({ ...key, fee: 500 }));
  assert.throws(() => ghostEthPoolKey(ZeroAddress, hook));
  assert.throws(() => ghostEthPoolKey(ghost, ZeroAddress));
  const tx = initializationTransaction('0x8366a39cc670b4001a1121b8f6a443a643e40951', key, q96,
    '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6');
  assert.equal(tx.value, '0');
  assert.equal(tx.chainId, 4663);
  const parsed = new Interface(INITIALIZE_ABI).parseTransaction({ data: tx.data });
  assert.equal(parsed.name, 'initialize');
  assert.equal(parsed.args[1], q96);
  const packed = q96 | (BigInt(0xffffff - 1) << 160n) | (123n << 184n) | (3000n << 208n);
  assert.deepEqual(decodePoolSlot0(packed), { sqrt_price_x96: q96.toString(), tick: -2, protocol_fee: 123, lp_fee: 3000 });
});

test('test-only price initializes actual v4 native/token pool and liquidity settles locally', { timeout: 60_000 }, async () => {
  const appFiles = ['swap-speaker-535k/contracts/SentenceSpeakerV4Hook.sol', 'tests/evm/SentenceV4IntegrationHarness.sol'];
  const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } };
  const importer = { import: file => {
    for (const p of [path.join(root, file), path.join(root, 'node_modules', file), path.join(root, 'node_modules/@uniswap/v4-core/lib', file)])
      if (existsSync(p)) return { contents: readFileSync(p, 'utf8') };
    return { error: `Missing ${file}` };
  } };
  function compile(compiler, sources) {
    const output = JSON.parse(compiler.compile(JSON.stringify({ language: 'Solidity', settings, sources }), importer));
    assert.deepEqual((output.errors ?? []).filter(e => e.severity === 'error'), []);
    return output.contracts;
  }
  const app = compile(solc, Object.fromEntries(appFiles.map(file => [file, { content: readFileSync(path.join(root, file), 'utf8') }])));
  const coreFile = '@uniswap/v4-core/src/PoolManager.sol';
  const core = compile(solcV4, { [coreFile]: { content: readFileSync(path.join(root, 'node_modules', coreFile), 'utf8') } });
  await hre.network.provider.request({ method: 'hardhat_reset', params: [] });
  const provider = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  try {
    const signer = await provider.getSigner(), sender = await signer.getAddress();
    async function deploy(contracts, file, name, args = []) {
      const a = contracts[file][name], c = await new ContractFactory(a.abi, a.evm.bytecode.object, signer).deploy(...args);
      await c.waitForDeployment(); return c;
    }
    const manager = await deploy(core, coreFile, 'PoolManager', [sender]);
    const harness = 'tests/evm/SentenceV4IntegrationHarness.sol';
    const token = await deploy(app, harness, 'SentenceV4TestToken');
    const model = await deploy(app, harness, 'SentenceV4FailingModel');
    const factory = await deploy(app, harness, 'SentenceV4Create2Factory');
    const router = await deploy(app, harness, 'SentenceV4SettlementRouter', [manager.target]);
    const a = app[appFiles[0]].SentenceSpeakerV4Hook;
    const request = await new ContractFactory(a.abi, a.evm.bytecode.object, signer)
      .getDeployTransaction(manager.target, model.target, 12, 300_000, 3000);
    let salt, address;
    for (let i = 0; i < 2_000_000; i++) {
      salt = zeroPadValue(toBeHex(i), 32);
      address = getCreate2Address(factory.target, salt, keccak256(request.data));
      if ((BigInt(address) & 0x3fffn) === 0x1040n) break;
    }
    assert.equal(BigInt(address) & 0x3fffn, 0x1040n);
    await (await factory.deploy(salt, request.data)).wait();
    const speaker = new Contract(address, a.abi, signer);
    // This price and liquidity exist only in the isolated test; they never enter the mainnet configuration.
    const key = ghostEthPoolKey(token.target, address), price = ghostPerEthToSqrtPriceX96('250000', 18);
    const initialize = initializationTransaction(manager.target, key, price, sender);
    await (await signer.sendTransaction({ to: initialize.to, data: initialize.data, value: 0 })).wait();
    assert.equal((await router.poolState(key))[0], price);
    assert.equal((await speaker.contexts(poolIdFor(key))).initialized, true);
    assert.equal((await speaker.contexts(poolIdFor(key))).sequence, 0n);
    await assert.rejects(manager.initialize.staticCall(key, price));
    await (await token.mint(sender, 10n ** 24n)).wait();
    await (await token.approve(router.target, MaxUint256)).wait();
    await (await router.modifyLiquidity(key, { tickLower: -887220, tickUpper: 887220,
      liquidityDelta: 10n ** 15n, salt: zeroPadValue('0x00', 32) }, { value: 10n ** 16n })).wait();
    assert.ok(await provider.getBalance(manager.target) > 0n);
    assert.ok(await token.balanceOf(manager.target) > 0n);
    assert.equal((await router.poolState(key))[0], price);
  } finally { await provider.destroy(); }
});
