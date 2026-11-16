import { getAddress, ZeroAddress } from 'ethers';

export const RATE_SCALE = 10n ** 18n;
export function gh0stPerEthX18(gh0stUnits, ethUnits) {
  const gh0st = BigInt(gh0stUnits), eth = BigInt(ethUnits);
  if (gh0st <= 0n || eth <= 0n) throw Error('Rate quantities must be positive');
  const rate = gh0st * RATE_SCALE / eth;
  if (rate === 0n) throw Error('Rate rounds to zero');
  return rate;
}
export function reimbursementUnits(parentCostWei, rateX18) {
  const cost = BigInt(parentCostWei), rate = BigInt(rateX18);
  if (cost < 0n || rate <= 0n) throw Error('Invalid reimbursement inputs');
  return cost * rate / RATE_SCALE;
}
function positive(value) {
  try { return typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n; }
  catch { return false; }
}
function nonzeroAddress(value) {
  try { return getAddress(value) !== ZeroAddress; } catch { return false; }
}

// This evaluates gas prerequisites only. It does not create transaction calldata,
// sign, approve tokens, reserve funds, or conclude that the whole chain is ready.
export function evaluateGasReadiness(policy, report, now = Date.now()) {
  const blockers = [];
  const require = (condition, message) => { if (!condition) blockers.push(message); };
  require(policy.parentChainId === 4663 && report.chainId === 4663, 'Parent must be Robinhood 4663');
  require(policy.childArbOSVersion === 61, 'ArbOS 61 must be explicit for the pinned supported Nitro profile');
  require(policy.dataAvailabilityCommittee === false, 'This policy requires Rollup data availability');
  require(policy.batchPosterReimbursementRequired === true, 'Reimbursed batch posting must be explicit');
  require(report.tokenIdentityMatches === true && report.basicTokenChecksPassed === true,
    'Fresh canonical token identity and basic behavior checks must pass');
  const token = '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559';
  require(policy.nativeToken?.toLowerCase() === token && report.token?.toLowerCase() === token,
    'Canonical parent GH0ST address must be used');
  const reportAge = (now - Date.parse(report.checkedAtUTC)) / 1000;
  require(Number.isFinite(reportAge) && reportAge >= 0 && reportAge <= 300,
    'Token and pricer preflight must be no more than five minutes old');
  require(nonzeroAddress(policy.feeTokenPricer), 'A nonzero parent-chain feeTokenPricer is required');
  require(Boolean(policy.expectedFeeTokenPricerRuntimeKeccak256) && report.pricer?.runtimeMatches === true,
    'Pricer runtime must match the reviewed artifact');
  require(report.pricer?.rateMatchesEvidence === true, 'Parent pricer rate must match reviewed evidence');
  if (policy.expectedFeeTokenPricerOwner) require(report.pricer?.ownerMatches === true, 'Pricer owner must match the reviewed address');
  require(policy.feeTokenPricerProductionReviewComplete === true, 'Production pricer review is incomplete');
  const evidence = policy.rateEvidence ?? {};
  const quoteTime = Date.parse(evidence.observedAtUTC);
  const age = (now - quoteTime) / 1000;
  require(positive(evidence.gh0stPerEthX18) && typeof evidence.source === 'string' && evidence.source.length > 0 &&
    Number.isFinite(age) && age >= 0 && age <= evidence.maxAgeSeconds,
    'A positive, current, sourced GH0ST-per-ETH rate is required');
  const accounts = policy.batchPosterAccounts ?? [];
  require(accounts.length > 0 && accounts.every(nonzeroAddress), 'Explicit batch poster accounts are required');
  require(positive(policy.parentETHOperatingReserveWei) && policy.parentETHOperatingReserveApproved === true,
    'An approved parent ETH operating reserve is required');
  if (positive(policy.parentETHOperatingReserveWei)) {
    const reserve = BigInt(policy.parentETHOperatingReserveWei);
    require(report.batchPosters?.length === accounts.length && report.batchPosters.every(x => BigInt(x.ethBalanceWei) >= reserve),
      'Each configured batch poster must have at least the reviewed ETH reserve');
  }
  return { gasPrerequisitesReady: blockers.length === 0, wholeChainDeploymentReady: false, blockers,
    gasOverrides: {
      nativeToken: policy.nativeToken,
      feeTokenPricer: nonzeroAddress(policy.feeTokenPricer) ? getAddress(policy.feeTokenPricer) : null,
    },
    transactionRequestsCreated: 0,
  };
}
