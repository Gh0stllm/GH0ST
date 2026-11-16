import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createReader, READ_METHODS } from './rpc.mjs';
import { gh0stPerEthX18, reimbursementUnits, evaluateGasReadiness } from './parameters.mjs';
import { runtimeOpcodeCounts } from './preflight.mjs';

const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url)));
test('RPC transport rejects transaction and wallet methods before contacting a provider', async () => {
  let calls = 0;
  const read = createReader('https://example.invalid/secret-value', async () => { calls++; throw Error('secret-value'); });
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_signTransaction', 'personal_unlockAccount', 'eth_estimateGas']) {
    await assert.rejects(read(method), { message: 'Unsupported read-only method' });
  }
  assert.equal(calls, 0);
  await assert.rejects(read('eth_call', [{ to: policy.nativeToken, data: '0x' }, 'latest', {}]),
    { message: 'Unsupported read-only call parameters' });
  assert.equal(calls, 0);
  await assert.rejects(read('eth_chainId'), { message: 'Read-only eth_chainId failed' });
  assert.equal(calls, 1);
  assert(READ_METHODS.every(method => method.startsWith('eth_')));
});
test('GH0ST/ETH rate direction and 18-decimal scale match SequencerInbox', () => {
  const rate = gh0stPerEthX18(2_000_000n * 10n ** 18n, 10n ** 18n);
  assert.equal(rate, 2_000_000n * 10n ** 18n);
  assert.equal(reimbursementUnits(10n ** 15n, rate), 2000n * 10n ** 18n);
  assert.throws(() => gh0stPerEthX18(1n, 0n));
  assert.throws(() => reimbursementUnits(-1n, rate));
});
test('removed historical caps are not active limits and historical spending remains recorded', () => {
  assert.equal(policy.budget.oldL3SpendingCapsRemoved, true);
  assert.equal(policy.budget.finiteETHSpendingCapWei, null);
  assert.equal(policy.budget.finiteICPSpendingCap, null);
  assert.equal(policy.budget.history.recordedPriorETHFeeWei, '64114367868000');
  assert.equal(policy.budget.history.alreadyConvertedICP, '13');
  assert.equal(policy.budget.automaticTopups, false);
  assert.equal(policy.budget.validatorBondSpendApproved, false);
  assert.equal(policy.budget.newFundsOrTransactionsAuthorizedByThisFile, false);
});
test('opcode heuristic skips PUSH data but recognizes executable proxy opcodes', () => {
  assert.deepEqual(runtimeOpcodeCounts('0x60f461f2f400'), { delegatecall: 0, callcode: 0 });
  assert.deepEqual(runtimeOpcodeCounts('0xf4f2'), { delegatecall: 1, callcode: 1 });
});
test('unconfigured GH0ST rollup stays blocked and never returns fake pricer address', () => {
  const report = { chainId: 4663, token: policy.nativeToken, checkedAtUTC: new Date().toISOString(),
    tokenIdentityMatches: true, basicTokenChecksPassed: true };
  const result = evaluateGasReadiness(policy, report);
  assert.equal(result.gasPrerequisitesReady, false);
  assert.equal(result.gasOverrides.feeTokenPricer, null);
  assert.equal(result.wholeChainDeploymentReady, false);
  assert.equal(result.transactionRequestsCreated, 0);
  assert(result.blockers.some(x => x.includes('nonzero')));
  assert(result.blockers.some(x => x.includes('reserve')));
});
test('missing evidence, stale rate, runtime mismatch and insufficient reserve independently block readiness', () => {
  const now = Date.now();
  const p = structuredClone(policy);
  p.feeTokenPricer = '0x0000000000000000000000000000000000001234';
  p.expectedFeeTokenPricerRuntimeKeccak256 = '0x' + '11'.repeat(32);
  p.feeTokenPricerProductionReviewComplete = true;
  p.rateEvidence = { gh0stPerEthX18: '2000000000000000000000000', source: 'synthetic test only', observedAtUTC: new Date(now).toISOString(), maxAgeSeconds: 3600 };
  p.parentETHOperatingReserveWei = '1000000000000000';
  p.parentETHOperatingReserveApproved = true;
  p.batchPosterAccounts = ['0x0000000000000000000000000000000000005678'];
  const report = { chainId: 4663, token: policy.nativeToken, checkedAtUTC: new Date(now).toISOString(),
    tokenIdentityMatches: true, basicTokenChecksPassed: true,
    pricer: { runtimeMatches: true, rateMatchesEvidence: true },
    batchPosters: [{ ethBalanceWei: '1000000000000000' }] };
  assert.equal(evaluateGasReadiness(p, report, now).gasPrerequisitesReady, true);
  assert.equal(evaluateGasReadiness(p, report, now + 3601000).gasPrerequisitesReady, false);
  const badRate = structuredClone(p); badRate.rateEvidence.gh0stPerEthX18 = '0';
  assert.equal(evaluateGasReadiness(badRate, report, now).gasPrerequisitesReady, false);
  const badReport = structuredClone(report); badReport.pricer.runtimeMatches = false;
  assert.equal(evaluateGasReadiness(p, badReport, now).gasPrerequisitesReady, false);
  const lowBalance = structuredClone(report); lowBalance.batchPosters[0].ethBalanceWei = '1';
  assert.equal(evaluateGasReadiness(p, lowBalance, now).gasPrerequisitesReady, false);
  const largerReserve = structuredClone(p); largerReserve.parentETHOperatingReserveWei = '1000000000000000000';
  const fundedReport = structuredClone(report); fundedReport.batchPosters[0].ethBalanceWei = '1000000000000000000';
  assert.equal(evaluateGasReadiness(largerReserve, fundedReport, now).gasPrerequisitesReady, true);
  const changedToken = structuredClone(p); changedToken.nativeToken = p.feeTokenPricer;
  assert.equal(evaluateGasReadiness(changedToken, report, now).gasPrerequisitesReady, false);
});
