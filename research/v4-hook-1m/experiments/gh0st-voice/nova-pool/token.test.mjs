import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import hre from 'hardhat';
import { BrowserProvider, ContractFactory, Interface, MaxUint256, ZeroAddress, parseEther } from 'ethers';

const directory = path.dirname(fileURLToPath(import.meta.url));
const research = path.resolve(directory, '../../..');
const tokenSource = 'experiments/gh0st-voice/nova-pool/contracts/NovaToken.sol';

function compileToken() {
  const result = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { [tokenSource]: { content: fs.readFileSync(path.join(research, tokenSource), 'utf8') } },
    settings: {
      optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  }), { import: name => {
    const file = path.join(research, name);
    return fs.existsSync(file) ? { contents: fs.readFileSync(file, 'utf8') } : { error: `Missing ${name}` };
  } }));
  const errors = (result.errors ?? []).filter(row => row.severity === 'error');
  assert.deepEqual(errors, [], errors.map(row => row.formattedMessage).join('\n'));
  return result.contracts[tokenSource].NovaToken;
}

test('N0VA has only standard ERC20 behavior and immutable one-million supply', async t => {
  const upstreamRoot = path.join(directory, 'contracts/vendor/openzeppelin-5.0.2');
  const upstream = JSON.parse(fs.readFileSync(path.join(upstreamRoot, 'UPSTREAM.json'), 'utf8'));
  await t.test('the pinned OpenZeppelin sources match their recorded official hashes', () => {
    assert.equal(upstream.version, '5.0.2');
    for (const row of upstream.files) {
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(upstreamRoot, row.path))).digest('hex'), row.sha256);
      assert.equal(row.verified_exact, true);
    }
  });

  const artifact = compileToken();
  const names = artifact.abi.filter(row => row.type === 'function').map(row => row.name).sort();
  assert.deepEqual(names, [
    'FIXED_SUPPLY', 'allowance', 'approve', 'balanceOf', 'decimals', 'name', 'symbol', 'totalSupply',
    'transfer', 'transferFrom',
  ].sort());

  await hre.network.provider.request({ method: 'hardhat_reset', params: [] });
  const provider = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  const owner = await provider.getSigner(0), spender = await provider.getSigner(1), recipient = await provider.getSigner(2);
  const ownerAddress = await owner.getAddress(), spenderAddress = await spender.getAddress(), recipientAddress = await recipient.getAddress();
  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner);
  const token = await factory.deploy(ownerAddress);
  await token.waitForDeployment();
  const fixedSupply = parseEther('1000000');

  await t.test('constructor issues all and only one million tokens', async () => {
    assert.equal(await token.totalSupply(), fixedSupply);
    assert.equal(await token.FIXED_SUPPLY(), fixedSupply);
    assert.equal(await token.balanceOf(ownerAddress), fixedSupply);
    assert.equal(await token.balanceOf(spenderAddress), 0n);
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.name(), 'GH0ST N0VA');
    assert.equal(await token.symbol(), 'N0VA');
    await assert.rejects(factory.deploy(ZeroAddress));
  });

  await t.test('transfers have no tax, burn, blacklist, or owner exception', async () => {
    const amount = parseEther('25');
    await (await token.transfer(recipientAddress, amount)).wait();
    assert.equal(await token.balanceOf(recipientAddress), amount);
    assert.equal(await token.balanceOf(ownerAddress), fixedSupply - amount);
    await (await token.connect(recipient).transfer(ownerAddress, amount)).wait();
    assert.equal(await token.balanceOf(recipientAddress), 0n);
    assert.equal(await token.balanceOf(ownerAddress), fixedSupply);
    assert.equal(await token.totalSupply(), fixedSupply);
  });

  await t.test('allowances are required, consumed exactly, and cannot seize balances', async () => {
    const amount = parseEther('7');
    await assert.rejects(token.connect(spender).transferFrom(ownerAddress, recipientAddress, amount));
    await (await token.approve(spenderAddress, amount)).wait();
    await (await token.connect(spender).transferFrom(ownerAddress, recipientAddress, amount)).wait();
    assert.equal(await token.allowance(ownerAddress, spenderAddress), 0n);
    assert.equal(await token.balanceOf(recipientAddress), amount);
    await assert.rejects(token.connect(spender).transferFrom(ownerAddress, recipientAddress, 1n));
    await assert.rejects(token.connect(recipient).transfer(ownerAddress, amount + 1n));
    await (await token.approve(spenderAddress, MaxUint256)).wait();
    await (await token.connect(spender).transferFrom(ownerAddress, recipientAddress, 1n)).wait();
    assert.equal(await token.allowance(ownerAddress, spenderAddress), MaxUint256);
    await (await token.approve(spenderAddress, 0n)).wait();
    assert.equal(await token.totalSupply(), fixedSupply);
  });

  await t.test('zero-address transfer and approval revert instead of burning supply', async () => {
    await assert.rejects(token.transfer(ZeroAddress, 1n));
    await assert.rejects(token.approve(ZeroAddress, 1n));
    await assert.rejects(token.connect(spender).transferFrom(ZeroAddress, recipientAddress, 0n));
    await assert.rejects(token.connect(spender).transferFrom(ZeroAddress, recipientAddress, 1n));
    assert.equal(await token.totalSupply(), fixedSupply);
  });

  await t.test('mint, burn, pause, ownership, blacklist and upgrade selectors cannot be called', async () => {
    const forbidden = new Interface([
      'function mint(address,uint256)', 'function burn(uint256)', 'function burnFrom(address,uint256)',
      'function pause()', 'function unpause()', 'function transferOwnership(address)', 'function renounceOwnership()',
      'function blacklist(address)', 'function setTax(uint256)', 'function upgradeTo(address)',
    ]);
    const calls = [
      ['mint', [ownerAddress, 1n]], ['burn', [1n]], ['burnFrom', [ownerAddress, 1n]],
      ['pause', []], ['unpause', []], ['transferOwnership', [recipientAddress]], ['renounceOwnership', []],
      ['blacklist', [recipientAddress]], ['setTax', [1n]], ['upgradeTo', [recipientAddress]],
    ];
    for (const [name, args] of calls) {
      await assert.rejects(provider.call({ to: await token.getAddress(), from: ownerAddress, data: forbidden.encodeFunctionData(name, args) }));
    }
    assert.equal(await token.totalSupply(), fixedSupply);
  });
});
