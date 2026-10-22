import * as Ethers from './mint/vendor/ethers.js';

export const INTEL_CHAIN_ID = 4663;
export const INTEL_DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const PREVIEW_FROM = '0x000000000000000000000000000000000000dEaD';
const SUBJECT = '(uint8 kind,bool enabled,address target,address account,bytes32 codeHash,address asset0,address asset1,uint64 sequence,uint8 lastStatus)';
const SNAPSHOT = '(uint64 sequence,uint64 timestamp,uint64 blockNumber,bytes32 parentBlockHash,uint128[4] values)';
const FRAME = `(uint256 subjectId,uint8 kind,${SNAPSHOT} current,${SNAPSHOT} previous,bytes32 currentHash,bytes32 previousHash,int32[8] vector,uint32 elapsedSeconds,uint8 flags,bool hasHistory,bool fresh,uint8 status)`;
const REPORT = '(uint256 subjectId,uint64 currentSequence,uint64 previousSequence,uint64 observedBlock,uint64 createdBlock,uint64 createdAt,bytes32 currentHash,bytes32 previousHash,bytes32 featureHash,bytes32 modelId,uint8 label,int32[8] features,int256[6] scores,uint128[4] currentValues,uint128[4] previousValues,uint8 flags,uint64 observedAt,uint64 previousObservedAt,uint32 elapsedSeconds)';
const INSPECTION = '(address target,address account,uint256 nativeBalance,uint256 codeSize,bytes32 codeHash,uint64 observedAt,uint64 evmBlockNumber,uint8 compatibleKinds,uint8 preferredKind,uint8 supplyStatus,uint8 balanceStatus,uint8 poolStatus,address asset0,address asset1,uint128[4] supplyValues,uint128[4] balanceValues,uint128[4] poolValues)';
const PROFILE = '(address target,uint256 nativeBalance,bytes32 codeHash,uint256 codeBytes,uint256 scannedBytes,bool complete,uint32 opcodeCount,uint32 push4Count,uint8 selectorCount,bytes4[32] selectorCandidates,uint32[10] opcodeSignals,uint8 interfaceMask,bool ownerAvailable,address owner,bool pausedAvailable,bool paused,bool implementationAvailable,address implementation,bool assetAvailable,address asset,uint64 observedAt,uint64 blockCounter)';
export const INTEL_UNIVERSAL_ABI=Object.freeze([`function analyze(address) view returns(${PROFILE} facts,string text)`,`function profile(address) view returns(${PROFILE})`,'function read(address,bytes) view returns(uint8 status,uint256 returnSize,bytes data)']);
export const INTEL_ABIS = Object.freeze({
  observations: ['function owner() view returns(address)','function minSpacing() view returns(uint32)','function subjectCount() view returns(uint256)',`function subject(uint256) view returns(${SUBJECT})`,`function latest(uint256) view returns(${SNAPSHOT})`,`function sampleAt(uint256,uint64) view returns(${SNAPSHOT})`,`function features(uint256,uint8) view returns(${FRAME})`,'function snapshotHash(uint256,uint64) view returns(bytes32)','function snapshot(uint256) returns(uint8 status,uint64 sequence)','function registerSubject(uint8,address,address,bytes32) returns(uint256)','event SnapshotStored(uint256 indexed subjectId,uint64 indexed sequence,bytes32 indexed snapshotHash,uint64 timestamp,uint64 blockNumber,uint128[4] values)','event SnapshotRejected(uint256 indexed subjectId,uint8 status,uint64 currentSequence)','event SubjectRegistered(uint256 indexed subjectId,uint8 kind,address indexed target,address account,bytes32 codeHash,address asset0,address asset1)'],
  reports: ['error InvalidObservation(uint8 status)','error DuplicateReport()','function observations() view returns(address)','function classifier() view returns(address)','function observationsCodeHash() view returns(bytes32)','function classifierCodeHash() view returns(bytes32)','function modelId() view returns(bytes32)','function trainingManifestHash() view returns(bytes32)','function chainId() view returns(uint256)','function reportCount() view returns(uint256)','function latestReport(uint256) view returns(uint256)',`function report(uint256) view returns(${REPORT})`,'function render(uint256) view returns(string)','function analyze(uint256,uint8) returns(uint256)','function captureAndAnalyze(uint256,uint8) returns(uint256)','event ReportPublished(uint256 indexed reportId,uint256 indexed subjectId,uint64 indexed sequence,uint8 label,bytes32 featureHash,bytes32 modelId)'],
  classifier: ['function modelId() view returns(bytes32)','function trainingManifestHash() view returns(bytes32)'],
});
export const INTEL_WATCH_ABI = Object.freeze([...INTEL_ABIS.observations,
  'error WatchLimit()','error InvalidSubject()',
  `function inspect(address,address) view returns(${INSPECTION})`,'function inspectText(address,address) view returns(string)',
  'function subjectKey(uint8,address,address,bytes32) pure returns(bytes32)','function keyToSubject(bytes32) view returns(uint256)',
  'function watch(uint8,address,address,bytes32) returns(uint256)','function isWatching(address,uint256) view returns(bool)','function watchlist(address) view returns(uint256[])','function unwatch(uint256)','event WatchAdded(address indexed watcher,uint256 indexed subjectId,bytes32 indexed key)',
]);
const READ_STATUSES = ['OK','Disabled','Target code changed','Contract read failed','Malformed contract data','Value out of range','Asset metadata changed','Sampling interval not reached','No samples','No earlier sample','Stale observations'];
const KINDS = ['Unknown','ERC-20 supply','ERC-20 account balance','V2 pool'];
const LABELS = ['Normal observation','Supply observation','Watched balance observation','LP-token supply observation','Reserve-ratio observation','Insufficient comparable history'];
const ACTIONS = Object.freeze({ snapshot: { label: 'Take a snapshot', contract: 'observations', method: 'snapshot' }, analyze: { label: 'Analyze saved snapshots', contract: 'reports', method: 'analyze' }, captureAndAnalyze: { label: 'Sample + publish report', contract: 'reports', method: 'captureAndAnalyze' }, register: { label: 'Register a subject', contract: 'observations', method: 'registerSubject' }, watch: {label:'Watch on-chain',contract:'watchObservations',method:'watch'} });
const SUBJECT_FIELDS = ['kind','enabled','target','account','codeHash','asset0','asset1','sequence','lastStatus'];
const SNAPSHOT_FIELDS = ['sequence','timestamp','blockNumber','parentBlockHash','values'];
const FRAME_FIELDS = ['subjectId','kind','current','previous','currentHash','previousHash','vector','elapsedSeconds','flags','hasHistory','fresh','status'];
const REPORT_FIELDS = ['subjectId','currentSequence','previousSequence','observedBlock','createdBlock','createdAt','currentHash','previousHash','featureHash','modelId','label','features','scores','currentValues','previousValues','flags','observedAt','previousObservedAt','elapsedSeconds'];
const INSPECTION_FIELDS = ['target','account','nativeBalance','codeSize','codeHash','observedAt','evmBlockNumber','compatibleKinds','preferredKind','supplyStatus','balanceStatus','poolStatus','asset0','asset1','supplyValues','balanceValues','poolValues'];
const PROFILE_FIELDS=['target','nativeBalance','codeHash','codeBytes','scannedBytes','complete','opcodeCount','push4Count','selectorCount','selectorCandidates','opcodeSignals','interfaceMask','ownerAvailable','owner','pausedAvailable','paused','implementationAvailable','implementation','assetAvailable','asset','observedAt','blockCounter'];
const tuple = (value, fields) => Object.fromEntries(fields.map((key, index) => [key, value[index] ?? value[key]]));
const integer = value => Number(value ?? 0);
const big = value => BigInt(value ?? 0);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const errorText = error => String(error?.shortMessage ?? error?.reason ?? error?.message ?? error ?? 'Operation failed').slice(0, 900);
const short = value => value ? `${String(value).slice(0, 6)}…${String(value).slice(-4)}` : '—';
const textJSON = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const nonzero = value => typeof value === 'string' && !/^0x0+$/i.test(value);

export function parseIntelBudget(value) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(String(value).trim())) throw Error('Enter an exact ETH limit with up to 18 decimal places.');
  const [whole, fraction = ''] = String(value).trim().split('.');
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (wei <= 0n) throw Error('The fee limit must be positive.');
  return wei;
}
export function formatIntelETH(value) {
  const wei = big(value), sign = wei < 0n ? '−' : '', absolute = wei < 0n ? -wei : wei;
  const fraction = (absolute % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${sign}${absolute / 10n ** 18n}${fraction ? `.${fraction}` : ''}`;
}
export function intelSubmissionGasPrice(gasPriceWei, feeCeilingWei) {
  const spot=big(gasPriceWei), ceiling=big(feeCeilingWei);
  if(spot<=0n || ceiling<spot)throw Error('The current gas price exceeds the accepted fee ceiling.');
  const padded=(spot*11000n+9999n)/10000n;
  return padded>ceiling?ceiling:padded;
}
export function intelQuoteMatches(quote, { address, chainId, action, contextHash, now = Date.now() }) {
  return Boolean(quote && !quote.previewOnly && !quote.preview && !quote.readOnly && quote.kind !== 'preview' && same(quote.owner, address) && integer(chainId) === INTEL_CHAIN_ID && integer(quote.chainId) === INTEL_CHAIN_ID && quote.action === action && quote.contextHash === contextHash && Number.isFinite(quote.expiresAt) && quote.expiresAt > now);
}
function timestamp(value) { const ms = Number(value) * 1000; return Number.isFinite(ms) && ms > 0 ? `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC` : '—'; }
function delta(value, previous) { const difference = big(value) - big(previous); return `${difference > 0n ? '+' : ''}${difference.toLocaleString('en-US')}`; }
function percentBps(value, clipped = false) {
  const raw = big(value), absolute = raw < 0n ? -raw : raw;
  const sign = raw < 0n ? '-' : raw > 0n ? '+' : '';
  return (clipped && absolute === 10000n ? (raw < 0n ? '≤ ' : '≥ ') : '') + sign + (absolute / 100n) + '.' + (absolute % 100n).toString().padStart(2, '0') + '%';
}
function observationAge(seconds) { const age = Math.max(0, integer(seconds)); return age < 60 ? age + 's ago' : age < 3600 ? Math.floor(age / 60) + ' min ago' : Math.floor(age / 3600) + 'h ago'; }

export function mountS0ULIntel(root, options = {}) {
  if (!root || root.dataset.s0ulIntelMounted) return null;
  root.dataset.s0ulIntelMounted = 'true';
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis.window;
  const eth = options.ethers ?? Ethers, now = options.now ?? Date.now;
  const supplied = options.deployment ?? null;
  const deployment = supplied?.contracts ? { ...supplied,observations:supplied.contracts.observations,reports:supplied.contracts.reports,classifier:{...supplied.contracts.model,modelId:supplied.modelId,trainingManifestHash:supplied.trainingManifestHash} } : supplied;
  const watchSupplied = options.watchDeployment ?? null;
  const watchDeployment = watchSupplied?.contracts ? {...watchSupplied,observations:watchSupplied.contracts.observations,reports:watchSupplied.contracts.reports,universalReader:watchSupplied.contracts.universalReader,classifier:{...watchSupplied.contracts.model,modelId:watchSupplied.modelId,trainingManifestHash:watchSupplied.trainingManifestHash}} : watchSupplied;
  if (deployment && watchDeployment) {deployment.watchObservations=watchDeployment.observations;deployment.watchReports=watchDeployment.reports;if(watchDeployment.universalReader)deployment.universalReader=watchDeployment.universalReader;}
  root.innerHTML = `
    <section class="intel-shell" aria-labelledby="intel-title">
      <div class="intel-heading"><div><div class="intel-kicker">S0UL / On-chain intelligence</div><h2 id="intel-title">Analyze an address</h2></div><p>${watchDeployment?'Read live on-chain facts. No wallet needed.':'Read a saved report. No wallet needed.'}</p></div>
      <div class="intel-topbar"><div class="intel-network"><span id="intel-dot" class="intel-dot" data-state="waiting" aria-hidden="true"></span><span id="intel-network">Connecting to Robinhood Chain…</span></div><span id="intel-subject-count" class="intel-tag">Loading monitors</span></div>
      <div class="intel-search"><label class="intel-field" for="intel-address">Address</label><div class="intel-address-row"><input id="intel-address" spellcheck="false" autocomplete="off" placeholder="Paste a Robinhood Chain address · 0x…" aria-describedby="intel-scope" disabled><button id="intel-search" class="intel-button intel-button-primary" type="button" disabled>Analyze <span aria-hidden="true">↗</span></button></div><details id="intel-balance-options" class="intel-disclosure" hidden><summary>Token balance (optional)</summary><label class="intel-field">Account address<input id="intel-inspect-account" spellcheck="false" autocomplete="off" placeholder="0x…"></label></details><div id="intel-examples" class="intel-examples" aria-label="Try a tracked address"></div><p id="intel-scope" class="intel-small">${watchDeployment?.universalReader?'On-chain facts for any address. Not a security audit.':watchDeployment?'Address facts, compatible ERC-20s and V2 pools. Not a security audit.':'Registered tokens and pools only. Not a security audit.'}</p></div>
      <div id="intel-notice" class="intel-notice" role="status" aria-live="polite">Connecting to the on-chain registry…</div>
      <section id="intel-live-result" class="intel-results" aria-labelledby="intel-live-title" hidden><div class="intel-panel-head"><div><span id="intel-live-type" class="intel-kicker"></span><h3 id="intel-live-title">Current on-chain facts</h3></div><span id="intel-live-time" class="intel-tag"></span></div><p id="intel-live-report" class="intel-result-summary"></p><dl id="intel-live-summary" class="intel-summary"></dl><button id="intel-watch" class="intel-button" type="button" hidden>Watch on-chain</button><p id="intel-watch-status" class="intel-small"></p></section>
      <div id="intel-matches" class="intel-examples intel-matches" aria-label="Available analysis" hidden></div>
      <details id="intel-saved-history" class="intel-disclosure" hidden><summary>Saved on-chain history</summary>
      <section id="intel-result" class="intel-results" aria-labelledby="intel-result-title" hidden>
        <div class="intel-panel-head"><div><span id="intel-result-type" class="intel-kicker"></span><h3 id="intel-result-title">Saved observation</h3></div><span id="intel-freshness" class="intel-tag"></span></div>
        <p id="intel-result-summary" class="intel-result-summary"></p><dl id="intel-summary" class="intel-summary"></dl>
      </section>
      </details>
      <details id="intel-update" class="intel-disclosure intel-update"><summary><span id="intel-update-label">Update the report on-chain</span> <span>Wallet + gas</span></summary><div class="intel-transact" aria-labelledby="intel-fee-title"><div class="intel-panel-head"><h3 id="intel-fee-title">Refresh this report</h3></div><p id="intel-action-description" class="intel-small">Save a fresh observation and report in one transaction.</p>
        
        <button id="intel-estimate" class="intel-button" type="button" disabled>Calculate gas</button><p id="intel-cost-status" class="intel-small" role="status" aria-live="polite">Select an address to calculate its update cost.</p>
        <div class="intel-fee"><span class="intel-micro">Estimated network fee</span><strong id="intel-fee">—</strong><div class="intel-panel-head"><span id="intel-quote-expiry" class="intel-tag">Calculate the cost first</span><span class="intel-small">No transaction sent</span></div><details id="intel-fee-advanced" class="intel-disclosure"><summary>Fee details</summary><dl class="intel-dl"><div><dt>Gas estimate</dt><dd id="intel-gas">—</dd></div><div><dt>Gas reserve (+20%)</dt><dd id="intel-gas-limit">—</dd></div><div><dt>Current gas / ceiling</dt><dd id="intel-gas-price">—</dd></div><div><dt>Submission (+10%, capped)</dt><dd id="intel-submission-price">—</dd></div><div><dt>Maximum fee reserve</dt><dd id="intel-reserve">—</dd></div></dl></details></div>
        <button id="intel-connect" class="intel-button" type="button" hidden disabled>Connect wallet to update</button>
        <div id="intel-fee-approval" hidden><label class="intel-field">Maximum fee (ETH)<input id="intel-limit" inputmode="decimal" autocomplete="off" placeholder="Calculate the cost first" disabled></label><label class="intel-consent"><input id="intel-consent" type="checkbox" disabled><span>I approve this action and its maximum fee.</span></label><button id="intel-send" class="intel-button intel-button-primary" type="button" disabled>Confirm in wallet <span aria-hidden="true">→</span></button><p class="intel-small">One wallet transaction. Gas is paid even if it reverts.</p></div>
      </div></details>
      <div id="intel-recovery" class="intel-recovery" hidden><p>A wallet transaction is unresolved. Check its exact hash before another action.</p><div class="intel-form-row"><label class="intel-field">Transaction hash<input id="intel-recovery-hash" spellcheck="false" autocomplete="off" placeholder="0x…"></label><button id="intel-reconcile" class="intel-button" type="button">Check transaction ↗</button></div></div>
      <details id="intel-technical" class="intel-disclosure intel-technical"><summary>Technical details <span>Sources, observations &amp; model</span></summary>
        <details class="intel-disclosure intel-action-options"><summary>Other actions</summary><label class="intel-field">Action<select id="intel-action" disabled><option value="captureAndAnalyze">Update on-chain report</option><option value="snapshot">Save observation only</option><option value="analyze">Analyze stored observations</option><option id="intel-watch-option" value="watch" hidden>Watch this source</option><option id="intel-register-option" value="register" hidden>Register a monitor</option></select></label></details>
        <details id="intel-inspection-details" class="intel-disclosure" hidden><summary>Live inspection evidence</summary><pre id="intel-inspection-evidence"></pre></details>
        <details id="intel-universal-details" class="intel-disclosure" hidden><summary>Advanced · Read a contract getter</summary><p class="intel-small">Enter ABI-encoded calldata for this address. The on-chain reader makes a bounded STATICCALL; its caller differs from your wallet. A successful response does not establish its meaning or safety.</p><label class="intel-field">Calldata (hex)<input id="intel-raw-calldata" spellcheck="false" autocomplete="off" placeholder="0x8da5cb5b"></label><button id="intel-raw-read" class="intel-button" type="button">Read getter</button><pre id="intel-raw-result">No getter requested.</pre></details>
        <details class="intel-disclosure intel-stored-report"><summary>Read the full on-chain report</summary><pre id="intel-report">No on-chain report loaded.</pre><p class="intel-small">Read directly from the report contract. Its block counter differs from the Robinhood transaction block number.</p></details>
        <div id="intel-sources" class="intel-sources" hidden></div>
        <div class="intel-form-row intel-subject-row"><label class="intel-field">Monitor ID<input id="intel-subject-id" inputmode="numeric" value="1" autocomplete="off" disabled></label><label class="intel-field">Compare with<select id="intel-lookback" disabled><option value="1">Previous observation</option><option value="2">2 observations back</option><option value="3">3 observations back</option><option value="4">4 observations back</option><option value="5">5 observations back</option><option value="6">6 observations back</option><option value="7">7 observations back</option><option value="8">8 observations back</option><option value="9">9 observations back</option><option value="10">10 observations back</option><option value="11">11 observations back</option><option value="12">12 observations back</option><option value="13">13 observations back</option><option value="14">14 observations back</option><option value="15">15 observations back</option></select></label><button id="intel-load" class="intel-button" type="button" disabled>Read monitor ↗</button></div>
        <p id="intel-empty" class="intel-empty">No monitor selected.</p><div id="intel-subject" hidden><h4 id="intel-subject-name" class="intel-subject-name"></h4><dl id="intel-subject-details" class="intel-dl"></dl><div id="intel-metrics" class="intel-metrics"></div><dl id="intel-snapshot-details" class="intel-dl"></dl></div>
        <div class="intel-evidence"><h3>Stored model evidence</h3><pre id="intel-features">No observations loaded.</pre><dl id="intel-report-details" class="intel-dl"></dl></div><p class="intel-small">A separate 25-parameter numeric classifier routes observations using a synthetic 2.5% policy. These are observations, not forecasts or safety verdicts. The original S0UL-1M agent is available below.</p><p class="intel-footnote">Raw token units and reserve ratios are not USD prices or volume. EVM counters estimate ancestor-chain height. EVM BLOCKHASH output is not a canonical parent hash or finality proof.</p>
        <details id="intel-registration" class="intel-registration" hidden><summary>Registry owner · Add a compatible monitor</summary><div class="intel-register-fields"><label class="intel-field">Reader<select id="intel-kind"><option value="3">V2 pool</option><option value="1">ERC-20 total supply</option><option value="2">ERC-20 account balance</option></select></label><label class="intel-field">Source contract<input id="intel-target" spellcheck="false" autocomplete="off" placeholder="0x…"></label><label class="intel-field" id="intel-account-field" hidden>Watched account<input id="intel-account" spellcheck="false" autocomplete="off" placeholder="0x…"></label></div><p class="intel-small">Only the registry owner can add a reader. Registration pins source bytecode; it does not establish contract safety.</p><button id="intel-register-prepare" class="intel-button" type="button">Review registration ↗</button></details>
        <details class="intel-history"><summary>Transaction record <span id="intel-receipt-count">· 0 confirmed</span></summary><ol id="intel-receipts"></ol></details>
      </details>
    </section>`;
  const el = id => root.querySelector(`#intel-${id}`);
  const controls = Object.fromEntries(['address','search','connect','subject-id','lookback','load','action','estimate','limit','consent','send','kind','target','account','register-prepare','recovery-hash','reconcile','inspect-account','watch','raw-calldata','raw-read'].map(id => [id, el(id)]));
  let provider = null, walletProvider = null, contracts = null, current = null, quote = null, pending = null;
  let destroyed = false, busy = false, verified = false, address = null, chainId = null, owner = null, subjectCount = 0n, chainBlock = null;
  let contextHash = '', message = '', hasError = false, receipts = [], timer = null, modelIdentity = null, recoveryFault = '';
  let quoteGeneration = 0, costStatus = '', costError = false, calculating = false;
  let inspection = null, inspectedText = '', watchJoined = false;
  const ethereum = options.ethereum ?? win?.ethereum;
  const storage = options.storage ?? (() => { try { return win?.localStorage; } catch { return null; } })();
  const listeners = [];
  let matchedSubjects = [], exampleButtons = [], matchButtons = [];

  function notice(text, error = false) { message = text; hasError = error; renderNotice(); }
  function renderNotice() { const node = el('notice'); if (node.textContent !== message) node.textContent = message; node.dataset.error = String(hasError); }
  function invalidate() { quoteGeneration++; quote = null; costStatus = ''; costError = false; controls.consent.checked = false; render(); }
  function subjectId() { const raw = controls['subject-id'].value.trim(); if (!/^[1-9]\d*$/.test(raw)) throw Error('Enter a positive registered subject ID.'); return BigInt(raw); }
  function lookback() { const value = Number(controls.lookback.value); if (!Number.isInteger(value) || value < 1 || value > 15) throw Error('Choose a lookback from 1 to 15 samples.'); return value; }
  function actionName() { const action = controls.action.value; if (!Object.hasOwn(ACTIONS, action)) throw Error('Choose a supported action.'); return action; }
  function contractNames() {return ['observations','reports','classifier',...(watchDeployment?['watchObservations','watchReports']:[]),...(watchDeployment?.universalReader?['universalReader']:[])];}
  function actionSpecification(action, registry = current?.registry ?? 'legacy') {
    const spec=ACTIONS[action];
    return registry==='watch' && ['snapshot','analyze','captureAndAnalyze'].includes(action) ? {...spec,contract:spec.contract==='observations'?'watchObservations':'watchReports'} : spec;
  }
  function allowedActionContract(action,name) {return name===ACTIONS[action]?.contract || Boolean(watchDeployment && ['snapshot','analyze','captureAndAnalyze'].includes(action) && name===actionSpecification(action,'watch').contract);}
  function isOwner() { return same(address, owner); }
  function freshQuote() { return quote?.kind === 'wallet' && !quote.previewOnly && intelQuoteMatches(quote, { address, chainId, action: controls.action.value, contextHash, now: now() }); }
  function reviewed() { if (!freshQuote() || !controls.consent.checked || pending || recoveryFault) return false; try { return parseIntelBudget(controls.limit.value) >= quote.reserveWei; } catch { return false; } }
  function noPending() {if(pending||recoveryFault)throw Error(recoveryFault||'Resolve the saved wallet transaction before requesting another action.');}
  function savePending(required = false, walletAddress = pending?.owner ?? address) {
    try {
      if (!storage || !walletAddress) throw Error('Transaction recovery storage is unavailable.');
      const key = `gh0st:intel:4663:${walletAddress.toLowerCase()}`;
      if (pending) {const serialized=textJSON(pending);storage.setItem(key,serialized);if(storage.getItem(key)!==serialized)throw Error('Transaction recovery storage could not be verified.');}
      else storage.removeItem(key);
      return true;
    } catch (error) {if(required)throw Error(`Durable transaction recovery storage could not be saved. ${errorText(error)}`);return false;}
  }
  function restorePending() {
    recoveryFault='';pending=null;
    try {
      const saved = storage?.getItem(`gh0st:intel:4663:${address.toLowerCase()}`);if(saved===null||saved===undefined)return;
      const record=JSON.parse(saved);
      const savedContract=record?.contract??ACTIONS[record?.action]?.contract;
      if (!record || !same(record.owner,address) || integer(record.chainId)!==INTEL_CHAIN_ID || !Object.hasOwn(ACTIONS,record.action) || !allowedActionContract(record.action,savedContract) || !same(record.to,contractAddress(savedContract)) || record.hash!==null&&!/^0x[0-9a-fA-F]{64}$/.test(record.hash) || !/^0x[0-9a-fA-F]{64}$/.test(record.dataHash??'') || !Number.isSafeInteger(record.nonce) || record.nonce<0 || big(record.gasLimit)<=0n || big(record.feeCeilingWei)<=0n || big(record.budgetWei)<=0n) throw Error('Invalid saved transaction identity.');
      record.contract=savedContract;
      pending=record;
    } catch(error) {recoveryFault=`Saved transaction recovery data is unreadable. Wallet writes remain disabled until that record is recovered. ${errorText(error)}`;throw Error(recoveryFault);}
  }
  function appendRows(node, rows) { node.replaceChildren(); for (const [label, value, stale] of rows) { const row = doc.createElement('div'), dt = doc.createElement('dt'), dd = doc.createElement('dd'); dt.textContent = label; dd.textContent = String(value); if (stale) dd.dataset.stale = 'true'; row.append(dt, dd); node.append(row); } }
  function render() {
    if (destroyed) return;
    const active = Boolean(deployment), connected = Boolean(address && chainId === INTEL_CHAIN_ID), writable = verified && connected && !busy && !pending && !recoveryFault;
    controls.connect.disabled = !active || busy; controls.connect.textContent = address ? `${short(address)} ↗` : 'Connect wallet to update';
    controls.connect.hidden = !quote && !address && !pending && !recoveryFault && controls.action.value !== 'register';
    controls.address.disabled = !verified || busy; controls.search.disabled = !verified || busy;
    controls['inspect-account'].disabled = !verified || busy; controls.watch.disabled = !verified || busy || Boolean(pending) || Boolean(recoveryFault);
    controls['raw-read'].disabled=!verified||busy||!inspection||!watchDeployment?.universalReader;controls['raw-calldata'].disabled=controls['raw-read'].disabled;
    el('universal-details').hidden=!inspection||!watchDeployment?.universalReader;
    el('balance-options').hidden = !watchDeployment; el('watch-option').hidden = !watchDeployment;
    const watchingAction=controls.action.value==='watch';
    el('update-label').textContent=watchingAction?'Watch on-chain':'Update the report on-chain';
    el('fee-title').textContent=watchingAction?'Save this watch':'Refresh this report';
    el('action-description').textContent=watchingAction?'Add this source to your on-chain watch list. A new source saves its first observation; joining an existing source preserves its history.':'Save a fresh observation and report in one transaction.';
    el('update').hidden=Boolean(watchDeployment&&!current&&!integer(inspection?.preferredKind));
    controls.search.textContent = busy ? 'Reading the chain…' : 'Analyze ↗';
    for (const button of [...exampleButtons, ...matchButtons]) button.disabled = !verified || busy;
    for (const control of [controls['subject-id'],controls.lookback,controls.load]) control.disabled = !verified || busy;
    for (const control of [controls.action,controls.kind,controls.target,controls.account,controls['register-prepare']]) control.disabled = !verified || busy || Boolean(pending);
    controls.estimate.disabled = !active || !provider || !contracts || busy || Boolean(pending) || Boolean(recoveryFault) || (controls.action.value === 'register' ? !isOwner() : controls.action.value==='watch' ? !inspection || !integer(inspection.preferredKind) : !current);
    controls.estimate.textContent = calculating ? 'Calculating…' : 'Calculate gas';
    controls.limit.disabled = !freshQuote() || busy; controls.consent.disabled = !freshQuote() || busy;
    el('fee-approval').hidden = !freshQuote();
    controls.send.disabled = !writable || !reviewed(); controls.reconcile.disabled = busy || !address || Boolean(recoveryFault);
    el('registration').hidden = !isOwner(); el('register-option').hidden = !isOwner(); el('account-field').hidden = controls.kind.value !== '2';
    el('recovery').hidden = !pending && !recoveryFault;
    if (pending?.hash) controls['recovery-hash'].value = pending.hash;
    if (quote) {
      el('fee').textContent = `${formatIntelETH(quote.estimatedWei)} ETH`;
      el('gas').textContent = quote.gasEstimate.toLocaleString('en-US'); el('gas-limit').textContent = quote.gasLimit.toLocaleString('en-US');
      el('gas-price').textContent = `${Number(quote.gasPriceWei) / 1e9} / ${Number(quote.feeCeilingWei) / 1e9} gwei`;
      el('submission-price').textContent = `${Number(quote.submissionGasPriceWei) / 1e9} gwei`;
      el('reserve').textContent = `${formatIntelETH(quote.reserveWei)} ETH`;
      const currentQuote = quote.action === controls.action.value && quote.contextHash === contextHash && quote.expiresAt > now();
      el('quote-expiry').textContent = currentQuote ? `${quote.previewOnly ? 'Preview · ' : ''}Expires in ${Math.max(0, Math.ceil((quote.expiresAt - now()) / 1000))}s` : 'Estimate expired — calculate again';
    } else { for (const id of ['fee','gas','gas-limit','gas-price','submission-price','reserve']) el(id).textContent = '—'; el('quote-expiry').textContent = 'No estimate'; }
    const costNode = el('cost-status');
    costNode.textContent = costStatus || (pending || recoveryFault ? 'Resolve the saved wallet transaction before another update.' : !verified ? 'Connecting to the on-chain contracts…' : !current && !inspection && controls.action.value !== 'register' ? 'Analyze an address first, then calculate its on-chain action cost.' : 'Calculate gas first. No wallet is needed for a preview.');
    costNode.dataset.error = String(costError);
    renderNotice();
  }
  async function operation(fn) {
    if (busy || destroyed) return;
    busy = true; render();
    try { await fn(); } catch (error) { if (deployment && !verified) {el('dot').dataset.state='error';el('network').textContent='Contract verification incomplete';} notice(errorText(error), true); }
    finally { busy = false; render(); }
  }
  function contractAddress(name) { return deployment?.[name]?.address; }
  async function verifyDeployment() {
    verified = false;
    const rpcChain = await provider.send('eth_chainId',[]); if (Number(BigInt(rpcChain)) !== INTEL_CHAIN_ID) throw Error('The read provider is not Robinhood Chain (4663).');
    await Promise.all(contractNames().map(async name => {
      const item = deployment[name];
      if (!eth.isAddress(item?.address) || !/^0x[0-9a-fA-F]{64}$/.test(item?.codeHash ?? '') || !nonzero(item.codeHash)) throw Error(`A deployed ${name} address and pinned bytecode hash are required.`);
      const code = await provider.getCode(item.address); if (code === '0x' || !same(eth.keccak256(code), item.codeHash)) throw Error(`The pinned ${name} bytecode does not match this chain.`);
    }));
    const [observationsAddress,classifierAddress,observationHash,classifierHash,reportModelId,reportManifest,reportChain,modelId,manifest] = await Promise.all([contracts.reports.observations(),contracts.reports.classifier(),contracts.reports.observationsCodeHash(),contracts.reports.classifierCodeHash(),contracts.reports.modelId(),contracts.reports.trainingManifestHash(),contracts.reports.chainId(),contracts.classifier.modelId(),contracts.classifier.trainingManifestHash()]);
    if (!same(observationsAddress,contractAddress('observations')) || !same(classifierAddress,contractAddress('classifier')) || !same(observationHash,deployment.observations.codeHash) || !same(classifierHash,deployment.classifier.codeHash) || !same(reportModelId,modelId) || !same(reportManifest,manifest) || integer(reportChain) !== INTEL_CHAIN_ID) throw Error('The report contract dependencies do not match the pinned deployment.');
    if (deployment.classifier.modelId && !same(modelId,deployment.classifier.modelId) || deployment.classifier.trainingManifestHash && !same(manifest,deployment.classifier.trainingManifestHash)) throw Error('The numeric model identity differs from the configured pin.');
    if(watchDeployment) {
      if(integer(watchDeployment.chainId)!==INTEL_CHAIN_ID || !same(watchDeployment.classifier?.address,contractAddress('classifier')) || !same(watchDeployment.classifier?.codeHash,deployment.classifier.codeHash) || watchDeployment.classifier?.modelId && !same(watchDeployment.classifier.modelId,modelId) || watchDeployment.classifier?.trainingManifestHash && !same(watchDeployment.classifier.trainingManifestHash,manifest))throw Error('The watch deployment does not match this chain and pinned numeric model.');
      const r=contracts.watchReports;
      const [o,c,oh,ch,m,t,chain]=await Promise.all([r.observations(),r.classifier(),r.observationsCodeHash(),r.classifierCodeHash(),r.modelId(),r.trainingManifestHash(),r.chainId()]);
      if(!same(o,contractAddress('watchObservations')) || !same(c,contractAddress('classifier')) || !same(oh,deployment.watchObservations.codeHash) || !same(ch,deployment.classifier.codeHash) || !same(m,modelId) || !same(t,manifest) || integer(chain)!==INTEL_CHAIN_ID)throw Error('The watch report dependencies do not match the pinned deployment.');
    }
    modelIdentity = {modelId,trainingManifestHash:manifest};
    verified = true;
  }
  function renderSources() {
    const node = el('sources'); node.replaceChildren(); node.hidden = !deployment;
    for (const name of contractNames()) {
      const item = deployment[name], cell = doc.createElement('div'), label = doc.createElement('span'), addressNode = doc.createElement('code'), hash = doc.createElement('small');
      cell.className = 'intel-source'; label.textContent = name === 'classifier' ? 'Numeric model head' : name;
      addressNode.textContent = item?.address ?? 'Awaiting deployment'; hash.textContent = `Pinned code: ${item?.codeHash ?? 'unavailable'}${name === 'classifier' && modelIdentity ? ` · Model ${modelIdentity.modelId} · Training manifest ${modelIdentity.trainingManifestHash}` : ''}`;
      cell.append(label, addressNode, hash); node.append(cell);
    }
  }
  function clearSelection() {
    current = null; inspection=null;inspectedText='';watchJoined=false;contextHash = ''; matchedSubjects = []; controls['subject-id'].value = '';el('raw-result').textContent='No getter requested.';
    el('matches').replaceChildren(); el('matches').hidden = true; matchButtons = [];
    invalidate(); renderCurrent();renderInspection();
  }
  function renderMatches() {
    const node = el('matches'); node.replaceChildren(); matchButtons = []; node.hidden = matchedSubjects.length < 2;
    for (const item of matchedSubjects) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'intel-example';
      const kind = integer(item.subject.kind);
      button.textContent = (kind === 1 ? 'Token supply' : kind === 2 ? 'Watched balance · ' + short(item.subject.account) : 'Pool reserves')+(item.registry==='watch'?' · Open watch':' · Original');
      button.dataset.selected = String(big(item.id) === big(current?.id) && (item.registry??'legacy')===(current?.registry??'legacy'));
      listen(button, 'click', () => operation(async () => { controls['subject-id'].value = item.id.toString(); await load(item.registry??'legacy'); }));
      matchButtons.push(button); node.append(button);
    }
  }
  function renderExamples() {
    const node = el('examples'); node.replaceChildren(); exampleButtons = [];
    const sources = deployment?.subjects?.length ? deployment.subjects : current ? [current.subject] : [];
    const seen = new Set();
    for (const source of sources) {
      const kind = integer(source.kind), value = kind === 2 ? source.account : source.target;
      if (!eth.isAddress(value) || !nonzero(value) || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'intel-example';
      button.textContent = kind === 2 ? 'Watched wallet' : kind === 3 ? (source.label ?? 'Tracked pool') : (source.label ?? 'Tracked token');
      listen(button, 'click', () => operation(() => analyzeAddress(value)));
      exampleButtons.push(button); node.append(button);
    }
  }
  function inspectionAccount() {
    const raw=controls['inspect-account'].value.trim();
    if(!raw)return eth.ZeroAddress;
    if(!eth.isAddress(raw)||!nonzero(raw))throw Error('Enter a valid, nonzero account for the optional token balance.');
    return eth.getAddress(raw);
  }
  async function inspectAddress(target, account=inspectionAccount()) {
    if(!watchDeployment)throw Error('Live inspection is not configured.');
    const block=await provider.getBlock('latest');if(!block)throw Error('The current chain block is unavailable.');
    const at={blockTag:block.number};
    const [raw,text,universal]=await Promise.all([contracts.watchObservations.inspect(target,account,at),contracts.watchObservations.inspectText(target,account,at),watchDeployment.universalReader?contracts.universalReader.analyze(target,at):null]);
    const result=tuple(raw,INSPECTION_FIELDS);
    if(!same(result.target,target)||!same(result.account,account)||integer(result.compatibleKinds)>7||integer(result.preferredKind)>3||big(result.observedAt)>big(block.timestamp)||big(result.codeSize)<0n)throw Error('The on-chain inspector returned an inconsistent result.');
    const preferred=integer(result.preferredKind),mask=integer(result.compatibleKinds);
    if(preferred && !(mask&(1<<(preferred-1))))throw Error('The inspector reader kind does not match its validated capabilities.');
    let universalProfile=null,universalText=null;
    if(universal){universalProfile=tuple(universal.facts??universal[0],PROFILE_FIELDS);universalText=String(universal.text??universal[1]);if(!same(universalProfile.target,target)||big(universalProfile.nativeBalance)!==big(result.nativeBalance)||big(universalProfile.codeBytes)!==big(result.codeSize)||!same(universalProfile.codeHash,result.codeHash)||integer(universalProfile.selectorCount)>32||integer(universalProfile.interfaceMask)>15||big(universalProfile.scannedBytes)>big(universalProfile.codeBytes)||big(universalProfile.scannedBytes)>24_576n||big(universalProfile.observedAt)>big(block.timestamp))throw Error('The universal reader returned an inconsistent profile.');}
    return {...result,block,text:String(text),universalProfile,universalText};
  }
  async function watchSubjectId(result=inspection) {
    if(!result||!integer(result.preferredKind))return 0n;
    const kind=integer(result.preferredKind),account=kind===2?result.account:eth.ZeroAddress;
    const key=await contracts.watchObservations.subjectKey(kind,result.target,account,result.codeHash);
    return big(await contracts.watchObservations.keyToSubject(key));
  }
  function renderInspection() {
    el('live-result').hidden=!inspection;el('inspection-details').hidden=!inspection;
    if(!inspection){controls.watch.hidden=true;el('live-report').textContent='';appendRows(el('live-summary'),[]);el('inspection-evidence').textContent='';return;}
    const kind=integer(inspection.preferredKind),code=big(inspection.codeSize)>0n;
    const profile=inspection.universalProfile,mask=integer(profile?.interfaceMask);
    el('live-type').textContent=kind===3?'V2-compatible pool':kind===2?'ERC-20 account balance':kind===1?'ERC-20-compatible token':mask&2?'ERC-721 interface reported':mask&4?'ERC-1155 interface reported':code?'Contract':'Address without deployed code';
    el('live-time').textContent=timestamp(inspection.observedAt);
    el('live-report').textContent=inspection.universalText||(kind?'Current readings from compatible on-chain getters. Compatibility does not establish authenticity or contract safety.':'Current balance and runtime facts are available.');
    const rows=[['Native balance',formatIntelETH(inspection.nativeBalance)+' ETH']];
    if(kind===1)rows.push(['Token supply (raw units)',big(inspection.supplyValues[0]).toLocaleString('en-US')]);
    if(integer(inspection.compatibleKinds)&2)rows.push(['Token balance (raw units)',big(inspection.balanceValues[0]).toLocaleString('en-US')],['Account',inspection.account]);
    if(kind===3)rows.push(['Reserve 0 (raw units)',big(inspection.poolValues[0]).toLocaleString('en-US')],['Reserve 1 (raw units)',big(inspection.poolValues[1]).toLocaleString('en-US')],['LP supply (raw units)',big(inspection.poolValues[2]).toLocaleString('en-US')]);
    rows.push(['Runtime code',code?`${inspection.codeSize} bytes`:'No deployed bytecode']);
    if(profile?.ownerAvailable)rows.push(['owner() response',profile.owner]);
    if(profile?.pausedAvailable)rows.push(['paused() response',profile.paused?'true':'false']);
    if(profile?.implementationAvailable)rows.push(['implementation() response',profile.implementation]);
    if(profile?.assetAvailable)rows.push(['asset() response',profile.asset]);
    rows.push(['Robinhood block',inspection.block.number]);appendRows(el('live-summary'),rows);
    controls.watch.hidden=!kind;controls.watch.textContent=watchJoined?'Refresh saved report':'Watch on-chain';
    el('watch-status').textContent=!kind?'Current address analysis is available. Token and pool history can be watched when compatible getters are present.':watchJoined?'On your on-chain watch list. Refresh the report when you want a new comparison.':'Watching saves an on-chain baseline. Later comparisons need another wallet transaction; updates do not run automatically.';
    el('inspection-evidence').textContent=inspectedText+'\n\n'+textJSON({...inspection,text:undefined,block:{number:inspection.block.number,hash:inspection.block.hash}});
  }
  async function rawRead(value=controls['raw-calldata'].value) {
    el('raw-result').textContent='Reading through the on-chain STATICCALL reader…';
    try{
      if(!verified||!inspection||!watchDeployment?.universalReader)throw Error('Analyze an address with the verified universal reader first.');
      const data=String(value).trim();
      if(!/^0x(?:[0-9a-fA-F]{2})*$/.test(data))throw Error('Enter complete hex bytes beginning with 0x.');
      if((data.length-2)/2>4096)throw Error('Calldata is limited to 4,096 bytes.');
      const generation=quoteGeneration,target=inspection.target,block=await provider.getBlock('latest');
      if(!block)throw Error('The current chain block is unavailable.');
      const result=await contracts.universalReader.read(target,data,{blockTag:block.number});
      if(generation!==quoteGeneration||!same(target,inspection?.target))throw Error('The selected address changed. Read the getter again.');
      const status=integer(result.status??result[0]),returnSize=big(result.returnSize??result[1]),output=String(result.data??result[2]);
      if(!/^0x(?:[0-9a-fA-F]{2})*$/.test(output))throw Error('The reader returned an inconsistent bounded response.');
      const copied=BigInt((output.length-2)/2),expectedCopied=returnSize>2048n?2048n:returnSize;
      if(status<0||status>2||returnSize<0n||copied!==expectedCopied||status===0&&returnSize>2048n||status===2&&returnSize<=2048n)throw Error('The reader returned an inconsistent bounded response.');
      el('raw-result').textContent=textJSON({status:['Call returned','Target call failed or reverted','Return data exceeded 2,048 bytes; prefix shown'][status],target,reader:contractAddress('universalReader'),blockNumber:block.number,returnSize,data:output});
      notice('Read-only getter result received. No wallet request or transaction was made.');
    }catch(error){el('raw-result').textContent=errorText(error);throw error;}
  }
  async function analyzeAddress(value = controls.address.value) {
    clearSelection();
    const generation=quoteGeneration;
    if (!verified) throw Error('Wait for the on-chain registry to connect.');
    const input = String(value).trim(); controls.address.value = input;
    if (!eth.isAddress(input) || !watchDeployment && !nonzero(input)) throw Error(watchDeployment?'Enter a valid 0x address on Robinhood Chain.':'Enter a valid, nonzero 0x address on Robinhood Chain.');
    const query = eth.getAddress(input); controls.address.value = query;
    if(watchDeployment){const result=await inspectAddress(query);if(generation!==quoteGeneration)throw Error('The address changed while reading. Choose Analyze again.');inspection=result;inspectedText=inspection.text;renderInspection();}
    let historyWarning='';
    const records = [];
    try{
    const count = big(await contracts.observations.subjectCount());
    if (count < 0n || count > 256n) throw Error('The registry count is outside the supported range. No analysis was selected.');
    for (let first = 1n; first <= count; first += 8n) {
      const ids = Array.from({length:Number(count-first+1n < 8n ? count-first+1n : 8n)}, (_, index) => first + BigInt(index));
      const group = await Promise.all(ids.map(async id => {
        const subject = tuple(await contracts.observations.subject(id), SUBJECT_FIELDS);
        if (integer(subject.kind) < 1 || integer(subject.kind) > 3 || !eth.isAddress(subject.target) || !nonzero(subject.target)) throw Error('A registered monitor could not be verified. Try reading the address again.');
        return {id,subject,registry:'legacy'};
      }));
      records.push(...group);
    }
    subjectCount = count; el('subject-count').textContent = count + ' original monitors';
    }catch(error){if(!inspection)throw error;records.length=0;historyWarning=' Original saved history is temporarily unavailable.';}
    if(generation!==quoteGeneration)throw Error('The address changed while reading. Choose Analyze again.');
    matchedSubjects = records.filter(item => same(item.subject.target, query) || integer(item.subject.kind) === 2 && same(item.subject.account, query));
    if(inspection){try{const watchId=await watchSubjectId();if(watchId>0n){const subject=tuple(await contracts.watchObservations.subject(watchId),SUBJECT_FIELDS);if(generation!==quoteGeneration)throw Error('The address changed while reading. Choose Analyze again.');matchedSubjects.unshift({id:watchId,subject,registry:'watch'});}}catch(error){if(generation!==quoteGeneration)throw error;historyWarning+=' Saved watch history is temporarily unavailable.';}}
    if(generation!==quoteGeneration)throw Error('The address changed while reading. Choose Analyze again.');
    renderMatches();
    if (!matchedSubjects.length) {if(inspection){controls.action.value=integer(inspection.preferredKind)?'watch':'captureAndAnalyze';notice('Live on-chain facts loaded. No wallet or registration was needed.'+historyWarning);}else notice('No S0UL monitor is registered for this address. The registry owner must add a compatible token or pool before it can be analysed.');return; }
    controls['subject-id'].value = matchedSubjects[0].id.toString();
    await load(matchedSubjects[0].registry??'legacy');
    if(inspection)notice('Live on-chain facts and available saved history loaded. Reading is free.'+historyWarning);
  }
  async function initialize() {
    if (!deployment) { notice('Intelligence contracts awaiting deployment. No observations or reports are available yet.'); render(); return; }
    if (integer(deployment.chainId ?? INTEL_CHAIN_ID) !== INTEL_CHAIN_ID) throw Error('Intel deployment must target Robinhood Chain (4663).');
    renderSources();
    provider = options.provider ?? new eth.JsonRpcProvider(deployment.readRpcUrl ?? INTEL_DEFAULT_RPC, INTEL_CHAIN_ID, { staticNetwork: true });
    contracts = options.contracts ?? Object.fromEntries(contractNames().map(name => [name,new eth.Contract(contractAddress(name),deployment[name]?.abi ?? (name==='watchObservations'?INTEL_WATCH_ABI:name==='watchReports'?INTEL_ABIS.reports:name==='universalReader'?INTEL_UNIVERSAL_ABI:INTEL_ABIS[name]),provider)]));
    await verifyDeployment(); [owner, subjectCount, chainBlock] = await Promise.all([contracts.observations.owner(), contracts.observations.subjectCount(), provider.getBlock('latest')]);
    renderSources();
    el('dot').dataset.state = 'verified'; el('network').textContent = 'Robinhood Chain · Live';
    el('subject-count').textContent = subjectCount + ' tracked monitors';
    notice('Paste an address to read its registered analysis. No wallet or gas needed.');
    if (big(subjectCount)>0n && options.autoLoad!==false && !watchDeployment) {controls['subject-id'].value='1';await load();}
    renderExamples();
  }
  async function identity() {
    if (!ethereum?.request || !address || !walletProvider) throw Error('Connect a browser wallet before submitting a transaction.');
    const [accounts, chain] = await Promise.all([ethereum.request({ method: 'eth_accounts' }), ethereum.request({ method: 'eth_chainId' })]);
    if (Number(BigInt(chain)) !== INTEL_CHAIN_ID || !same(accounts?.[0], address)) { quote = null; address = null; chainId = null; throw Error('Wallet account or chain changed. Reconnect and estimate the action again.'); }
  }
  async function connect() {
    const refreshCost = Boolean(quote?.previewOnly && (current||inspection));
    invalidate();
    if (!ethereum?.request) throw Error('Open an Ethereum wallet to connect. Public observation reads do not require a wallet.');
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    let chain = Number(BigInt(await ethereum.request({ method: 'eth_chainId' })));
    if (chain !== INTEL_CHAIN_ID) { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] }); chain = Number(BigInt(await ethereum.request({ method: 'eth_chainId' }))); }
    if (chain !== INTEL_CHAIN_ID || !accounts?.[0]) throw Error('Select Robinhood Chain (4663) and an account in your wallet.');
    walletProvider = new eth.BrowserProvider(ethereum, 'any', { cacheTimeout: -1 }); address = eth.getAddress(accounts[0]); chainId = chain;
    restorePending(); invalidate(); notice(pending ? 'A saved submitted transaction needs reconciliation before another action.' : 'Wallet connected. Calculate the cost before approving this action.');
    if(current?.registry==='watch'){const connectedAddress=address,generation=quoteGeneration;const joined=Boolean(await contracts.watchObservations.isWatching(address,current.id));if(generation!==quoteGeneration||!same(connectedAddress,address))throw Error('The wallet or selected address changed. Connect again.');watchJoined=joined;renderInspection();}
    if (refreshCost && !pending && !recoveryFault) await estimate();
  }
  async function readSubject(id = subjectId(), history = lookback(), registry = current?.registry ?? 'legacy') {
    const observations=contracts[registry==='watch'?'watchObservations':'observations'],reports=contracts[registry==='watch'?'watchReports':'reports'];
    const block = await provider.getBlock('latest'); if (!block) throw Error('The current chain block is unavailable.'); const at = {blockTag:block.number};
    const raw = await observations.subject(id,at);
    const subject = tuple(raw, SUBJECT_FIELDS); if (integer(subject.kind) < 1 || integer(subject.kind) > 3 || !nonzero(subject.target)) throw Error('This subject is not registered.');
    const rawFrame = await observations.features(id, history,at), frame = tuple(rawFrame, FRAME_FIELDS);
    frame.current = tuple(frame.current, SNAPSHOT_FIELDS); frame.previous = tuple(frame.previous, SNAPSHOT_FIELDS);
    const snapshot = frame.current;
    const reportId = big(await reports.latestReport(id,at));
    let report = null, reportText = null;
    if (reportId > 0n) { const [r, text] = await Promise.all([reports.report(reportId,at), reports.render(reportId,at)]); report = tuple(r, REPORT_FIELDS); reportText = String(text); }
    const next = { id, history, registry, subject, snapshot, frame, reportId, report, reportText, block };
    const hash = eth.keccak256(eth.toUtf8Bytes(textJSON({ registry,id, history, subject, sequence: snapshot.sequence, currentHash: frame.currentHash, previousHash: frame.previousHash, flags:frame.flags,status:frame.status,latestReport: reportId })));
    return { next, hash };
  }
  function renderCurrent() {
    el('saved-history').hidden=!current;if(!watchDeployment)el('saved-history').open=true;
    if (!current) { el('subject').hidden = true; el('empty').hidden = false; el('result').hidden = true; el('features').textContent = 'No observations loaded.'; el('report').textContent = 'No on-chain report loaded.'; appendRows(el('report-details'), []); appendRows(el('summary'), []); return; }
    const { subject, snapshot, frame, report, reportId, reportText, block } = current;
    el('subject').hidden = false; el('empty').hidden = true;
    el('result').hidden = false;
    const kind = integer(subject.kind), matchesSnapshot = report && big(report.currentSequence) === big(snapshot.sequence);
    const observedAt = report ? report.observedAt : snapshot.timestamp;
    const storedAge = big(observedAt) > 0n ? Math.max(0, integer(block.timestamp) - integer(observedAt)) : null;
    const upToDate = Boolean(report && matchesSnapshot && frame.fresh && subject.enabled && [0,9].includes(integer(frame.status)));
    el('result-type').textContent = kind === 1 ? 'Token supply' : kind === 2 ? 'Watched token balance' : 'Pool reserves';
    el('result-title').textContent = report ? (integer(report.label) === 0 ? 'Routine observation' : LABELS[integer(report.label)] ?? 'Saved observation') : 'No report yet';
    el('freshness').textContent = !subject.enabled ? 'Monitor disabled' : !report ? 'Ready for a first report' : !upToDate ? 'Saved report · refresh needed' : 'Observed ' + observationAge(storedAge);
    el('freshness').dataset.stale = String(Boolean(report) && !upToDate);
    el('result-summary').textContent = !report ? current.registry==='watch'?'A baseline observation is saved. No comparison report exists yet; a later refresh can compare observations.':'This address is registered. Publish its first observation using Update the report on-chain below.' : big(report.previousSequence) === 0n ? 'One observation is saved. A later on-chain update enables a comparison.' : integer(report.label) === 5 ? 'These stored observations are not comparable. No trend is asserted.' : 'Compared two stored observations over ' + report.elapsedSeconds + ' seconds.';
    const summary = [];
    if (report && big(report.previousSequence) > 0n && !(integer(report.flags) & 8)) {
      const formatted = index => percentBps(report.features[index], Boolean(integer(report.flags) & 16));
      if (kind === 1) summary.push(['Supply change', formatted(0)]);
      if (kind === 2) summary.push(['Watched balance change', formatted(0)]);
      if (kind === 3) summary.push(['Reserve-ratio change', formatted(3)], ['LP-token supply change', formatted(2)]);
    }
    if (storedAge !== null) summary.push(['Last observed', timestamp(observedAt)]);
    if (report) summary.push(['On-chain report', '#' + reportId]);
    appendRows(el('summary'), summary);
    el('subject-name').textContent = `Subject ${current.id} · ${KINDS[integer(subject.kind)]}`;
    const rows = [['Source contract',subject.target],['Pinned source bytecode',subject.codeHash],['Reader status',READ_STATUSES[integer(subject.lastStatus)] ?? 'Unknown'],['Enabled',subject.enabled ? 'Yes' : 'No']];
    if (integer(subject.kind) === 2) rows.push(['Observed account',subject.account]);
    if (integer(subject.kind) === 3) rows.push(['Asset 0',subject.asset0],['Asset 1',subject.asset1]);
    appendRows(el('subject-details'), rows);
    const labels = integer(subject.kind) === 3 ? ['Reserve 0','Reserve 1','LP total supply','Pool timestamp'] : integer(subject.kind) === 2 ? ['Account balance','Token total supply'] : ['Token total supply'];
    const metrics = el('metrics'); metrics.replaceChildren();
    if (big(snapshot.sequence) > 0n) for (let index = 0; index < labels.length; index++) {
      const cell = doc.createElement('div'), label = doc.createElement('span'), value = doc.createElement('strong'), change = doc.createElement('small');
      cell.className = 'intel-metric'; label.className = 'intel-micro'; label.textContent = labels[index]; value.textContent = big(snapshot.values[index]).toLocaleString('en-US');
      change.textContent = frame.hasHistory ? `Δ ${delta(snapshot.values[index], frame.previous.values[index])} raw units` : 'No earlier observation';
      cell.append(label,value,change); metrics.append(cell);
    }
    const age = big(snapshot.sequence) > 0n ? Math.max(0, integer(block.timestamp) - integer(snapshot.timestamp)) : null;
    appendRows(el('snapshot-details'), [['Snapshot sequence',snapshot.sequence],['EVM block counter',big(snapshot.sequence) > 0n ? snapshot.blockNumber : '—'],['Observed at',timestamp(snapshot.timestamp)],['Age at chain head',age === null ? 'No sample' : `${age}s${frame.fresh ? '' : ' · stale'}`,age !== null && !frame.fresh],['EVM BLOCKHASH output (counter − 1)',big(snapshot.sequence) > 0n ? snapshot.parentBlockHash : '—'],['Input status',READ_STATUSES[integer(frame.status)] ?? 'Unknown'],['RPC L2 block at read',block.number]]);
    el('features').textContent = big(snapshot.sequence) === 0n ? 'No confirmed snapshots for this subject.' : textJSON({ currentSequence:frame.current.sequence, previousSequence:frame.hasHistory ? frame.previous.sequence : null, currentObservationDigest:frame.currentHash, previousObservationDigest:frame.hasHistory ? frame.previousHash : null, featureVector:Array.from(frame.vector), elapsedSeconds:frame.elapsedSeconds, history:frame.hasHistory, fresh:frame.fresh, flags:frame.flags, status:READ_STATUSES[integer(frame.status)] ?? 'Unknown' });
    el('report').textContent = report ? reportText : 'No on-chain report exists for this subject.';
    appendRows(el('report-details'), report ? [['Report ID',reportId],['Actual classification',LABELS[integer(report.label)] ?? `Unknown label ${report.label}`],['Report samples',`${report.currentSequence} / ${report.previousSequence}`],['Matches current snapshot',big(report.currentSequence) === big(snapshot.sequence) ? 'Yes' : `No · current sample ${snapshot.sequence}`,big(report.currentSequence) !== big(snapshot.sequence)],['Model ID',report.modelId],['Observed at',timestamp(report.observedAt)],['Previous observation',timestamp(report.previousObservedAt)],['Comparison window',`${report.elapsedSeconds}s`],['Created at',timestamp(report.createdAt)],['EVM counters (sample / report)',`${report.observedBlock} / ${report.createdBlock}`],['Current observation digest',report.currentHash],['Previous observation digest',report.previousHash],['Feature hash',report.featureHash],['Raw model scores',Array.from(report.scores).join(', ')]] : []);
  }
  async function load(registry = current?.registry??'legacy') { invalidate(); const generation=quoteGeneration;const { next, hash } = await readSubject(subjectId(),lookback(),registry);if(generation!==quoteGeneration)throw Error('The selected address or wallet changed. Read this monitor again.');current = next; contextHash = hash; chainBlock = next.block; const input=controls.address.value.trim(); if (!same(input,next.subject.target) && !(integer(next.subject.kind)===2 && same(input,next.subject.account))) controls.address.value=next.subject.target; if (matchedSubjects.length && !matchedSubjects.some(item=>big(item.id)===big(next.id)&&(item.registry??'legacy')===registry)) matchedSubjects=[];watchJoined=Boolean(address&&registry==='watch'&&await contracts.watchObservations.isWatching(address,next.id));renderCurrent();renderInspection();renderMatches();controls.action.value='captureAndAnalyze';notice('Saved on-chain analysis loaded. Reading is free; updating requires a wallet transaction.'); }
  function registerIntent() {
    if (!isOwner()) throw Error('Only the registry owner can register a source.');
    const kind = Number(controls.kind.value), target = controls.target.value.trim(), account = controls.account.value.trim();
    if (![1,2,3].includes(kind) || !eth.isAddress(target) || !nonzero(target)) throw Error('Choose a reader and enter its deployed source address.');
    if (kind === 2 && (!eth.isAddress(account) || !nonzero(account))) throw Error('Enter the observed account address.');
    return { kind, target:eth.getAddress(target), account:kind === 2 ? eth.getAddress(account) : eth.ZeroAddress };
  }
  function observationError(status) {
    if (status === 7) return 'The sampling interval has not passed. Wait a moment, then calculate cost again.';
    if (status === 10) return 'These saved observations are stale. Choose Update on-chain report to save a fresh observation.';
    if (status === 8) return 'No observation is saved yet. Choose Update on-chain report to create one.';
    return `Update unavailable: ${READ_STATUSES[status] ?? 'the contract reader could not validate this observation'}.`;
  }
  function costErrorText(error) {
    let decoded = error?.revert;
    for (const value of [error?.data,error?.info?.error?.data,error?.error?.data]) {
      const data = typeof value === 'string' ? value : value?.data;
      if (!decoded && typeof data === 'string') {for(const name of ['reports','watchReports','watchObservations']){try{decoded=contracts[name]?.interface.parseError(data);if(decoded)break;}catch{}}}
    }
    if (decoded?.name === 'InvalidObservation') return observationError(integer(decoded.args?.status ?? decoded.args?.[0]));
    if (decoded?.name === 'DuplicateReport') return 'This saved observation already has a report. Choose Update on-chain report for a fresh one.';
    if(decoded?.name==='WatchLimit')return 'This wallet already has 64 on-chain watches. Remove a watch before adding another.';
    if(decoded?.name==='InvalidSubject')return 'This source no longer matches its inspected bytecode or supported reader. Analyze the address again.';
    const detail = errorText(error);
    if (error?.code === 'TIMEOUT' || /timeout|timed out/i.test(detail)) return 'The public RPC timed out. Try Calculate gas again.';
    if (/could not coalesce|missing revert data|network error|failed to fetch|rate limit|too many requests/i.test(detail)) return 'The public RPC could not calculate this cost. Try Calculate gas again.';
    return detail;
  }
  async function concreteAction(action, simulationFrom = address) {
    const generation=quoteGeneration;
    const specification = actionSpecification(action);
    if(action==='watch'){
      if(!watchDeployment||!inspection)throw Error('Analyze a supported address before watching it.');
      const refreshed=await inspectAddress(inspection.target,inspection.account),kind=integer(refreshed.preferredKind);
      if(!kind)throw Error('This address has no supported token or pool reader to watch.');
      const account=kind===2?refreshed.account:eth.ZeroAddress,args=[kind,refreshed.target,account,refreshed.codeHash];
      const key=await contracts.watchObservations.subjectKey(...args),existingId=big(await contracts.watchObservations.keyToSubject(key));
      let sequence=0n;
      if(existingId>0n){const subject=tuple(await contracts.watchObservations.subject(existingId),SUBJECT_FIELDS);if(integer(subject.kind)!==kind||!same(subject.target,refreshed.target)||!same(subject.account,account)||!same(subject.codeHash,refreshed.codeHash))throw Error('The shared watch no longer matches this inspected source.');sequence=big(subject.sequence);if(address&&await contracts.watchObservations.isWatching(address,existingId)){const loaded=await readSubject(existingId,lookback(),'watch');if(generation!==quoteGeneration)throw Error('The selected address or wallet changed. Calculate gas again.');current=loaded.next;controls['subject-id'].value=existingId.toString();contextHash=loaded.hash;watchJoined=true;renderCurrent();renderInspection();throw Error('This source is already on your watch list. Choose Refresh saved report for a later comparison.');}}
      const hash=eth.keccak256(eth.toUtf8Bytes(textJSON({chainId:INTEL_CHAIN_ID,contract:contractAddress('watchObservations'),kind,target:refreshed.target,account,codeHash:refreshed.codeHash,existingId,sequence,asset0:kind===3?refreshed.asset0:eth.ZeroAddress,asset1:kind===3?refreshed.asset1:eth.ZeroAddress})));
      if(generation!==quoteGeneration)throw Error('The selected address or wallet changed. Calculate gas again.');
      inspection=refreshed;inspectedText=refreshed.text;renderInspection();
      return {...specification,args,contextHash:hash};
    }
    if (action === 'register') {
      const intent = registerIntent(), code = await provider.getCode(intent.target); if (code === '0x') throw Error('The source address has no deployed bytecode.');
      const expectedCodeHash = eth.keccak256(code), args = [intent.kind,intent.target,intent.account,expectedCodeHash];
      return { ...specification,args,contextHash:eth.keccak256(eth.toUtf8Bytes(textJSON({ ...intent,expectedCodeHash,owner }))) };
    }
    const id = subjectId(), history = lookback(), { next, hash } = await readSubject(id,history);
    if(generation!==quoteGeneration)throw Error('The selected address or wallet changed. Calculate gas again.');
    current = next; contextHash = hash; renderCurrent();
    if (!next.subject.enabled) throw Error('This subject is disabled.');
    const args = action === 'snapshot' ? [id] : [id,history];
    if (action === 'snapshot' || action === 'captureAndAnalyze') {
      const observations=contracts[next.registry==='watch'?'watchObservations':'observations'];
      const spacing = big(await observations.minSpacing());
      if (spacing <= 0n || spacing > 86_400n) throw Error('The contract sampling interval could not be verified.');
      const remaining = big(next.snapshot.timestamp) + spacing - big(next.block.timestamp);
      if (big(next.snapshot.sequence) > 0n && remaining > 0n) throw Error(`Wait ${remaining} seconds before saving another observation, then calculate cost again.`);
      const preview = await observations.snapshot.staticCall(id,{from:simulationFrom});
      const result = integer(preview.status ?? preview[0]); if (result !== 0) throw Error(observationError(result));
    }
    return { ...specification,args,contextHash:hash };
  }
  async function liveFees() { const [block, fee] = await Promise.all([provider.getBlock('latest'),provider.getFeeData()]); const gasPriceWei = big(fee.gasPrice ?? fee.maxFeePerGas); if (!block || gasPriceWei <= 0n) throw Error('Current fee data is unavailable.'); return { block,gasPriceWei }; }
  async function estimate() {
    const generation = ++quoteGeneration;
    quote = null; controls.consent.checked = false; costStatus = 'Calculating the current network cost…'; costError = false; calculating = true; render();
    try {
      noPending();
      const walletAddress = address, previewOnly = !walletAddress;
      if (!previewOnly) await identity();
      const action = actionName();
      if (action === 'register' && previewOnly) throw Error('Connect the registry owner wallet to calculate a registration.');
      await verifyDeployment();
      const simulationFrom = previewOnly ? PREVIEW_FROM : walletAddress;
      const concrete = await concreteAction(action,simulationFrom), contract = contracts[concrete.contract];
      const [gasEstimate, fees] = await Promise.all([contract.getFunction(concrete.method).estimateGas(...concrete.args,{from:simulationFrom}),liveFees()]);
      const gasLimit = (big(gasEstimate)*12000n+9999n)/10000n;
      if (gasLimit > big(fees.block.gasLimit) || gasLimit > 31_000_000n) throw Error('This action exceeds the supported single-transaction gas limit.');
      const feeCeilingWei = (fees.gasPriceWei*3n+1n)/2n;
      const submissionGasPriceWei = intelSubmissionGasPrice(fees.gasPriceWei,feeCeilingWei);
      const data = contract.interface.encodeFunctionData(concrete.method,concrete.args), to = contractAddress(concrete.contract);
      if (!previewOnly) await identity();
      if (generation !== quoteGeneration || action !== actionName() || !previewOnly && !same(walletAddress,address) || previewOnly && address) throw Error('The selected action or wallet changed. Calculate gas again.');
      contextHash = concrete.contextHash;
      quote = {kind:previewOnly?'preview':'wallet',preview:previewOnly,previewOnly,readOnly:previewOnly,simulationFrom,action,method:concrete.method,args:concrete.args,contract:concrete.contract,to,data,contextHash,owner:previewOnly?null:walletAddress,chainId:INTEL_CHAIN_ID,gasEstimate:big(gasEstimate),gasLimit,gasPriceWei:fees.gasPriceWei,submissionGasPriceWei,feeCeilingWei,estimatedWei:big(gasEstimate)*submissionGasPriceWei,reserveWei:gasLimit*feeCeilingWei,expiresAt:now()+45_000,blockNumber:fees.block.number};
      controls.limit.value = formatIntelETH(quote.reserveWei);
      costStatus = previewOnly ? 'Cost preview only. Connect your wallet to refresh the estimate before approving an update.' : 'Wallet estimate ready. Review the maximum fee below, then confirm in your wallet.';
      notice(costStatus);
    } catch (error) {
      quote = null; controls.consent.checked = false; costStatus = costErrorText(error); costError = true;
      throw Error(costStatus);
    } finally { calculating = false; render(); }
  }
  async function settle(hash) {
    if (!pending || !/^0x[0-9a-fA-F]{64}$/.test(hash) || pending.hash && !same(hash,pending.hash)) throw Error('Use the exact submitted transaction hash from your wallet.');
    const [transaction, receipt] = await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
    if (!transaction) throw Error('The transaction is not visible yet. The saved wallet intent remains unresolved.');
    if(transaction.hash&&!same(transaction.hash,hash) || receipt?.hash&&!same(receipt.hash,hash) || receipt?.transactionHash&&!same(receipt.transactionHash,hash)) throw Error('The RPC returned a different transaction or receipt hash. Recovery remains unresolved.');
    const specification = {...ACTIONS[pending.action],contract:pending.contract??ACTIONS[pending.action].contract};
    if(!allowedActionContract(pending.action,specification.contract))throw Error('The saved action has an unsupported contract destination.');
    const selector = contracts[specification.contract].interface.getFunction(specification.method).selector;
    if (!same(transaction.from,pending.owner) || !same(transaction.to,contractAddress(specification.contract)) || !same(transaction.to,pending.to) || !same(eth.keccak256(transaction.data),pending.dataHash) || !same(transaction.data.slice(0,10),selector) || big(transaction.value) !== 0n || Number(transaction.nonce) !== pending.nonce || integer(transaction.chainId) !== INTEL_CHAIN_ID || integer(pending.chainId) !== INTEL_CHAIN_ID) throw Error('The confirmed transaction does not match the saved wallet action.');
    if (!pending.hash) {pending.hash=hash;savePending(true);}
    if (!receipt) throw Error('The transaction is not confirmed yet. Its saved hash remains unresolved.');
    const canonical = await provider.getBlock(receipt.blockNumber); if (!same(canonical?.hash,receipt.blockHash)) throw Error('Transaction receipt is not on the current canonical chain.');
    const price = big(receipt.gasPrice ?? receipt.effectiveGasPrice ?? transaction.gasPrice), spent = big(receipt.gasUsed)*price;
    if(price<=0n || big(receipt.gasUsed)<=0n) throw Error('Confirmed receipt fee data is unavailable. Recovery remains unresolved.');
    let outcome = Number(receipt.status) === 1 ? 'Confirmed' : 'Reverted', resultRejected = false,addedWatchId=0n;
    for (const log of receipt.logs ?? []) {
      const source = ['observations','reports',...(watchDeployment?['watchObservations','watchReports']:[])].find(name=>same(log.address,contractAddress(name)));
      if (!source) continue;
      let event; try {event=contracts[source].interface.parseLog(log);} catch {continue;}
      if (event?.name === 'SnapshotRejected') {outcome=`Reader rejected: ${READ_STATUSES[integer(event.args.status ?? event.args[1])] ?? 'unknown status'}`;resultRejected=true;}
      if (event?.name === 'SnapshotStored') outcome=`Snapshot ${event.args.sequence ?? event.args[1]} stored`;
      if (event?.name === 'ReportPublished') outcome=`Report ${event.args.reportId ?? event.args[0]} published`;
      if (event?.name === 'SubjectRegistered') outcome=`Subject ${event.args.subjectId ?? event.args[0]} registered`;
      if(event?.name==='WatchAdded'&&same(event.args.watcher??event.args[0],pending.owner)){addedWatchId=big(event.args.subjectId??event.args[1]);outcome=`Watching source ${addedWatchId}`;}
    }
    receipts.push({hash,action:pending.action,status:Number(receipt.status),outcome,gasUsed:big(receipt.gasUsed),spentWei:spent});
    const cap = big(pending.budgetWei), settledOwner = pending.owner, reserveExceeded = spent > cap || price > big(pending.feeCeilingWei) || big(transaction.gasLimit) > big(pending.gasLimit);
    pending = null; savePending(false,settledOwner); quote = null; controls.consent.checked = false;
    const list = el('receipts'); list.replaceChildren();
    for (const item of receipts.slice(-20)) { const row = doc.createElement('li'), hashNode = doc.createElement('code'); row.textContent = `${ACTIONS[item.action]?.label ?? item.action} · ${item.outcome} · ${formatIntelETH(item.spentWei)} ETH`; hashNode.textContent=item.hash;row.append(hashNode);list.append(row); }
    el('receipt-count').textContent = `· ${receipts.length} confirmed`;
    if(addedWatchId>0n){controls['subject-id'].value=addedWatchId.toString();const {next,hash:context}=await readSubject(addedWatchId,lookback(),'watch');current=next;contextHash=context;controls.action.value='captureAndAnalyze';watchJoined=true;}
    else if (current) { const { next, hash:context } = await readSubject(current.id,current.history,current.registry);current=next;contextHash=context; }
    if(inspection){inspection=await inspectAddress(inspection.target,inspection.account);inspectedText=inspection.text;}
    renderCurrent();renderInspection();
    [subjectCount,owner]=await Promise.all([contracts.observations.subjectCount(),contracts.observations.owner()]);el('subject-count').textContent=`${subjectCount} registered subject${subjectCount===1n?'':'s'}`;
    notice(reserveExceeded ? 'The wallet transaction exceeded the app’s approved fee reserve. Actual confirmed fees are shown in the transaction record.' : resultRejected ? `${outcome}. No new snapshot was stored; network gas was still paid.` : Number(receipt.status) === 1 ? `${outcome}. The evidence view shows stored on-chain state.` : 'Transaction reverted. Network gas was still paid.', reserveExceeded || resultRejected || Number(receipt.status) !== 1);
  }
  async function send() {
    if (!reviewed()) throw Error('Review a fresh action estimate and fee limit before submitting.');
    const accepted = quote, budgetWei = parseIntelBudget(controls.limit.value);
    await identity(); await verifyDeployment();
    const concrete = await concreteAction(accepted.action);
    if (concrete.contextHash !== accepted.contextHash) { invalidate(); throw Error('Subject state changed after the estimate. Read and estimate the action again.'); }
    const [newGas, fees, balance] = await Promise.all([contracts[accepted.contract].getFunction(accepted.method).estimateGas(...accepted.args,{from:address}),liveFees(),walletProvider.getBalance(address)]);
    if (now() >= accepted.expiresAt || fees.gasPriceWei > accepted.feeCeilingWei || (big(newGas)*12000n+9999n)/10000n > accepted.gasLimit) { invalidate(); throw Error('Gas or fees changed. Estimate this action again before sending.'); }
    const submissionGasPriceWei = intelSubmissionGasPrice(fees.gasPriceWei,accepted.feeCeilingWei);
    if(submissionGasPriceWei>accepted.feeCeilingWei || accepted.gasLimit*submissionGasPriceWei>budgetWei)throw Error('The submission gas-price headroom exceeds the accepted fee reserve.');
    if (accepted.gasLimit > big(fees.block.gasLimit) || accepted.gasLimit*accepted.feeCeilingWei > budgetWei || big(balance) < accepted.reserveWei) throw Error('The wallet balance, block limit or accepted fee limit does not cover this action’s reserve.');
    const signer = await walletProvider.getSigner(address);
    notice('Confirm this single action in your wallet. No other transaction is queued.');
    const nonce = Number(BigInt(await ethereum.request({method:'eth_getTransactionCount',params:[address,'pending']})));
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw Error('The wallet returned an invalid pending nonce.');
    await identity();
    if(now()>=accepted.expiresAt){invalidate();throw Error('The action estimate expired while preparing the wallet request. Estimate it again.');}
    pending = {hash:null,owner:address,chainId:INTEL_CHAIN_ID,to:accepted.to,contract:accepted.contract,dataHash:eth.keccak256(accepted.data),nonce,action:accepted.action,gasLimit:accepted.gasLimit.toString(),gasPriceWei:submissionGasPriceWei.toString(),feeCeilingWei:accepted.feeCeilingWei.toString(),budgetWei:budgetWei.toString()};
    try {savePending(true);} catch(error) {pending=null;throw Error(`No wallet transaction was requested. ${errorText(error)}`);}
    render();
    let transaction;
    try { transaction = await signer.sendTransaction({to:accepted.to,data:accepted.data,value:0n,gasLimit:accepted.gasLimit,gasPrice:submissionGasPriceWei,chainId:INTEL_CHAIN_ID,nonce}); }
    catch (error) { quote=null;controls.consent.checked=false;if (error?.code===4001 || error?.info?.error?.code===4001 || error?.error?.code===4001) {const rejectedOwner=pending.owner;pending=null;savePending(false,rejectedOwner);throw error;} throw Error(`Wallet submission is unresolved. Check your wallet for its exact transaction hash before another action. ${errorText(error)}`); }
    pending.hash=transaction.hash;quote=null;controls.consent.checked=false;savePending(true);render();
    notice(`Transaction submitted: ${transaction.hash}. Waiting for a confirmed receipt.`);
    try { await transaction.wait(1,120_000); } catch (error) { if (!error.receipt) { notice('Transaction confirmation is unresolved. Check the saved transaction hash before another action.',true); return; } }
    await settle(transaction.hash);
  }
  function listen(node,type,fn) { if (!node?.addEventListener) return; node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn)); }
  listen(controls.search,'click',()=>operation(()=>analyzeAddress()));
  listen(controls.address,'keydown',event=>{if(event.key==='Enter'){event.preventDefault();return operation(()=>analyzeAddress());}});
  listen(controls.address,'input',()=>{clearSelection();notice('Choose Analyze to read this address on-chain.');});
  listen(controls['inspect-account'],'input',()=>{clearSelection();notice('Choose Analyze again to read the selected token balance.');});
  listen(controls.watch,'click',()=>{controls.action.value=watchJoined&&current?.registry==='watch'?'captureAndAnalyze':'watch';contextHash='';invalidate();el('update').open=true;notice(controls.action.value==='watch'?'Watch selected. Calculate gas before connecting or approving.':'Refresh selected. Calculate gas before approving a new report.');});
  listen(controls['raw-read'],'click',()=>operation(()=>rawRead()));
  listen(controls.connect,'click',()=>operation(connect)); listen(controls.load,'click',()=>operation(load)); listen(controls.estimate,'click',()=>operation(estimate)); listen(controls.send,'click',()=>operation(send));
  for (const control of [controls['subject-id'],controls.lookback]) listen(control,'input',()=>{current=null;contextHash='';invalidate();renderCurrent();el('features').textContent='No confirmed snapshots loaded.';el('report').textContent='No on-chain report loaded.';appendRows(el('report-details'),[]);});
  listen(controls.action,'change',invalidate); listen(controls.limit,'input',()=>{controls.consent.checked=false;render();});listen(controls.consent,'change',render);
  for (const control of [controls.kind,controls.target,controls.account]) listen(control,'input',()=>{contextHash='';invalidate();});
  listen(controls['register-prepare'],'click',()=>{controls.action.value='register';el('update').open=true;invalidate();notice('Registration selected. Estimate its exact source address and bytecode pin before approval.');});
  listen(controls.reconcile,'click',()=>operation(()=>settle(controls['recovery-hash'].value.trim())));
  const changed = () => { address=null;chainId=null;watchJoined=false;invalidate();renderInspection();notice('Wallet account or chain changed. Reconnect and estimate again.');render(); };
  if (ethereum?.on) { ethereum.on('accountsChanged',changed);ethereum.on('chainChanged',changed);listeners.push(()=>ethereum.removeListener?.('accountsChanged',changed),()=>ethereum.removeListener?.('chainChanged',changed)); }
  const ready = operation(initialize);
  timer = (options.setInterval ?? globalThis.setInterval)(()=>{if(quote)render();},1000);
  return {ready,analyze:value=>operation(()=>analyzeAddress(value)),read:data=>operation(()=>rawRead(data)),load:()=>operation(load),estimate:()=>operation(estimate),connect:()=>operation(connect),send:()=>operation(send),reconcile:hash=>operation(()=>settle(hash)),get state(){return{verified,address,chainId,subjectCount,current,inspection:inspection?{...inspection}:null,watchJoined,matches:matchedSubjects.map(item=>({id:item.id,registry:item.registry??'legacy',...item.subject})),quote:quote?{...quote}:null,pending:pending?{...pending}:null,recoveryFault,busy};},destroy(){destroyed=true;(options.clearInterval??globalThis.clearInterval)(timer);listeners.forEach(remove=>remove());if(!options.provider)provider?.destroy?.();walletProvider?.destroy?.();root.removeAttribute('data-s0ul-intel-mounted');}};
}

export async function loadS0ULIntelDeployment(root, {fetch:fetcher=globalThis.fetch} = {}) {
  const doc=root.ownerDocument, inline=doc.getElementById('s0ul-intel-config');
  if(inline)return JSON.parse(inline.textContent||'null');
  const source=root.dataset.deploymentSrc??'/s0ul-intel-deployment.json';
  const origin=doc.defaultView?.location?.origin??globalThis.location?.origin;
  if(!origin||!fetcher)return null;
  const url=new URL(source,origin);if(url.origin!==origin)throw Error('Intel deployment configuration must be served by this site.');
  const response=await fetcher(url.href,{cache:'no-store'});
  if(response.status===404)return null;
  if(!response.ok)throw Error('The Intel deployment configuration is unavailable.');
  return response.json();
}

export async function loadS0ULIntelWatchDeployment(root,{fetch:fetcher=globalThis.fetch}={}) {
  const doc=root.ownerDocument,inline=doc.getElementById('s0ul-intel-v2-config');
  if(inline)return JSON.parse(inline.textContent||'null');
  const origin=doc.defaultView?.location?.origin??globalThis.location?.origin;if(!origin||!fetcher)return null;
  const url=new URL(root.dataset.watchDeploymentSrc??'/s0ul-intel-v2-deployment.json',origin);
  if(url.origin!==origin)throw Error('Watch deployment configuration must be served by this site.');
  const response=await fetcher(url.href,{cache:'no-store'});if(response.status===404)return null;
  if(!response.ok)throw Error('The watch deployment configuration is unavailable.');
  return response.json();
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('s0ul-intel-root');
  if (root) {
    Promise.all([loadS0ULIntelDeployment(root),loadS0ULIntelWatchDeployment(root)]).then(([deployment,watchDeployment])=>mountS0ULIntel(root,{deployment,watchDeployment})).catch(()=>mountS0ULIntel(root,{deployment:null}));
  }
}
