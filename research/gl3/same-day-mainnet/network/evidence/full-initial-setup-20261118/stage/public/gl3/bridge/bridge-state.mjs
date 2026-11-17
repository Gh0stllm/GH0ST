// Read-only UI derivation. Observations must come from actual RPC readback and
// receipts. This module neither submits transactions nor authenticates supplied data.
export const FAST_CONFIRMER = '0x0F2a3E06D0B6379a68DFe4a6E636C8e9EDdEf5ad';
export const SECURITY_BADGE = 'Project-run fast confirmation';
export const SECURITY_NOTE = 'GH0ST-operated key confirms withdrawal roots. ZK verification not live.';
const addr = x => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x) ? x.toLowerCase() : null;
const hash = x => typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x) ? x.toLowerCase() : null;

export function deriveBridgeState(binding, observed, withdrawal = {}) {
  const common = { securityBadge: SECURITY_BADGE, securityNote: SECURITY_NOTE,
    trustedConfirmer: FAST_CONFIRMER, zkVerified: false,
    withdrawalFeeNote: 'Robinhood processing fees still apply.', guaranteedInstant: false };
  const fail = reason => ({ ...common, status: 'unavailable', reason, depositEnabled: false, claimEnabled: false });
  if (binding?.profile !== 'nitro-project-run-fast-confirmation' || binding.zkAtLaunch !== false || binding.fastConfirmerEnabled !== true) return fail('Unrecognized confirmation profile');
  if (addr(binding.expectedAnyTrustFastConfirmer) !== addr(FAST_CONFIRMER)) return fail('Unexpected configured GH0ST confirmer');
  if (observed?.parentChainId !== 4663 || observed?.childChainId !== 4663001) return fail('Wrong network');
  if (!hash(binding.childGenesisHash) || hash(binding.childGenesisHash) !== hash(observed.childGenesisHash)) return fail('Genesis binding not verified');
  if (!addr(binding.rollupAddress) || addr(binding.rollupAddress) !== addr(observed.rollupAddress)) return fail('Rollup binding not verified');
  if (addr(observed.anyTrustFastConfirmer) !== addr(FAST_CONFIRMER)) return fail('Onchain fast confirmer does not match GH0ST role');
  if (!observed.nativeBackingVerified || !observed.nodeHealthy || !observed.batchPosterHealthy) return fail('Bridge or node checks are not ready');
  const ready = { ...common, depositEnabled: true, claimEnabled: false };
  if (withdrawal.paidReceiptVerified === true) return { ...ready, status: 'paid', message: 'Withdrawal paid on Robinhood' };
  if (withdrawal.fastConfirmedRootVerified === true) return { ...ready, status: 'claim_ready', claimEnabled: true,
    message: 'GH0ST confirmed the withdrawal root. Claim on Robinhood; processing fees apply.' };
  if (withdrawal.burnReceiptVerified === true) return { ...ready, status: 'awaiting_gh0st_confirmation',
    message: 'Waiting for GH0ST to confirm the withdrawal root on Robinhood. Processing time varies.' };
  return { ...ready, status: 'ready', message: 'Withdrawals become claimable after GH0ST confirms their root on Robinhood.' };
}
