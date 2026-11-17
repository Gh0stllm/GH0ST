export const ZERO = '0x' + '00'.repeat(20);
export const ZERO_HASH = '0x' + '00'.repeat(32);
export const TRUSTED_TEMPORARY_OWNER = '0x8d6b11cfdf079e27c17e05cb7ea81235887691c6';
export const lower = x => String(x).toLowerCase();
function bootstrapMode(c) {
  if (c.bootstrapSetup != null && typeof c.bootstrapSetup !== 'boolean') throw Error('Invalid bootstrap setup mode');
  if (c.bootstrapSetup === true && lower(c.trustedTemporaryOwner) !== TRUSTED_TEMPORARY_OWNER) throw Error('Unreviewed temporary owner');
  return c.bootstrapSetup === true;
}
function uint(value, label) {
  if (typeof value === 'boolean' || value == null || value === '' || (typeof value === 'string' && !/^(0x[0-9a-f]+|[0-9]+)$/i.test(value))) throw Error(`Missing or invalid ${label}`);
  const n = BigInt(value); if (n < 0n) throw Error(`Invalid ${label}`); return n;
}
export function validatePublicConfig(c) {
  if (!c || c.enabled !== true) throw Error('The bridge is being prepared. Transfers are not enabled.');
  if (c.parentChainId !== 4663 || c.childChainId !== 4663001 || c.profile !== 'nitro-project-run-fast-confirmation' || c.zkAtLaunch !== false || c.fastConfirmerEnabled !== true) throw Error('Unsupported network profile');
  if (lower(c.expectedAnyTrustFastConfirmer) !== '0x0f2a3e06d0b6379a68dfe4a6e636c8e9eddef5ad') throw Error('Unexpected confirmer');
  if (!/^0x[0-9a-f]{64}$/i.test(c.childGenesisHash || '') || lower(c.childGenesisHash) === ZERO_HASH) throw Error('Verified genesis is required');
  for (const k of ['parentBackingToken', 'rollupAddress', 'inboxAddress', 'nativeBackingBridge', 'outboxAddress']) if (!/^0x[0-9a-f]{40}$/i.test(c[k] || '') || lower(c[k]) === ZERO) throw Error(`Missing verified ${k}`);
  if (lower(c.parentBackingToken) !== '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559' || c.parentTokenDecimals !== 18) throw Error('Unexpected GH0ST token binding');
  for (const k of ['parentRpcUrl', 'childRpcUrl', 'parentExplorerUrl', 'childExplorerUrl']) {
    const u = new URL(c[k]); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw Error(`Invalid ${k}`);
  }
  if (!c.evidence?.deploymentReceipts || !c.evidence?.nativeBridgeRehearsal || !c.evidence?.batchPosterHealth || !c.evidence?.licensingReview) throw Error('Deployment and review evidence is required');
  const boot = bootstrapMode(c), f = c.finalSetup;
  if (!f || !Array.isArray(f.setupReceiptTxHashes) || (!boot && !f.setupReceiptTxHashes.length) || !f.setupReceiptTxHashes.every(x => /^0x[0-9a-f]{64}$/i.test(x))) throw Error('Receipt-bound final owner and fee setup is required');
  if (f.minimumL2BaseFeeWei !== '10000000000000' || f.activationL2BaseFeeWei !== '10000000000000') throw Error('Unreviewed GL3 fee policy');
  for (const k of ['treasury', 'networkFeeAccount', 'infraFeeAccount', 'l1RewardRecipient']) if (!/^0x[0-9a-f]{40}$/i.test(f[k] || '') || lower(f[k]) === ZERO) throw Error('Explicit nonzero treasury fee recipients are required');
  if (['networkFeeAccount', 'infraFeeAccount', 'l1RewardRecipient'].some(k => lower(f[k]) !== lower(f.treasury))) throw Error('Fee recipient policy differs from the reviewed treasury configuration');
  if (boot && lower(f.treasury) !== TRUSTED_TEMPORARY_OWNER) throw Error('Bootstrap treasury differs from the reviewed cold owner');
  return c;
}
export function validateFinalSetupReadback(c, observed) {
  const boot = bootstrapMode(c);
  if (!Array.isArray(observed.owners) || observed.owners.length !== 1) throw Error('Child owner set is not an exact reviewed singleton');
  const owner = lower(observed.owners[0]);
  if (owner !== ZERO && !(boot && owner === TRUSTED_TEMPORARY_OWNER)) throw Error('Unexpected child owner');
  if (!Array.isArray(observed.minters) || observed.minters.length !== 0) throw Error('Child native minter authority remains');
  if (uint(observed.nativeTokenManagementFrom, 'native management start') !== 0n) throw Error('Child native management is scheduled');
  if (!Array.isArray(observed.scheduledUpgrade) || observed.scheduledUpgrade.length !== 2 || observed.scheduledUpgrade.some(x => uint(x, 'scheduled upgrade') !== 0n)) throw Error('Child upgrade is scheduled or unknown');
  const minimum = uint(observed.minimumGasPrice, 'minimum gas price'), base = uint(observed.baseFee, 'current base fee'), target = BigInt(c.finalSetup.minimumL2BaseFeeWei);
  if (owner === ZERO) {
    if (minimum !== target || base < target) throw Error('Live child fee policy differs from the reviewed setup');
    for (const k of ['networkFeeAccount', 'infraFeeAccount', 'l1RewardRecipient']) if (lower(observed[k]) !== lower(c.finalSetup[k])) throw Error('Live fee recipient changed');
  } else {
    if (lower(c.finalSetup.treasury) !== TRUSTED_TEMPORARY_OWNER) throw Error('Unreviewed bootstrap treasury');
    if (![100000000n, target].includes(minimum) || base < 100000000n) throw Error('Unreviewed bootstrap fee state');
    for (const k of ['networkFeeAccount', 'l1RewardRecipient']) if (lower(observed[k]) !== TRUSTED_TEMPORARY_OWNER) throw Error('Unreviewed bootstrap fee recipient');
    if (![ZERO, TRUSTED_TEMPORARY_OWNER].includes(lower(observed.infraFeeAccount))) throw Error('Unreviewed bootstrap infrastructure recipient');
  }
  return true;
}
export function deriveSetupPhase(c, observed) {
  validateFinalSetupReadback(c, observed);
  const finalSetupComplete = lower(observed.owners[0]) === ZERO;
  const feesAtTarget = uint(observed.minimumGasPrice, 'minimum gas price') === BigInt(c.finalSetup.minimumL2BaseFeeWei) && uint(observed.baseFee, 'current base fee') >= BigInt(c.finalSetup.minimumL2BaseFeeWei) && ['networkFeeAccount', 'infraFeeAccount', 'l1RewardRecipient'].every(k => lower(observed[k]) === lower(c.finalSetup[k]));
  return { phase: finalSetupComplete ? 'finalized' : 'trusted-bootstrap', finalSetupComplete, trustedTemporaryOwner: finalSetupComplete ? null : TRUSTED_TEMPORARY_OWNER, feesAtTarget };
}
export function requireAmount(text) {
  const s = String(text).trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(s) || !/[1-9]/.test(s)) throw Error('Enter a positive GH0ST amount with up to 18 decimal places.');
  return s;
}
export function withdrawalBudget(balance, estimate, priceCap) {
  const gasLimit = BigInt(estimate) * 120n / 100n + 1n;
  if (gasLimit <= 1n || BigInt(priceCap) <= 0n) throw Error('A live withdrawal fee estimate is required');
  const reserve = gasLimit * BigInt(priceCap), amount = BigInt(balance) - reserve;
  if (amount <= 0n) throw Error('Not enough GH0ST to cover the estimated withdrawal gas.');
  return { amount, gasLimit, reserve };
}
export async function confirmedMaxQuote(getQuote, maxPasses = 6) {
  let quote = await getQuote(1n);
  for (let i = 0; i < maxPasses; i++) {
    const fullAmountQuote = await getQuote(quote.amount);
    if (fullAmountQuote.amount >= quote.amount) return quote;
    quote = fullAmountQuote;
  }
  throw Error('Withdrawal fee estimates are changing. Refresh Max before continuing.');
}
export function withdrawalArgs(event, proof) {
  const a = event.args;
  if (a.data !== '0x' || a.callvalue <= 0n || lower(a.destination) === ZERO) throw Error('This is not a simple GH0ST withdrawal');
  return [Array.from(proof), a.position, a.caller, a.destination, a.arbBlockNum, a.ethBlockNum, a.timestamp, a.callvalue, a.data];
}
