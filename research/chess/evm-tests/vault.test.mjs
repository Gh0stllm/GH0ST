import assert from 'node:assert/strict';
import { compile, domain, ethers, json, localChain, receiptTypes, resultCodes, save, versions } from '../evm/lib.mjs';

const FEE = 25_000n * 10n ** 18n;
const PRIZE = 100_000n * 10n ** 18n;
const hash = text => ethers.sha256(ethers.toUtf8Bytes(text));
const CONFIG = hash('LOCAL TEST CONFIG ONLY: pinned Stockfish build, limits and chess rules');
const PRINCIPAL = hash('raw-principal-fixture');
const attestor = new ethers.Wallet('0x' + '11'.repeat(32));
const wrongAttestor = new ethers.Wallet('0x' + '22'.repeat(32));
const artifacts = compile(true);
const chain = await localChain();
const { provider, eip1193, signers, addresses } = chain;
const [owner, player, relayer, otherPlayer] = signers;
const checks = [], receipts = [], games = [];
const evidence = (label, receipt) => ({ label, hash: receipt.hash, blockNumber: receipt.blockNumber,
  status: receipt.status, gasUsed: receipt.gasUsed, contractAddress: receipt.contractAddress });
function checked(label, extra = {}) { checks.push({ label, passed: true, ...extra }); }
async function tx(label, promise) {
  const response = await promise;
  const receipt = await response.wait();
  assert.equal(receipt.status, 1, label);
  receipts.push(evidence(label, receipt));
  return receipt;
}
async function reject(label, action, expectedError) {
  let caught;
  try { const result = await action(); if (result?.wait) await result.wait(); }
  catch (error) { caught = error; }
  assert.ok(caught, `${label}: expected rejection`);
  if (expectedError) {
    const data = caught.data ?? caught.info?.error?.data?.result;
    if (typeof data === 'string' && data !== '0x') {
      const parsed = new ethers.Interface(artifacts.RHChessChallengeVault.abi).parseError(data);
      assert.equal(parsed?.name, expectedError, label);
    }
  }
  checked(label, { rejected: true, minedRevert: Boolean(caught.receipt) });
  if (caught.receipt) receipts.push(evidence(`rejected:${label}`, caught.receipt));
}
async function deploy(name, args, signer = owner) {
  const artifact = artifacts[name];
  assert.ok(artifact.runtimeBytes <= 24_576);
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  receipts.push(evidence(`deploy:${name}`, await contract.deploymentTransaction().wait()));
  return contract.waitForDeployment();
}
const token = await deploy('ChessTestToken', [18]);
async function vault(poolOwner = addresses[0]) {
  const target = await deploy('RHChessChallengeVault', [token.target, poolOwner, attestor.address, CONFIG]);
  assert.equal(await target.paused(), true, 'new deployments start closed to entries');
  if (poolOwner === addresses[0]) await tx('explicit local test-only enable entries', target.setPaused(false));
  return target;
}
async function fund(target, amount = PRIZE, caller = owner) {
  await tx('explicit exact pool approval', token.connect(caller).approve(target.target, amount));
  await tx('manual pool funding', target.connect(caller).fundPool(amount));
  assert.equal(await token.allowance(await caller.getAddress(), target.target), 0n);
}
let nextNonce = 1n;
async function enter(target, caller = player, nonce = nextNonce++, principal = PRINCIPAL) {
  await tx('exact entry approval', token.connect(caller).approve(target.target, FEE));
  const playerAddress = await caller.getAddress();
  const gameId = await target.gameIdFor(playerAddress, nonce);
  const receipt = await tx('atomic entry + prize reservation', target.connect(caller).enterGame(principal, nonce));
  assert.equal(await token.allowance(playerAddress, target.target), 0n);
  const stored = await target.games(gameId);
  const result = { target, gameId, nonce, caller, player: playerAddress, principalHash: principal,
    openedAt: stored.openedAt, gameDeadline: stored.gameDeadline,
    reconciliationDeadline: stored.reconciliationDeadline };
  const event = receipt.logs.flatMap(log => {
    if (log.address.toLowerCase() !== target.target.toLowerCase()) return [];
    try { const parsed = target.interface.parseLog(log); return parsed?.name === 'EntryAccepted' ? [parsed] : []; }
    catch { return []; }
  })[0];
  assert.ok(event);
  for (const key of ['gameId', 'nonce', 'player', 'principalHash', 'openedAt', 'gameDeadline', 'reconciliationDeadline'])
    assert.equal(event.args[key], result[key]);
  assert.equal(event.args.engineConfigHash, CONFIG);
  games.push({ vault: target.target, gameId, nonce, player: playerAddress });
  return result;
}
function receiptFor(game, result = resultCodes.HUMAN_CHECKMATE, overrides = {}) {
  return { gameId: game.gameId, player: game.player, principalHash: game.principalHash, nonce: game.nonce,
    finalPositionHash: hash('canonical final FEN including side to move'), transcriptHash: hash('canonical full transcript'),
    result, engineConfigHash: CONFIG, completedAt: game.openedAt, issuedAt: game.openedAt,
    validUntil: game.reconciliationDeadline, ...overrides };
}
async function signature(target, receipt, signer = attestor, changedDomain = {}) {
  return signer.signTypedData({ ...domain(31337, target.target), ...changedDomain }, receiptTypes, receipt);
}
async function settle(game, result = resultCodes.HUMAN_CHECKMATE, overrides = {}) {
  const receipt = receiptFor(game, result, overrides);
  return tx(`settle result ${result}`, game.target.connect(relayer).settleGame(receipt,
    await signature(game.target, receipt), { gasLimit: 800_000 }));
}
async function snapshot(target, nonce = 0n) {
  return { vaultBalance: await token.balanceOf(target.target), ownerBalance: await token.balanceOf(addresses[0]),
    playerBalance: await token.balanceOf(addresses[1]), otherBalance: await token.balanceOf(addresses[3]),
    supply: await token.totalSupply(), allowance: await token.allowance(addresses[1], target.target),
    reserved: await target.totalReserved(), active: await target.activeGames(),
    nonceUsed: await target.nonceUsed(addresses[1], nonce) };
}
async function unchanged(label, target, action, nonce = 0n) {
  const before = await snapshot(target, nonce);
  await reject(label, action);
  assert.deepEqual(await snapshot(target, nonce), before, `${label}: rollback invariant`);
  checks.at(-1).accountingUnchanged = true;
}
async function assertReentryBlocked(target) {
  assert.equal(await token.callbackAttempted(), true);
  assert.equal(await token.callbackSucceeded(), false);
  assert.equal(target.interface.parseError(await token.callbackResult()).name, 'Reentrancy');
}
const now = async () => BigInt((await provider.getBlock('latest')).timestamp);
const fastForward = async timestamp => {
  await eip1193.request({ method: 'evm_mine', params: [Number(timestamp)] });
  assert.equal(await now(), timestamp);
};

try {
  await tx('mint owner local fixture tokens', token.mint(addresses[0], PRIZE * 1000n));
  await tx('mint player local fixture tokens', token.mint(addresses[1], PRIZE * 1000n));
  await tx('mint other player local fixture tokens', token.mint(addresses[3], PRIZE * 1000n));
  const sixDecimals = await deploy('ChessTestToken', [6]);
  for (const [label, args] of [
    ['EOA token', [addresses[5], addresses[0], attestor.address, CONFIG]],
    ['non-18 decimal token', [sixDecimals.target, addresses[0], attestor.address, CONFIG]],
    ['zero owner', [token.target, ethers.ZeroAddress, attestor.address, CONFIG]],
    ['zero attestor', [token.target, addresses[0], ethers.ZeroAddress, CONFIG]],
    ['zero config', [token.target, addresses[0], attestor.address, ethers.ZeroHash]],
  ]) await reject(`constructor rejects ${label}`, () => deploy('RHChessChallengeVault', args));

  const v = await vault();
  assert.equal(await v.ENTRY_FEE(), FEE);
  assert.equal(await v.TOTAL_PRIZE(), PRIZE);
  assert.equal(await v.GAME_DURATION(), 86_400n);
  assert.equal(await v.RECONCILIATION_WINDOW(), 604_800n);
  assert.equal(await v.paymentToken(), token.target);
  assert.equal(await v.attestor(), attestor.address);
  assert.equal(await v.engineConfigHash(), CONFIG);
  assert.equal(await v.CANONICAL_GH0ST(), '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559');
  const runtime = ethers.getBytes(await provider.getCode(v.target));
  const compiled = ethers.getBytes(artifacts.RHChessChallengeVault.deployedBytecode);
  for (const slot of Object.values(artifacts.RHChessChallengeVault.immutableReferences).flat()) {
    runtime.fill(0, slot.start, slot.start + slot.length); compiled.fill(0, slot.start, slot.start + slot.length);
  }
  assert.deepEqual(runtime, compiled);
  const mutators = artifacts.RHChessChallengeVault.abi.filter(item => item.type === 'function'
    && !['view', 'pure'].includes(item.stateMutability)).map(item => item.name).sort();
  assert.deepEqual(mutators, ['enterGame', 'fundPool', 'refundUnattested', 'setPaused', 'settleGame', 'withdrawPool']);
  checked('runtime matches compiler with immutable slots masked; no fee/prize/engine/signer/owner setter or owner-close method');

  await fund(v, PRIZE - FEE);
  await tx('approve fee before rejected unfunded entry', token.connect(player).approve(v.target, FEE));
  await unchanged('must reserve full 100k before taking 25k even if fee would bring balance to 100k', v,
    () => v.connect(player).enterGame(PRINCIPAL, 1n, { gasLimit: 500_000 }), 1n);
  await fund(v, FEE);
  const balanceBeforeEntry = await token.balanceOf(addresses[1]);
  const game = await enter(v);
  assert.equal(await v.totalReserved(), PRIZE);
  assert.equal(await v.freePool(), FEE);
  assert.equal(await token.balanceOf(v.target), PRIZE + FEE);
  assert.equal(game.gameDeadline - game.openedAt, 86_400n);
  assert.equal(game.reconciliationDeadline - game.gameDeadline, 604_800n);
  const expectedGameId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address', 'address', 'uint256'], [31337, v.target, addresses[1], game.nonce]));
  assert.equal(game.gameId, expectedGameId);
  checked('atomic entry binds msg.sender, SHA256 principal commitment, per-player nonce, chain, vault and immutable deadlines');
  await unchanged('same wallet entry nonce cannot replay', v, () => v.connect(player).enterGame(PRINCIPAL,
    game.nonce, { gasLimit: 500_000 }), game.nonce);
  await unchanged('zero principal commitment cannot enter', v,
    () => v.connect(player).enterGame(ethers.ZeroHash, 202n, { gasLimit: 500_000 }), 202n);
  await unchanged('second entry cannot spend an existing game reserve', v,
    () => v.connect(player).enterGame(PRINCIPAL, 203n, { gasLimit: 500_000 }), 203n);
  await unchanged('non-owner cannot withdraw free pool', v,
    () => v.connect(player).withdrawPool(FEE, { gasLimit: 500_000 }));
  await unchanged('owner cannot withdraw one unit of reserved collateral', v,
    () => v.withdrawPool(FEE + 1n, { gasLimit: 500_000 }));
  await tx('owner withdraws only unreserved entry fee to immutable owner address', v.withdrawPool(FEE));
  assert.equal(await token.balanceOf(v.target), PRIZE);
  checked('owner free-pool withdrawal preserves every active 100k reserve');

  const good = receiptFor(game);
  const signed = await signature(v, good);
  assert.equal(await v.receiptDigest(good), ethers.TypedDataEncoder.hash(domain(31337, v.target), receiptTypes, good));
  save('evm/receipt-test-vector.json', { scope: 'LOCAL TEST KEY AND MOCK VAULT ONLY; NEVER USE FOR DEPLOYMENT',
    principalHashMeaning: 'SHA256(raw ICP Principal bytes)',
    domain: domain(31337, v.target), types: receiptTypes, receipt: good,
    typeHash: await v.RESULT_TYPEHASH(), domainSeparator: await v.domainSeparator(),
    digest: await v.receiptDigest(good), signature: signed,
    attestor: attestor.address, uncompressedPublicKey: attestor.signingKey.publicKey });
  await unchanged('untrusted signer cannot forge checkmate', v,
    () => v.connect(relayer).settleGame(good, wrongAttestor.signingKey.sign(awaitDigest(good, v)).serialized, { gasLimit: 800_000 }));
  function awaitDigest(receipt, target) { return ethers.TypedDataEncoder.hash(domain(31337, target.target), receiptTypes, receipt); }
  for (const [label, mutated] of [
    ['player', { player: addresses[3] }], ['principal', { principalHash: hash('wrong principal') }],
    ['nonce', { nonce: game.nonce + 1n }], ['engine config', { engineConfigHash: hash('different engine') }],
    ['empty final position', { finalPositionHash: ethers.ZeroHash }], ['empty transcript', { transcriptHash: ethers.ZeroHash }],
    ['result None', { result: 0 }], ['internal-only expiry result', { result: 8 }], ['unknown result', { result: 255 }],
    ['completion before entry', { completedAt: game.openedAt - 1n }],
    ['completion after game deadline', { completedAt: game.gameDeadline + 1n, issuedAt: game.gameDeadline + 1n }],
    ['issue before completion', { issuedAt: game.openedAt - 1n }],
    ['future issue time', { issuedAt: game.reconciliationDeadline }],
    ['validity before issuance', { validUntil: game.openedAt - 1n }],
    ['validity after reconciliation deadline', { validUntil: game.reconciliationDeadline + 1n }],
    ['tampered nonzero final position', { finalPositionHash: hash('altered position') }],
    ['tampered nonzero transcript', { transcriptHash: hash('altered transcript') }],
    ['tampered valid outcome', { result: 2 }],
  ]) {
    const bad = { ...good, ...mutated };
    await unchanged(`receipt rejects mismatched or invalid ${label}`, v,
      () => v.connect(relayer).settleGame(bad, signed, { gasLimit: 800_000 }));
  }
  for (const [label, changedDomain] of [['chain', { chainId: 4663 }], ['vault', { verifyingContract: addresses[6] }],
    ['version', { version: '2' }], ['name', { name: 'other challenge' }]]) {
    const wrongDomainSignature = await signature(v, good, attestor, changedDomain);
    await unchanged(`EIP712 signature cannot replay across ${label}`, v,
      () => v.connect(relayer).settleGame(good, wrongDomainSignature, { gasLimit: 800_000 }));
  }
  const parsedSig = ethers.Signature.from(signed);
  const curveN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = ethers.concat([parsedSig.r, ethers.zeroPadValue(ethers.toBeHex(curveN - BigInt(parsedSig.s)), 32),
    ethers.toBeHex(parsedSig.v === 27 ? 28 : 27)]);
  for (const [label, sig] of [['short', signed.slice(0, -2)], ['long', signed + '00'],
    ['oversized', '0x' + 'ab'.repeat(1024)], ['high-s malleation', highS],
    ['non-canonical v', signed.slice(0, -2) + '00'], ['zero r', ethers.concat([ethers.ZeroHash, parsedSig.s, ethers.toBeHex(parsedSig.v)])],
    ['zero s', ethers.concat([parsedSig.r, ethers.ZeroHash, ethers.toBeHex(parsedSig.v)])]]) {
    await unchanged(`ECDSA rejects ${label} signature`, v,
      () => v.connect(relayer).settleGame(good, sig, { gasLimit: 800_000 }));
  }
  const expired = { ...good, validUntil: game.openedAt };
  await unchanged('expired signed receipt cannot settle', v,
    () => v.connect(relayer).settleGame(expired, attestor.signingKey.sign(awaitDigest(expired, v)).serialized,
      { gasLimit: 800_000 }));
  await reject('unknown game cannot settle', () => v.settleGame.staticCall({ ...good, gameId: hash('unknown game') }, signed), 'UnknownGame');
  const actual = await settle(game);
  assert.equal(await token.balanceOf(addresses[1]), balanceBeforeEntry - FEE + PRIZE);
  assert.equal(await token.balanceOf(addresses[2]), 0n, 'relayer receives no tokens');
  assert.equal(await token.balanceOf(v.target), 0n);
  assert.equal(await v.totalReserved(), 0n);
  assert.equal(await v.activeGames(), 0n);
  assert.equal((await v.games(game.gameId)).result, 1n);
  checked('valid human checkmate pays exactly 100k total to bound player: net +75k before gas', { gas: actual.gasUsed });
  await unchanged('same valid receipt cannot double-pay', v,
    () => v.connect(relayer).settleGame(good, signed, { gasLimit: 800_000 }));
  await unchanged('settled win cannot be refunded', v,
    () => v.refundUnattested(game.gameId, { gasLimit: 500_000 }));

  for (const code of [2, 3, 4, 5, 6, 7]) {
    const target = await vault();
    await fund(target);
    const before = await token.balanceOf(addresses[1]);
    const g = await enter(target);
    await settle(g, code);
    const refundable = code === 6 || code === 7;
    assert.equal(await token.balanceOf(addresses[1]), before - (refundable ? 0n : FEE));
    assert.equal(await token.balanceOf(target.target), PRIZE + (refundable ? 0n : FEE));
    assert.equal(await target.totalReserved(), 0n);
    assert.equal(await target.activeGames(), 0n);
    assert.equal((await target.games(g.gameId)).result, BigInt(code));
    await unchanged(`result ${code} is terminal and cannot become a win`, target,
      async () => target.settleGame(receiptFor(g, 1), await signature(target, receiptFor(g, 1)), { gasLimit: 800_000 }));
    checked(`result ${code}: ${refundable ? 'exact 25k fee refund' : 'no reward; 25k entry retained'} and full reserve released`);
  }

  const multi = await vault();
  await fund(multi, 3n * PRIZE);
  const g1 = await enter(multi), g2 = await enter(multi), g3 = await enter(multi, otherPlayer);
  assert.equal(await multi.totalReserved(), 3n * PRIZE);
  await tx('withdraw accumulated unreserved entry fees', multi.withdrawPool(3n * FEE));
  await settle(g1, 1);
  assert.equal(await multi.totalReserved(), 2n * PRIZE);
  await settle(g2, 6);
  assert.equal(await multi.totalReserved(), PRIZE);
  await settle(g3, 3);
  assert.equal(await multi.totalReserved(), 0n);
  assert.equal(await token.balanceOf(multi.target), 2n * PRIZE - FEE);
  checked('three concurrent games cannot spend each other reserves; win/refund/draw release exactly once');
  const nonceScope = await vault();
  await fund(nonceScope, 2n * PRIZE);
  const sameNonceA = await enter(nonceScope, player, 0n);
  const sameNonceB = await enter(nonceScope, otherPlayer, 0n);
  assert.notEqual(sameNonceA.gameId, sameNonceB.gameId);
  await settle(sameNonceA, 3);
  await settle(sameNonceB, 3);
  checked('nonce zero is valid; identical nonce across different wallets produces independent bound game IDs');

  const pause = await vault();
  await fund(pause, 2n * PRIZE);
  const pausedGame = await enter(pause);
  await reject('non-owner cannot pause', () => pause.connect(player).setPaused.staticCall(true), 'Unauthorized');
  await tx('pause new entries', pause.setPaused(true));
  await unchanged('paused vault rejects new entries', pause,
    () => pause.connect(player).enterGame(PRINCIPAL, 999n, { gasLimit: 500_000 }), 999n);
  await settle(pausedGame, 6);
  assert.equal(await pause.paused(), true);
  await tx('resume new entries', pause.setPaused(false));
  await enter(pause);
  checked('pause affects new entrants only; existing receipt settlement remains available');

  const hostile = await vault();
  await tx('approve hostile funding fixture', token.approve(hostile.target, PRIZE));
  await tx('enable funding tax', token.configure(100, false, false));
  await unchanged('taxed funding rolls back token balances/supply and escrow accounting', hostile,
    () => hostile.fundPool(PRIZE, { gasLimit: 800_000 }));
  await tx('disable funding tax', token.configure(0, false, false));
  await fund(hostile);
  await tx('approve hostile entry fixture', token.connect(player).approve(hostile.target, FEE));
  for (const [label, config] of [['tax', [100, false, false]], ['false return', [0, true, false]]]) {
    await tx(`enable incoming ${label}`, token.configure(...config));
    await unchanged(`entry ${label} rolls back nonce, reservation, allowance and token effects`, hostile,
      () => hostile.connect(player).enterGame(PRINCIPAL, 5000n, { gasLimit: 800_000 }), 5000n);
  }
  await tx('restore normal incoming', token.configure(0, false, false));
  await tx('clear entry allowance', token.connect(player).approve(hostile.target, 0));
  await unchanged('missing allowance cannot register game or reserve collateral', hostile,
    () => hostile.connect(player).enterGame(PRINCIPAL, 5000n, { gasLimit: 800_000 }), 5000n);
  const hostileGame = await enter(hostile);
  for (const [label, config] of [['tax', [100, false, false]], ['false return', [0, false, true]]]) {
    await tx(`enable outgoing ${label}`, token.configure(...config));
    const r = receiptFor(hostileGame);
    await unchanged(`prize ${label} rolls back paid state, reserve release and token effects`, hostile,
      async () => hostile.settleGame(r, await signature(hostile, r), { gasLimit: 800_000 }));
    assert.equal((await hostile.games(hostileGame.gameId)).result, 0n);
  }
  await tx('restore normal outgoing', token.configure(0, false, false));
  await fund(hostile);
  await tx('fund callback token', token.mint(token.target, PRIZE));
  await tx('approve callback entry', token.approveSelf(hostile.target, FEE));
  await tx('enable funded entry reentry', token.setCallback(hostile.target,
    hostile.interface.encodeFunctionData('enterGame', [PRINCIPAL, 9000n]), true));
  await enter(hostile);
  await assertReentryBlocked(hostile);
  await tx('enable settlement reentry', token.setCallback(hostile.target,
    hostile.interface.encodeFunctionData('refundUnattested', [hostileGame.gameId]), true));
  await settle(hostileGame);
  await assertReentryBlocked(hostile);
  await tx('disable token callbacks', token.setCallback(ethers.ZeroAddress, '0x', false));
  checked('funded approved token callbacks cannot reenter entry or outgoing settlement');
  for (const [label, config] of [['tax', [100, false, false]], ['false return', [0, false, true]]]) {
    await tx(`enable withdrawal ${label}`, token.configure(...config));
    await unchanged(`owner withdrawal ${label} rolls back without touching reserves`, hostile,
      () => hostile.withdrawPool(FEE, { gasLimit: 800_000 }));
  }
  await tx('restore outgoing after withdrawal checks', token.configure(0, false, false));
  const tokenOwned = await vault(token.target);
  await tx('local fixture owner explicitly enables its vault', token.callExternal(tokenOwned.target,
    tokenOwned.interface.encodeFunctionData('setPaused', [false])));
  await fund(tokenOwned);
  await enter(tokenOwned);
  await tx('enable owner withdrawal callback', token.setCallback(tokenOwned.target,
    tokenOwned.interface.encodeFunctionData('withdrawPool', [FEE]), true));
  await tx('owner withdraws with hostile outgoing callback', token.callExternal(tokenOwned.target,
    tokenOwned.interface.encodeFunctionData('withdrawPool', [FEE])));
  await assertReentryBlocked(tokenOwned);
  assert.equal(await tokenOwned.totalReserved(), PRIZE);
  assert.equal(await token.balanceOf(tokenOwned.target), PRIZE);
  await tx('disable withdrawal callback', token.setCallback(ethers.ZeroAddress, '0x', false));
  checked('authorized owner token callback cannot reenter withdrawal or consume active reserves');

  const insolvent = await vault();
  await fund(insolvent);
  const insolventGame = await enter(insolvent);
  await tx('hostile fixture destroys collateral', token.burn(insolvent.target, FEE + 1n));
  assert.equal(await insolvent.freePool(), 0n);
  assert.equal(await insolvent.isSolvent(), false);
  await unchanged('insolvency blocks new entries before charging', insolvent,
    () => insolvent.connect(player).enterGame(PRINCIPAL, 6000n, { gasLimit: 800_000 }), 6000n);
  await unchanged('insolvency blocks owner withdrawal', insolvent,
    () => insolvent.withdrawPool(1n, { gasLimit: 800_000 }));
  const fault = receiptFor(insolventGame, 6);
  await unchanged('insolvency fails closed rather than racing existing claimants', insolvent,
    async () => insolvent.settleGame(fault, await signature(insolvent, fault), { gasLimit: 800_000 }));
  await tx('manual fixture repairs lost collateral', token.mint(insolvent.target, 1n));
  await settle(insolventGame, 6);
  checked('insolvent unsupported-token state is visible and cannot be drained; manual repair allows settlement');

  const expiration = await vault();
  await fund(expiration, 2n * PRIZE);
  const expires = await enter(expiration);
  const timeout = await enter(expiration, otherPlayer);
  await tx('pause entries before existing timeout and refund', expiration.setPaused(true));
  await reject('unattested refund unavailable during game', () => expiration.refundUnattested.staticCall(expires.gameId), 'ReconciliationNotExpired');
  await fastForward(timeout.gameDeadline);
  await settle(timeout, 5, { completedAt: timeout.gameDeadline, issuedAt: timeout.gameDeadline });
  checked('attested player timeout can complete exactly at gameplay deadline and retains entry');
  await fastForward(expires.reconciliationDeadline);
  await reject('refund requires strictly after reconciliation deadline', () => expiration.refundUnattested.staticCall(expires.gameId), 'ReconciliationNotExpired');
  const lastSecondReceipt = receiptFor(expires);
  await expiration.settleGame.staticCall(lastSecondReceipt, await signature(expiration, lastSecondReceipt));
  checked('valid signed result remains settleable at exact reconciliation deadline while unsigned refund is blocked');
  const beforeRefund = await token.balanceOf(addresses[1]);
  await tx('permissionless missing-attestation refund after full window', expiration.connect(relayer)
    .refundUnattested(expires.gameId, { gasLimit: 500_000 }));
  assert.equal(await token.balanceOf(addresses[1]), beforeRefund + FEE);
  assert.equal((await expiration.games(expires.gameId)).result, 8n);
  assert.equal(await expiration.totalReserved(), 0n);
  const late = receiptFor(expires);
  await unchanged('late signed win cannot reverse expiry refund', expiration,
    async () => expiration.settleGame(late, await signature(expiration, late), { gasLimit: 800_000 }));
  checked('attestor outage refunds exactly 25k once after 24h+7d; caller never receives player funds');

  const donation = await vault();
  await tx('voluntary direct donation', token.transfer(donation.target, PRIZE));
  assert.equal(await donation.freePool(), PRIZE);
  assert.equal(await donation.activeGames(), 0n);
  await enter(donation);
  checked('direct token donations are free pool only; no entry exists without atomic enterGame');

  save('evm/test-report.json', { scope: 'ISOLATED LOCAL EVM ONLY; no RPC, mainnet or financial transaction',
    passed: true, versions, compilerRuntimeBytes: artifacts.RHChessChallengeVault.runtimeBytes,
    chainId: 31337, canonicalProductionChainId: 4663,
    checkCount: checks.length, checks, receipts, games,
    fixedEconomics: { entryFee: FEE, totalCheckmatePayout: PRIZE, winnerNetBeforeGas: PRIZE - FEE },
    reviewDefaults: { gameplaySeconds: 86_400, reconciliationSeconds: 604_800,
      drawBotWinResignationPlayerTimeout: 'fee retained; no reward', serviceFaultEngineAbort: 'entry refunded',
      missingAttestationAfterReconciliation: 'permissionless entry refund' },
    trustBoundary: 'Pinned attestor signature authenticates an assertion; does not prove ICP execution, RH entry proof validity, chess legality or Stockfish correctness.',
  });
  console.log(json({ passed: true, checks: checks.length, localReceipts: receipts.length,
    runtimeBytes: artifacts.RHChessChallengeVault.runtimeBytes }));
} finally { await chain.close(); }
