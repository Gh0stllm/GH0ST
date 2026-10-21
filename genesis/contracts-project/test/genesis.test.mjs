import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import {
  AbiCoder, BrowserProvider, ContractFactory, ZeroAddress, MaxUint256,
  concat, getAddress, getCreateAddress, keccak256, parseEther, toBeHex,
} from 'ethers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = 98303;
const FILE_BYTES = 48626528;
const FILE_SHA256 = '0x9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9';
const PRICE = parseEther('200000');
const BASE_URI = 'ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/';
const COLLECTION_URI = 'ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq';
const INDEX_ADDRESS = getAddress('0x0000000000000000000000000000000000010000');
const FULL_CODE = '0x' + '00'.repeat(PAYLOAD + 1);
const LAST_PAYLOAD = FILE_BYTES - 494 * PAYLOAD;
const LAST_CODE = '0x' + '00'.repeat(LAST_PAYLOAD + 1);
const FULL_HASH = keccak256(FULL_CODE);
const LAST_HASH = keccak256(LAST_CODE);
const abiCoder = AbiCoder.defaultAbiCoder();

function artifact(name) {
  const candidates = [path.join(ROOT, 'artifacts', name + '.json')];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.name === name + '.json') candidates.push(filename);
    }
  }
  visit(path.join(ROOT, 'artifacts'));
  const filename = candidates.find(p => fs.existsSync(p));
  assert.ok(filename, 'Missing ' + name + ' artifact; run npm run compile first.');
  const result = JSON.parse(fs.readFileSync(filename, 'utf8'));
  let bytecode = result.bytecode ?? result.evm?.bytecode?.object;
  if (typeof bytecode === 'object') bytecode = bytecode.object;
  assert.equal(typeof bytecode, 'string');
  if (!bytecode.startsWith('0x')) bytecode = '0x' + bytecode;
  return { abi: result.abi, bytecode };
}

const shards = Array.from({ length: 495 }, (_, index) => getAddress(toBeHex(0x20000 + index, 20)));
const shardHash = index => index === 494 ? LAST_HASH : FULL_HASH;
const shardLength = index => index === 494 ? LAST_PAYLOAD : PAYLOAD;
const leaf = (index, address = shards[index], hash = shardHash(index)) =>
  keccak256(keccak256(abiCoder.encode(
    ['uint256', 'address', 'bytes32', 'uint256', 'uint256'],
    [index + 1, address, hash, index * PAYLOAD, shardLength(index)],
  )));
const pair = (a, b) => keccak256(concat(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
const levels = [Array.from({ length: 495 }, (_, index) => leaf(index))];
while (levels.at(-1).length > 1) {
  const current = levels.at(-1), next = [];
  for (let i = 0; i < current.length; i += 2) next.push(pair(current[i], current[i + 1] ?? current[i]));
  levels.push(next);
}
const MERKLE_ROOT = levels.at(-1)[0];
function proof(tokenId) {
  let index = tokenId - 1;
  return levels.slice(0, -1).map(level => {
    const sibling = level[index ^ 1] ?? level[index];
    index = Math.floor(index / 2);
    return sibling;
  });
}
const INDEX_CODE = concat(['0x00', '0x47344958', toBeHex(PAYLOAD, 4), toBeHex(FILE_BYTES, 8), FILE_SHA256, ...shards]);
const INDEX_HASH = keccak256(INDEX_CODE);
let rpc, provider, owner, alice, bob, ownerAddress, aliceAddress, bobAddress, addresses;
const mined = async tx => (await tx).wait();

async function deploy(name, args = [], signer = owner) {
  const a = artifact(name);
  const contract = await new ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function expectRevert(action) {
  let rejected = false;
  try {
    const value = await action();
    if (value && typeof value.wait === 'function') await value.wait();
  } catch (error) {
    assert.notEqual(error.code, 'UNSUPPORTED_OPERATION', 'A fixture API error is not an EVM revert');
    assert.ok(error.code === 'CALL_EXCEPTION' || /revert|invalid opcode/i.test(error.message),
      'Expected EVM revert, got ' + error.code + ': ' + error.message);
    rejected = true;
  }
  assert.equal(rejected, true, 'Expected transaction or call to revert');
}
async function fixture(mode = 0, royaltyRecipient = ownerAddress) {
  const token = await deploy('MockGH0ST');
  if (mode) await mined(token.setMode(mode));
  const tokenAddress = await token.getAddress();
  const tokenCode = await rpc.request({ method: 'eth_getCode', params: [tokenAddress, 'latest'] });
  const nft = await deploy('GH0STGenesis', [
    tokenAddress, INDEX_ADDRESS, keccak256(tokenCode), INDEX_HASH, MERKLE_ROOT, royaltyRecipient,
  ]);
  return { token, nft, tokenAddress, nftAddress: await nft.getAddress(), tokenCode };
}
async function approve(token, nftAddress, amount = PRICE, signer = owner) {
  await mined(token.connect(signer).approve(nftAddress, amount));
}
async function balances(f, payer = ownerAddress) {
  return {
    balance: await f.token.balanceOf(payer), supply: await f.token.totalSupply(),
    allowance: await f.token.allowance(payer, f.nftAddress),
    minted: await f.nft.totalMinted(), burned: await f.nft.totalBurned(),
    quota: await f.nft.mintedBy(payer), heldByNft: await f.token.balanceOf(f.nftAddress),
  };
}
async function fastSend(from, target, iface, name, args, gas = 500000n) {
  const hash = await rpc.request({ method: 'eth_sendTransaction', params: [{
    from, to: target, data: iface.encodeFunctionData(name, args), gas: toBeHex(gas),
  }] });
  const receipt = await rpc.request({ method: 'eth_getTransactionReceipt', params: [hash] });
  assert.equal(receipt.status, '0x1', 'Direct local transaction reverted: ' + name);
  return receipt;
}

before(async () => {
  rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 4663, hardfork: 'shanghai', allowUnlimitedContractSize: true },
    miner: { blockGasLimit: 100000000 },
    wallet: { totalAccounts: 170, defaultBalance: 1000 },
  });
  provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  addresses = await rpc.request({ method: 'eth_accounts', params: [] });
  owner = await provider.getSigner(0); alice = await provider.getSigner(1); bob = await provider.getSigner(2);
  [ownerAddress, aliceAddress, bobAddress] = await Promise.all([
    owner.getAddress(), alice.getAddress(), bob.getAddress(),
  ]);
  // Local-only state overrides avoid 495 creation transactions for large data contracts.
  for (let start = 0; start < shards.length; start += 12) {
    await Promise.all(shards.slice(start, start + 12).map((address, localIndex) =>
      rpc.request({ method: 'evm_setAccountCode', params: [
        address, start + localIndex === 494 ? LAST_CODE : FULL_CODE,
      ] })));
  }
  await rpc.request({ method: 'evm_setAccountCode', params: [INDEX_ADDRESS, INDEX_CODE] });
});
after(async () => { if (rpc) await rpc.disconnect(); });

test('native burn consumes exactly 200,000 GH0ST and retains no mint tokens', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress);
  const initial = await balances(f);
  await mined(f.nft.mint(1, proof(1)));
  const final = await balances(f);
  assert.equal(initial.balance - final.balance, PRICE);
  assert.equal(initial.supply - final.supply, PRICE);
  assert.equal(final.allowance, 0n); assert.equal(final.minted, 1n);
  assert.equal(final.burned, PRICE); assert.equal(final.heldByNft, 0n);
  assert.equal(final.quota, 1n); assert.equal(await f.nft.ownerOf(1), ownerAddress);
});

test('any funded wallet can self-mint and cannot burn another wallet balance', async () => {
  const f = await fixture();
  await mined(f.token.transfer(aliceAddress, PRICE)); await approve(f.token, f.nftAddress, PRICE, alice);
  const ownerBefore = await f.token.balanceOf(ownerAddress);
  await mined(f.nft.connect(alice).mint(17, proof(17)));
  assert.equal(await f.token.balanceOf(ownerAddress), ownerBefore);
  assert.equal(await f.token.balanceOf(aliceAddress), 0n);
  assert.equal(await f.nft.ownerOf(17), aliceAddress);
  const mint = f.nft.interface.getFunction('mint');
  assert.equal(mint.inputs.length, 2, 'There must be no arbitrary recipient parameter');
});

test('three lifetime mints per payer; transferring all NFTs away never resets quota', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress, PRICE * 4n);
  for (let id = 1; id <= 3; id++) await mined(f.nft.mint(id, proof(id)));
  assert.equal(await f.nft.MAX_PER_WALLET(), 3n);
  assert.equal(await f.nft.mintedBy(ownerAddress), 3n);
  for (let id = 1; id <= 3; id++) await mined(f.nft.transferFrom(ownerAddress, bobAddress, id));
  assert.equal(await f.nft.balanceOf(ownerAddress), 0n);
  const before = await balances(f);
  await expectRevert(() => f.nft.mint(4, proof(4)));
  assert.deepEqual(await balances(f), before);
  // Receiving already-minted NFTs does not consume or refresh the recipient's own lifetime quota.
  assert.equal(await f.nft.mintedBy(bobAddress), 0n);
  await mined(f.token.transfer(bobAddress, PRICE)); await approve(f.token, f.nftAddress, PRICE, bob);
  await mined(f.nft.connect(bob).mint(4, proof(4)));
  assert.equal(await f.nft.balanceOf(bobAddress), 4n);
  assert.equal(await f.nft.mintedBy(bobAddress), 1n);
});

test('first/final token metadata is padded, collection metadata is fixed, unminted URI reverts', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress, PRICE * 2n);
  await mined(f.nft.mint(1, proof(1))); await mined(f.nft.mint(495, proof(495)));
  assert.equal(await f.nft.tokenURI(1), BASE_URI + '001.json');
  assert.equal(await f.nft.tokenURI(495), BASE_URI + '495.json');
  assert.equal(await f.nft.contractURI(), COLLECTION_URI);
  await expectRevert(() => f.nft.tokenURI(2));
  assert.equal(await f.nft.supportsInterface('0x80ac58cd'), true);
  assert.equal(await f.nft.supportsInterface('0x5b5e139f'), true);
});

test('all 495 shard ranges and leaf bindings match the immutable index', async () => {
  const f = await fixture();
  for (let index = 0; index < 495; index++) {
    const info = await f.nft.shardInfo(index + 1);
    assert.equal(info[0], shards[index]); assert.equal(info[1], shardHash(index));
    assert.equal(info[2], BigInt(index * PAYLOAD)); assert.equal(info[3], BigInt(shardLength(index)));
    assert.equal(await f.nft.shardLeaf(index + 1), leaf(index));
  }
  await expectRevert(() => f.nft.shardInfo(0)); await expectRevert(() => f.nft.shardInfo(496));
});

test('wrong, truncated and extended proofs fail without spending tokens or wallet quota', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress, PRICE * 3n);
  const initial = await balances(f);
  await expectRevert(() => f.nft.mint(1, proof(2)));
  await expectRevert(() => f.nft.mint(1, proof(1).slice(1)));
  await expectRevert(() => f.nft.mint(1, [...proof(1), MERKLE_ROOT]));
  assert.deepEqual(await balances(f), initial);
});

test('changing shard bytecode invalidates its pinned proof', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress);
  const initial = await balances(f);
  await rpc.request({ method: 'evm_setAccountCode', params: [shards[0], FULL_CODE.slice(0, -2) + '01'] });
  try {
    await expectRevert(() => f.nft.mint(1, proof(1)));
    assert.deepEqual(await balances(f), initial);
  } finally { await rpc.request({ method: 'evm_setAccountCode', params: [shards[0], FULL_CODE] }); }
});

test('missing shard code is rejected before a burn', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress);
  const initial = await balances(f);
  await rpc.request({ method: 'evm_setAccountCode', params: [shards[1], '0x'] });
  try {
    await expectRevert(() => f.nft.mint(2, proof(2)));
    assert.deepEqual(await balances(f), initial);
  } finally { await rpc.request({ method: 'evm_setAccountCode', params: [shards[1], FULL_CODE] }); }
});

test('index bytecode substitution cannot redirect an NFT to another shard', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress);
  const initial = await balances(f);
  const substituted = concat([
    '0x00', '0x47344958', toBeHex(PAYLOAD, 4), toBeHex(FILE_BYTES, 8), FILE_SHA256,
    shards[1], shards[0], ...shards.slice(2),
  ]);
  await rpc.request({ method: 'evm_setAccountCode', params: [INDEX_ADDRESS, substituted] });
  try {
    await expectRevert(() => f.nft.mint(1, proof(1)));
    await expectRevert(() => f.nft.shardInfo(1));
    assert.deepEqual(await balances(f), initial);
  } finally { await rpc.request({ method: 'evm_setAccountCode', params: [INDEX_ADDRESS, INDEX_CODE] }); }
});

test('a changed burn-token runtime fails its immutable code pin', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress);
  await rpc.request({ method: 'evm_setAccountCode', params: [f.tokenAddress, '0x00'] });
  try {
    await expectRevert(() => f.nft.mint(1, proof(1)));
    assert.equal(await f.nft.totalMinted(), 0n);
    assert.equal(await f.nft.mintedBy(ownerAddress), 0n);
  } finally { await rpc.request({ method: 'evm_setAccountCode', params: [f.tokenAddress, f.tokenCode] }); }
  assert.equal(await f.token.allowance(ownerAddress, f.nftAddress), PRICE);
});

test('duplicate and out-of-range token IDs never cause another burn', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress, PRICE * 4n);
  await mined(f.nft.mint(23, proof(23))); const initial = await balances(f);
  await expectRevert(() => f.nft.mint(23, proof(23)));
  await expectRevert(() => f.nft.mint(0, proof(1)));
  await expectRevert(() => f.nft.mint(496, proof(495)));
  assert.deepEqual(await balances(f), initial);
});

test('insufficient allowance rolls back every mint accounting field', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress, PRICE - 1n);
  const initial = await balances(f); await expectRevert(() => f.nft.mint(1, proof(1)));
  assert.deepEqual(await balances(f), initial);
});

test('insufficient balance rolls back every mint accounting field', async () => {
  const f = await fixture();
  await mined(f.token.transfer(aliceAddress, PRICE - 1n)); await approve(f.token, f.nftAddress, PRICE, alice);
  const initial = await balances(f, aliceAddress);
  await expectRevert(() => f.nft.connect(alice).mint(1, proof(1)));
  assert.deepEqual(await balances(f, aliceAddress), initial);
});

test('native ETH payments are rejected and cannot supplement a missing token burn', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress);
  const initial = await balances(f);
  await expectRevert(() => f.nft.mint(1, proof(1), { value: 1n }));
  assert.deepEqual(await balances(f), initial);
});

for (const kind of ['RejectingReceiver', 'NonReceiver']) {
  test(kind + ' failure rolls back native burn, allowance, NFT state and lifetime quota', async () => {
    const f = await fixture(); const receiver = await deploy(kind); const recipient = await receiver.getAddress();
    await mined(f.token.transfer(recipient, PRICE)); const initial = await balances(f, recipient);
    await expectRevert(() => receiver.approveAndMint(f.tokenAddress, f.nftAddress, 1, proof(1), { gasLimit: 1500000 }));
    assert.deepEqual(await balances(f, recipient), initial);
    await expectRevert(() => f.nft.ownerOf(1));
  });
}

test('an accepting smart wallet can mint to itself', async () => {
  const f = await fixture(); const receiver = await deploy('AcceptingReceiver'); const recipient = await receiver.getAddress();
  await mined(f.token.transfer(recipient, PRICE));
  await mined(receiver.approveAndMint(f.tokenAddress, f.nftAddress, 1, proof(1)));
  assert.equal(await f.nft.ownerOf(1), recipient);
  assert.equal(await f.nft.mintedBy(recipient), 1n);
});

for (const [mode, description] of [[1, 'no-op burn'], [2, 'dead-address transfer'], [3, 'reverting burn']]) {
  test('malicious token ' + description + ' cannot issue an NFT', async () => {
    const f = await fixture(mode); await approve(f.token, f.nftAddress); const initial = await balances(f);
    await expectRevert(() => f.nft.mint(1, proof(1), { gasLimit: 1500000 }));
    assert.deepEqual(await balances(f), initial);
    assert.equal(await f.token.balanceOf('0x000000000000000000000000000000000000dEaD'), 0n);
  });
}

test('receiver reentrancy cannot mint a second NFT even with its own funded allowance', async () => {
  const f = await fixture(); const receiver = await deploy('ReenteringReceiver'); const wallet = await receiver.getAddress();
  await mined(f.token.transfer(wallet, PRICE * 3n));
  await mined(receiver.configure(f.tokenAddress, f.nftAddress, 2, proof(2), true));
  const supply = await f.token.totalSupply();
  await mined(receiver.executeMint(1, proof(1)));
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.notEqual(await receiver.reentryError(), '0x');
  assert.equal(await f.nft.totalMinted(), 1n);
  assert.equal(await f.nft.mintedBy(wallet), 1n);
  assert.equal(supply - await f.token.totalSupply(), PRICE);
  assert.equal(await f.token.balanceOf(wallet), PRICE * 2n);
  await expectRevert(() => f.nft.ownerOf(2));
});

test('propagated callback reentrancy failure rolls back the outer burn and quota', async () => {
  const f = await fixture(); const receiver = await deploy('ReenteringReceiver'); const wallet = await receiver.getAddress();
  await mined(f.token.transfer(wallet, PRICE * 3n));
  await mined(receiver.configure(f.tokenAddress, f.nftAddress, 2, proof(2), false));
  const initial = await balances(f, wallet);
  await expectRevert(() => receiver.executeMint(1, proof(1), { gasLimit: 1500000 }));
  assert.deepEqual(await balances(f, wallet), initial);
  await expectRevert(() => f.nft.ownerOf(1)); await expectRevert(() => f.nft.ownerOf(2));
});

test('ERC721 ownership, operator approval and transfers do not cause further burns', async () => {
  const f = await fixture(); await approve(f.token, f.nftAddress); await mined(f.nft.mint(1, proof(1)));
  const initial = await balances(f);
  await expectRevert(() => f.nft.connect(bob).transferFrom(ownerAddress, bobAddress, 1));
  await mined(f.nft.approve(aliceAddress, 1));
  await mined(f.nft.connect(alice).transferFrom(ownerAddress, bobAddress, 1));
  assert.equal(await f.nft.ownerOf(1), bobAddress); assert.equal(await f.nft.getApproved(1), ZeroAddress);
  await mined(f.nft.connect(bob).setApprovalForAll(aliceAddress, true));
  await mined(f.nft.connect(alice)['safeTransferFrom(address,address,uint256)'](bobAddress, ownerAddress, 1));
  assert.equal(await f.nft.ownerOf(1), ownerAddress); assert.deepEqual(await balances(f), initial);
});

test('transferring every NFT away inside its mint callback still consumes three lifetime mints', async () => {
  const f = await fixture();
  const receiver = await deploy('TransferOnReceive');
  const wallet = await receiver.getAddress();
  await mined(f.token.transfer(wallet, PRICE * 4n));
  for (let id = 1; id <= 3; id++) {
    await mined(receiver.approveAndMint(f.tokenAddress, f.nftAddress, id, proof(id), bobAddress));
    assert.equal(await f.nft.ownerOf(id), bobAddress);
    assert.equal(await f.nft.balanceOf(wallet), 0n);
    assert.equal(await f.nft.mintedBy(wallet), BigInt(id));
  }
  const initial = await balances(f, wallet);
  await expectRevert(() => receiver.approveAndMint(
    f.tokenAddress, f.nftAddress, 4, proof(4), bobAddress, { gasLimit: 1500000 },
  ));
  assert.deepEqual(await balances(f, wallet), initial);
  assert.equal(await f.nft.balanceOf(bobAddress), 3n);
});

test('constructor rejects wrong token/index pins and a zero token address', async () => {
  const token = await deploy('MockGH0ST'); const address = await token.getAddress();
  const code = await rpc.request({ method: 'eth_getCode', params: [address, 'latest'] });
  await expectRevert(() => deploy('GH0STGenesis', [address, INDEX_ADDRESS, MERKLE_ROOT, INDEX_HASH, MERKLE_ROOT, ownerAddress]));
  await expectRevert(() => deploy('GH0STGenesis', [address, INDEX_ADDRESS, keccak256(code), MERKLE_ROOT, MERKLE_ROOT, ownerAddress]));
  await expectRevert(() => deploy('GH0STGenesis', [ZeroAddress, INDEX_ADDRESS, keccak256(code), INDEX_HASH, MERKLE_ROOT, ownerAddress]));
});

test('ERC2981 and existing ERC165/ERC721 interfaces are advertised accurately', async () => {
  const f = await fixture();
  for (const supported of ['0x01ffc9a7', '0x80ac58cd', '0x5b5e139f', '0x2a55205a']) {
    assert.equal(await f.nft.supportsInterface(supported), true, supported);
  }
  assert.equal(await f.nft.supportsInterface('0xffffffff'), false);
  assert.equal(await f.nft.supportsInterface('0x00000000'), false);
});

test('fixed 350-bps royalty rounds down precisely, including zero and maximum uint256 price', async () => {
  const f = await fixture(0, bobAddress);
  assert.equal(await f.nft.ROYALTY_BPS(), 350n);
  assert.equal(await f.nft.royaltyRecipient(), bobAddress);
  for (const salePrice of [0n, 1n, 28n, 29n, 99n, 100n, 10000n, parseEther('1'), MaxUint256]) {
    const [recipient, amount] = await f.nft.royaltyInfo(1, salePrice);
    assert.equal(recipient, bobAddress);
    assert.equal(amount, salePrice * 350n / 10000n, 'Price ' + salePrice);
    assert.ok(amount <= salePrice);
  }
});

test('royalty terms are identical for any token ID and before or after minting', async () => {
  const f = await fixture(0, aliceAddress); const salePrice = 123456789n;
  const expected = [aliceAddress, salePrice * 350n / 10000n];
  for (const tokenId of [0n, 1n, 495n, 496n, MaxUint256]) {
    assert.deepEqual(Array.from(await f.nft.royaltyInfo(tokenId, salePrice)), expected);
  }
  await approve(f.token, f.nftAddress); await mined(f.nft.mint(495, proof(495)));
  assert.deepEqual(Array.from(await f.nft.royaltyInfo(495, salePrice)), expected);
  assert.equal(await f.nft.totalMinted(), 1n);
});

test('constructor rejects a zero royalty recipient and the NFT contract itself', async () => {
  const token = await deploy('MockGH0ST'); const address = await token.getAddress();
  const code = await rpc.request({ method: 'eth_getCode', params: [address, 'latest'] });
  const args = [address, INDEX_ADDRESS, keccak256(code), INDEX_HASH, MERKLE_ROOT];
  await expectRevert(() => deploy('GH0STGenesis', [...args, ZeroAddress]));
  const nonce = BigInt(await rpc.request({ method: 'eth_getTransactionCount', params: [ownerAddress, 'pending'] }));
  const predicted = getCreateAddress({ from: ownerAddress, nonce });
  await expectRevert(() => deploy('GH0STGenesis', [...args, predicted]));
});

test('royalty terms have no external admin route and cannot be changed by any wallet', async () => {
  const f = await fixture(0, bobAddress);
  const writable = f.nft.interface.fragments.filter(fragment => fragment.type === 'function' &&
    !['view', 'pure'].includes(fragment.stateMutability)).map(fragment => fragment.name).sort();
  assert.deepEqual(writable, ['approve', 'mint', 'safeTransferFrom', 'safeTransferFrom', 'setApprovalForAll', 'transferFrom']);
  for (const signer of [owner, alice, bob]) {
    await expectRevert(() => signer.sendTransaction({ to: f.nftAddress, data: '0x4e7fa49f', gasLimit: 100000 }));
  }
  assert.equal(await f.nft.royaltyRecipient(), bobAddress);
  assert.equal(await f.nft.ROYALTY_BPS(), 350n);
});

test('royalties do not divert primary burns, charge ordinary transfers or change mint quotas', async () => {
  const f = await fixture(0, bobAddress);
  const recipientBefore = await f.token.balanceOf(bobAddress);
  const supplyBefore = await f.token.totalSupply();
  await approve(f.token, f.nftAddress); await mined(f.nft.mint(1, proof(1)));
  assert.equal(supplyBefore - await f.token.totalSupply(), PRICE);
  assert.equal(await f.token.balanceOf(bobAddress), recipientBefore);
  const initial = await balances(f);
  await mined(f.nft.transferFrom(ownerAddress, aliceAddress, 1));
  await mined(f.nft.connect(alice)['safeTransferFrom(address,address,uint256)'](aliceAddress, bobAddress, 1));
  assert.deepEqual(await balances(f), initial);
  assert.equal(await f.token.balanceOf(bobAddress), recipientBefore);
  assert.equal(await f.nft.ownerOf(1), bobAddress);
  assert.equal(await f.nft.mintedBy(ownerAddress), 1n);
  assert.equal(await f.nft.mintedBy(aliceAddress), 0n);
  assert.equal(await f.nft.mintedBy(bobAddress), 0n);
  assert.equal(await f.nft.totalMinted(), 1n);
  assert.equal(await f.nft.totalBurned(), PRICE);
});

test('seeded adversarial sequence preserves per-wallet quota, aggregate burn and NFT uniqueness', async () => {
  const f = await fixture(); const participants = addresses.slice(1, 9);
  for (const wallet of participants) {
    await fastSend(ownerAddress, f.tokenAddress, f.token.interface, 'transfer', [wallet, PRICE * 10n]);
    await fastSend(wallet, f.tokenAddress, f.token.interface, 'approve', [f.nftAddress, MaxUint256]);
  }
  const initialSupply = await f.token.totalSupply();
  const counts = new Map(participants.map(wallet => [wallet, 0]));
  const minted = new Set(); let seed = 0x6a09e667;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  let successes = 0;
  for (let step = 0; step < 96; step++) {
    const wallet = participants[random() % participants.length];
    const id = 1 + (random() % 40);
    const correctProof = random() % 5 !== 0;
    const shouldPass = counts.get(wallet) < 3 && !minted.has(id) && correctProof;
    const signer = await provider.getSigner(wallet);
    const action = () => f.nft.connect(signer).mint(id, correctProof ? proof(id) : proof(id === 40 ? 1 : id + 1));
    if (shouldPass) {
      await mined(action()); minted.add(id); counts.set(wallet, counts.get(wallet) + 1); successes++;
    } else await expectRevert(action);
    assert.equal(await f.nft.totalMinted(), BigInt(successes));
    assert.equal(initialSupply - await f.token.totalSupply(), PRICE * BigInt(successes));
    assert.equal(await f.nft.totalBurned(), PRICE * BigInt(successes));
    assert.equal(await f.nft.mintedBy(wallet), BigInt(counts.get(wallet)));
  }
  assert.ok(successes >= 15, 'Adversarial run must include meaningful successful mints');
});

test('495 mints across 165 wallets burn exactly 99 million GH0ST and exhaust the collection', { timeout: 180000 }, async () => {
  const f = await fixture(); const participants = addresses.slice(0, 165);
  const initialSupply = await f.token.totalSupply();
  for (const wallet of participants) {
    if (wallet.toLowerCase() !== ownerAddress.toLowerCase()) {
      await fastSend(ownerAddress, f.tokenAddress, f.token.interface, 'transfer', [wallet, PRICE * 3n]);
    }
    await fastSend(wallet, f.tokenAddress, f.token.interface, 'approve', [f.nftAddress, PRICE * 3n]);
  }
  for (let id = 1; id <= 495; id++) {
    const wallet = participants[Math.floor((id - 1) / 3)];
    await fastSend(wallet, f.nftAddress, f.nft.interface, 'mint', [id, proof(id)]);
  }
  assert.equal(await f.nft.MAX_SUPPLY(), 495n);
  assert.equal(await f.nft.BURN_AMOUNT(), PRICE);
  assert.equal(await f.nft.totalMinted(), 495n);
  assert.equal(await f.nft.totalBurned(), parseEther('99000000'));
  assert.equal(initialSupply - await f.token.totalSupply(), parseEther('99000000'));
  for (const wallet of participants) {
    assert.equal(await f.nft.mintedBy(wallet), 3n);
    assert.equal(await f.nft.balanceOf(wallet), 3n);
  }
  const initial = await balances(f);
  await expectRevert(() => f.nft.mint(1, proof(1)));
  await expectRevert(() => f.nft.mint(496, proof(495)));
  assert.deepEqual(await balances(f), initial);
});
