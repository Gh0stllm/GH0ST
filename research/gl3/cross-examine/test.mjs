import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { homedir } from 'node:os';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from './compile.mjs';

const ethers = await import('ethers').catch(async error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return import('../gl3-bridge-recipient-confirm-20261118/site/vendor/ethers.js');
});
const { ContractFactory, JsonRpcProvider, ZeroHash, id, parseEther } = ethers;
const fallbackAnvil = join(homedir(), '.foundry/versions/foundry-rs/foundry/v1.8.5/anvil');
const anvil = process.env.ANVIL_BIN ?? (existsSync(fallbackAnvil) ? fallbackAnvil : 'anvil');

function startAnvil() {
  const child = spawn(anvil, ['--host', '127.0.0.1', '--port', '0', '--chain-id', '31337'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let buffer = '';
  const url = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Anvil did not open a loopback port.')), 8_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Anvil exited with code ${code}.`)); });
    child.stdout.on('data', bytes => {
      buffer = (buffer + bytes.toString('utf8')).slice(-4096);
      const match = buffer.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match && Number(match[1]) > 0) {
        clearTimeout(timeout);
        resolve('http://127.0.0.1:' + match[1]);
      }
    });
  });
  return { child, url };
}

const send = async action => {
  const tx = await action;
  const receipt = await tx.wait();
  assert.equal(receipt.status, 1);
  return receipt;
};

function event(contract, receipt, name) {
  const matches = receipt.logs
    .filter(log => log.address.toLowerCase() === receipt.to?.toLowerCase() ||
      log.address.toLowerCase() === receipt.contractAddress?.toLowerCase())
    .map(log => contract.interface.parseLog(log))
    .filter(log => log?.name === name);
  assert.equal(matches.length, 1, `Exactly one ${name} event is required`);
  return matches[0].args;
}

async function expectRevert(action, name) {
  await assert.rejects(action, error => error.revert?.name === name,
    `Expected ${name}`);
}

const detail = receipt => ({
  transactionHash: receipt.hash,
  blockNumber: receipt.blockNumber,
  gasUsed: receipt.gasUsed.toString(),
  status: receipt.status,
});

const artifact = compile();
const local = startAnvil();
let provider;
try {
  provider = new JsonRpcProvider(await local.url, undefined, { batchMaxCount: 1 });
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  const [curator, challenger, outsider, recipient] = await Promise.all(
    [0, 1, 2, 3].map(index => provider.getSigner(index)),
  );
  const getBalance = async address => BigInt(await provider.send('eth_getBalance', [address, 'latest']));
  const reward = parseEther('1');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, curator);
  const contract = await factory.deploy(curator.address, reward, { value: reward });
  const deployment = await send(contract.deploymentTransaction());
  const receiver = await contract.getAddress();
  const opened = event(contract, deployment, 'ClaimOpened');
  const player = contract.connect(challenger);
  const other = contract.connect(outsider);
  assert.equal(opened.reward, reward);
  assert.equal(await getBalance(receiver), reward);
  assert.deepEqual([...(await contract.verdict(365))], [true, 102n]);
  assert.deepEqual([...(await contract.verdict(7))], [false, 90n]);
  assert.deepEqual([...(await contract.verdictAt(1, 365))], [true, 102n]);
  await expectRevert(() => contract.verdictAt(2, 365), 'UnknownModel');
  await expectRevert(() => contract.verdict(36_601), 'InvalidAge');
  await expectRevert(() => contract.attemptUpgrade.staticCall(0, 12), 'CounterexampleRequired');
  await expectRevert(() => other.attemptUpgrade.staticCall(0, 12), 'Unauthorized');
  await expectRevert(() => player.commitChallenge.staticCall(ZeroHash), 'InvalidCommitment');
  await expectRevert(() => player.withdrawReward.staticCall(recipient.address), 'NoReward');

  const expirySalt = id('fixture-expired');
  await send(other.commitChallenge(await contract.commitmentFor(outsider.address, 7, expirySalt)));
  await provider.send('anvil_mine', ['0x101']);
  await expectRevert(() => other.revealChallenge.staticCall(7, expirySalt), 'RevealExpired');
  const sameSalt = id('fixture-unchanged');
  await send(other.commitChallenge(await contract.commitmentFor(outsider.address, 366, sameSalt)));
  await provider.send('evm_mine', []);
  await expectRevert(() => other.revealChallenge.staticCall(366, sameSalt), 'VerdictUnchanged');

  const salt = id('fixture-age-seven');
  const commitment = await contract.commitmentFor(challenger.address, 7, salt);
  const commitmentReceipt = await send(player.commitChallenge(commitment));
  const committed = event(contract, commitmentReceipt, 'ChallengeCommitted');
  assert.equal(committed.challenger, challenger.address);
  assert.equal(committed.blockNumber, BigInt(commitmentReceipt.blockNumber));
  await expectRevert(() => player.revealChallenge.staticCall(7, salt), 'RevealTooEarly');
  await expectRevert(() => other.revealChallenge.staticCall(7, salt), 'InvalidCommitment');
  await expectRevert(() => player.revealChallenge.staticCall(8, salt), 'InvalidCommitment');
  await expectRevert(() => player.revealChallenge.staticCall(365, salt), 'InvalidAge');

  await provider.send('evm_mine', []);
  const challengeReceipt = await send(player.revealChallenge(7, salt));
  const flip = event(contract, challengeReceipt, 'CounterexampleAccepted');
  assert.deepEqual([...flip], [1n, challenger.address, 365n, 7n, 102n, 90n, true, false]);
  assert.equal(event(contract, challengeReceipt, 'RewardCredited').amount, reward);
  assert.deepEqual([...(await contract.counterexample())], [challenger.address, 7n, true]);
  assert.equal(await contract.rewardCredit(challenger.address), reward);
  await expectRevert(() => other.commitChallenge.staticCall(id('another-claim')), 'ClaimClosed');
  await expectRevert(() => player.revealChallenge.staticCall(7, salt), 'ClaimClosed');
  await expectRevert(() => player.withdrawReward.staticCall(receiver), 'InvalidRecipient');

  const balanceBefore = await getBalance(recipient.address);
  const payoutReceipt = await send(player.withdrawReward(recipient.address));
  const paid = event(contract, payoutReceipt, 'RewardWithdrawn');
  assert.deepEqual([...paid], [challenger.address, recipient.address, reward]);
  const balanceDelta = (await getBalance(recipient.address)) - balanceBefore;
  assert.equal(balanceDelta, reward);
  assert.equal(await getBalance(receiver), 0n);
  assert.equal(await contract.rewardCredit(challenger.address), 0n);
  await expectRevert(() => player.withdrawReward.staticCall(recipient.address), 'NoReward');

  assert.equal(await contract.attemptUpgrade.staticCall(1, 0), false);
  assert.equal(await contract.attemptUpgrade.staticCall(0, 0), false);
  const blockedReceipt = await send(contract.attemptUpgrade(1, 0));
  const blocked = event(contract, blockedReceipt, 'ModelUpgradeBlocked');
  assert.equal(blocked.activeVersion, 1n);
  assert.equal(blocked.baselineApproved, true);
  assert.equal(blocked.editedApproved, false);
  assert.equal(blocked.requiredApproval, true);
  assert.equal(await contract.activeVersion(), 1n);
  const versionAfterBlocked = Number(await contract.activeVersion());
  assert.deepEqual([...(await contract.verdict(365))], [true, 102n]);

  assert.equal(await contract.attemptUpgrade.staticCall(0, 12), true);
  const fixedReceipt = await send(contract.attemptUpgrade(0, 12));
  assert.equal(event(contract, fixedReceipt, 'ModelUpgraded').version, 2n);
  assert.deepEqual([...(await contract.verdict(365))], [true, 102n]);
  assert.deepEqual([...(await contract.verdict(7))], [true, 102n]);
  assert.deepEqual([...(await contract.verdictAt(1, 7))], [false, 90n]);
  assert.equal(await contract.attemptUpgrade.staticCall(1, 0), false);

  const result = {
    scope: 'Local Anvil simulation with synthetic wallets and native test ETH. Mainnet broadcasts: 0.',
    chainId: 31337,
    sourceSHA256: artifact.sourceSHA256,
    compilerVersion: artifact.compilerVersion,
    contract: receiver,
    fixture: { quality: 72, completion: 18, approvalThreshold: 100, baselineWalletAgeDays: 365, editedWalletAgeDays: 7 },
    deployment: detail(deployment),
    commit: detail(commitmentReceipt),
    verdictFlip: { ...detail(challengeReceipt), baseline: ['Approved', 102], edited: ['Rejected', 90] },
    payout: { ...detail(payoutReceipt), amountWei: reward.toString(), recipientBalanceDeltaWei: balanceDelta.toString() },
    blockedUpgrade: { ...detail(blockedReceipt), candidateId: blocked.candidateId, activeVersionBefore: 1,
      activeVersionAfter: versionAfterBlocked },
    fixedUpgrade: { ...detail(fixedReceipt), activeVersionAfter: Number(await contract.activeVersion()) },
    checked: ['invalid model and age bounds', 'upgrade authorization', 'early reveal', 'expired reveal',
      'copied and wrong reveal', 'unchanged verdict', 'repeated claim', 'invalid receiver', 'repeated withdrawal',
      'equal-denial regression rejected', 'fixed model accepted', 'historical verdict retained', 'regression still gates next version'],
  };
  writeFileSync(new URL('local-evidence.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  provider?.destroy();
  if (local.child.exitCode === null) {
    local.child.kill();
    await once(local.child, 'exit').catch(() => {});
  }
}
