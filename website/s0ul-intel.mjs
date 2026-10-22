import * as Ethers from './mint/vendor/ethers.js';

export const INTEL_CHAIN_ID = 4663;
export const INTEL_DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const SUBJECT = '(uint8 kind,bool enabled,address target,address account,bytes32 codeHash,address asset0,address asset1,uint64 sequence,uint8 lastStatus)';
const SNAPSHOT = '(uint64 sequence,uint64 timestamp,uint64 blockNumber,bytes32 parentBlockHash,uint128[4] values)';
const FRAME = `(uint256 subjectId,uint8 kind,${SNAPSHOT} current,${SNAPSHOT} previous,bytes32 currentHash,bytes32 previousHash,int32[8] vector,uint32 elapsedSeconds,uint8 flags,bool hasHistory,bool fresh,uint8 status)`;
const REPORT = '(uint256 subjectId,uint64 currentSequence,uint64 previousSequence,uint64 observedBlock,uint64 createdBlock,uint64 createdAt,bytes32 currentHash,bytes32 previousHash,bytes32 featureHash,bytes32 modelId,uint8 label,int32[8] features,int256[6] scores,uint128[4] currentValues,uint128[4] previousValues,uint8 flags,uint64 observedAt,uint64 previousObservedAt,uint32 elapsedSeconds)';
export const INTEL_ABIS = Object.freeze({
  observations: ['function owner() view returns(address)','function subjectCount() view returns(uint256)',`function subject(uint256) view returns(${SUBJECT})`,`function latest(uint256) view returns(${SNAPSHOT})`,`function sampleAt(uint256,uint64) view returns(${SNAPSHOT})`,`function features(uint256,uint8) view returns(${FRAME})`,'function snapshotHash(uint256,uint64) view returns(bytes32)','function snapshot(uint256) returns(uint8 status,uint64 sequence)','function registerSubject(uint8,address,address,bytes32) returns(uint256)','event SnapshotStored(uint256 indexed subjectId,uint64 indexed sequence,bytes32 indexed snapshotHash,uint64 timestamp,uint64 blockNumber,uint128[4] values)','event SnapshotRejected(uint256 indexed subjectId,uint8 status,uint64 currentSequence)','event SubjectRegistered(uint256 indexed subjectId,uint8 kind,address indexed target,address account,bytes32 codeHash,address asset0,address asset1)'],
  reports: ['function observations() view returns(address)','function classifier() view returns(address)','function observationsCodeHash() view returns(bytes32)','function classifierCodeHash() view returns(bytes32)','function modelId() view returns(bytes32)','function trainingManifestHash() view returns(bytes32)','function chainId() view returns(uint256)','function reportCount() view returns(uint256)','function latestReport(uint256) view returns(uint256)',`function report(uint256) view returns(${REPORT})`,'function render(uint256) view returns(string)','function analyze(uint256,uint8) returns(uint256)','function captureAndAnalyze(uint256,uint8) returns(uint256)','event ReportPublished(uint256 indexed reportId,uint256 indexed subjectId,uint64 indexed sequence,uint8 label,bytes32 featureHash,bytes32 modelId)'],
  classifier: ['function modelId() view returns(bytes32)','function trainingManifestHash() view returns(bytes32)'],
});
const READ_STATUSES = ['OK','Disabled','Target code changed','Contract read failed','Malformed contract data','Value out of range','Asset metadata changed','Sampling interval not reached','No samples','No earlier sample','Stale observations'];
const KINDS = ['Unknown','ERC-20 supply','ERC-20 account balance','V2 pool'];
const LABELS = ['Normal observation','Supply observation','Watched balance observation','LP-token supply observation','Reserve-ratio observation','Insufficient comparable history'];
const ACTIONS = Object.freeze({ snapshot: { label: 'Take a snapshot', contract: 'observations', method: 'snapshot' }, analyze: { label: 'Analyze saved snapshots', contract: 'reports', method: 'analyze' }, captureAndAnalyze: { label: 'Sample + publish report', contract: 'reports', method: 'captureAndAnalyze' }, register: { label: 'Register a subject', contract: 'observations', method: 'registerSubject' } });
const SUBJECT_FIELDS = ['kind','enabled','target','account','codeHash','asset0','asset1','sequence','lastStatus'];
const SNAPSHOT_FIELDS = ['sequence','timestamp','blockNumber','parentBlockHash','values'];
const FRAME_FIELDS = ['subjectId','kind','current','previous','currentHash','previousHash','vector','elapsedSeconds','flags','hasHistory','fresh','status'];
const REPORT_FIELDS = ['subjectId','currentSequence','previousSequence','observedBlock','createdBlock','createdAt','currentHash','previousHash','featureHash','modelId','label','features','scores','currentValues','previousValues','flags','observedAt','previousObservedAt','elapsedSeconds'];
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
  return Boolean(quote && same(quote.owner, address) && integer(chainId) === INTEL_CHAIN_ID && integer(quote.chainId) === INTEL_CHAIN_ID && quote.action === action && quote.contextHash === contextHash && Number.isFinite(quote.expiresAt) && quote.expiresAt > now);
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
  root.innerHTML = `
    <section class="intel-shell" aria-labelledby="intel-title">
      <div class="intel-heading"><div><div class="intel-kicker">S0UL / On-chain intelligence</div><h2 id="intel-title">What does the<br><em>chain say?</em></h2></div><p>Paste an address to read its saved on-chain observations. No wallet needed.</p></div>
      <div class="intel-topbar"><div class="intel-network"><span id="intel-dot" class="intel-dot" data-state="waiting" aria-hidden="true"></span><span id="intel-network">Connecting to Robinhood Chain…</span></div><span id="intel-subject-count" class="intel-tag">Loading monitors</span></div>
      <div class="intel-search"><label class="intel-field" for="intel-address">Token, pool or watched wallet address</label><div class="intel-address-row"><input id="intel-address" spellcheck="false" autocomplete="off" placeholder="Paste a Robinhood Chain address · 0x…" aria-describedby="intel-scope" disabled><button id="intel-search" class="intel-button intel-button-primary" type="button" disabled>Analyze address <span aria-hidden="true">↗</span></button></div><div id="intel-examples" class="intel-examples" aria-label="Try a tracked address"></div><p id="intel-scope" class="intel-small">Available for registered token and pool monitors. This reads on-chain observations; it is not a contract security audit.</p></div>
      <div id="intel-notice" class="intel-notice" role="status" aria-live="polite">Connecting to the on-chain registry…</div>
      <div id="intel-matches" class="intel-examples intel-matches" aria-label="Available analysis" hidden></div>
      <section id="intel-result" class="intel-results" aria-labelledby="intel-result-title" hidden>
        <div class="intel-panel-head"><div><span id="intel-result-type" class="intel-kicker"></span><h3 id="intel-result-title">Saved observation</h3></div><span id="intel-freshness" class="intel-tag"></span></div>
        <p id="intel-result-summary" class="intel-result-summary"></p><dl id="intel-summary" class="intel-summary"></dl>
        <details class="intel-disclosure intel-stored-report"><summary>Read the full on-chain report</summary><pre id="intel-report">No on-chain report loaded.</pre><p class="intel-small">This text is read directly from the report contract. Its block counter differs from the Robinhood transaction block number.</p></details>
      </section>
      <details id="intel-update" class="intel-disclosure intel-update"><summary>Update the report on-chain <span>Wallet + gas</span></summary><div class="intel-transact" aria-labelledby="intel-fee-title"><div class="intel-panel-head"><h3 id="intel-fee-title">Review the cost.</h3><button id="intel-connect" class="intel-button" type="button" disabled>Connect wallet ↗</button></div><p class="intel-small">Save a new observation and publish its comparison in one transaction. Reading an existing report is free.</p>
        <details class="intel-disclosure intel-action-options"><summary>Other actions</summary><label class="intel-field">Action<select id="intel-action" disabled><option value="captureAndAnalyze">Update on-chain report</option><option value="snapshot">Save observation only</option><option value="analyze">Analyze stored observations</option><option id="intel-register-option" value="register" hidden>Register a monitor</option></select></label></details>
        <button id="intel-estimate" class="intel-button" type="button" disabled>Calculate gas cost ↗</button>
        <div class="intel-fee"><span class="intel-micro">Estimated network fee</span><strong id="intel-fee">—</strong><div class="intel-panel-head"><span id="intel-quote-expiry" class="intel-tag">Calculate the cost first</span><span class="intel-small">No transaction sent</span></div><details class="intel-disclosure"><summary>Fee breakdown</summary><dl class="intel-dl"><div><dt>Gas estimate</dt><dd id="intel-gas">—</dd></div><div><dt>Gas reserve (+20%)</dt><dd id="intel-gas-limit">—</dd></div><div><dt>Current gas / ceiling</dt><dd id="intel-gas-price">—</dd></div><div><dt>Submission (+10%, capped)</dt><dd id="intel-submission-price">—</dd></div><div><dt>Maximum fee reserve</dt><dd id="intel-reserve">—</dd></div></dl></details></div>
        <label class="intel-field">Maximum fee you approve (ETH)<input id="intel-limit" inputmode="decimal" autocomplete="off" placeholder="Calculate the cost first" disabled></label><label class="intel-consent"><input id="intel-consent" type="checkbox" disabled><span>I reviewed this transaction and its maximum fee.</span></label><button id="intel-send" class="intel-button intel-button-primary" type="button" disabled>Confirm in wallet <span aria-hidden="true">→</span></button><p class="intel-small">Your wallet confirms every write. The estimate includes bounded fee headroom; the app checks your limit again before sending. Network gas is paid even if a transaction reverts.</p>
      </div></details>
      <div id="intel-recovery" class="intel-recovery" hidden><p>A wallet transaction is unresolved. Check its exact hash before another action.</p><div class="intel-form-row"><label class="intel-field">Transaction hash<input id="intel-recovery-hash" spellcheck="false" autocomplete="off" placeholder="0x…"></label><button id="intel-reconcile" class="intel-button" type="button">Check transaction ↗</button></div></div>
      <details id="intel-technical" class="intel-disclosure intel-technical"><summary>Technical details <span>Sources, observations &amp; model</span></summary>
        <div id="intel-sources" class="intel-sources" hidden></div>
        <div class="intel-form-row intel-subject-row"><label class="intel-field">Monitor ID<input id="intel-subject-id" inputmode="numeric" value="1" autocomplete="off" disabled></label><label class="intel-field">Compare with<select id="intel-lookback" disabled><option value="1">Previous observation</option><option value="2">2 observations back</option><option value="3">3 observations back</option><option value="4">4 observations back</option><option value="5">5 observations back</option><option value="6">6 observations back</option><option value="7">7 observations back</option><option value="8">8 observations back</option><option value="9">9 observations back</option><option value="10">10 observations back</option><option value="11">11 observations back</option><option value="12">12 observations back</option><option value="13">13 observations back</option><option value="14">14 observations back</option><option value="15">15 observations back</option></select></label><button id="intel-load" class="intel-button" type="button" disabled>Read monitor ↗</button></div>
        <p id="intel-empty" class="intel-empty">No monitor selected.</p><div id="intel-subject" hidden><h4 id="intel-subject-name" class="intel-subject-name"></h4><dl id="intel-subject-details" class="intel-dl"></dl><div id="intel-metrics" class="intel-metrics"></div><dl id="intel-snapshot-details" class="intel-dl"></dl></div>
        <div class="intel-evidence"><h3>Stored model evidence</h3><pre id="intel-features">No observations loaded.</pre><dl id="intel-report-details" class="intel-dl"></dl></div><p class="intel-small">A separate 25-parameter numeric classifier routes observations using a synthetic 2.5% policy. These are observations, not forecasts or safety verdicts. The original S0UL-1M agent is available below.</p><p class="intel-footnote">Raw token units and reserve ratios are not USD prices or volume. EVM counters estimate ancestor-chain height. EVM BLOCKHASH output is not a canonical parent hash or finality proof.</p>
        <details id="intel-registration" class="intel-registration" hidden><summary>Registry owner · Add a compatible monitor</summary><div class="intel-register-fields"><label class="intel-field">Reader<select id="intel-kind"><option value="3">V2 pool</option><option value="1">ERC-20 total supply</option><option value="2">ERC-20 account balance</option></select></label><label class="intel-field">Source contract<input id="intel-target" spellcheck="false" autocomplete="off" placeholder="0x…"></label><label class="intel-field" id="intel-account-field" hidden>Watched account<input id="intel-account" spellcheck="false" autocomplete="off" placeholder="0x…"></label></div><p class="intel-small">Only the registry owner can add a reader. Registration pins source bytecode; it does not establish contract safety.</p><button id="intel-register-prepare" class="intel-button" type="button">Review registration ↗</button></details>
        <details class="intel-history"><summary>Transaction record <span id="intel-receipt-count">· 0 confirmed</span></summary><ol id="intel-receipts"></ol></details>
      </details>
    </section>`;
  const el = id => root.querySelector(`#intel-${id}`);
  const controls = Object.fromEntries(['address','search','connect','subject-id','lookback','load','action','estimate','limit','consent','send','kind','target','account','register-prepare','recovery-hash','reconcile'].map(id => [id, el(id)]));
  let provider = null, walletProvider = null, contracts = null, current = null, quote = null, pending = null;
  let destroyed = false, busy = false, verified = false, address = null, chainId = null, owner = null, subjectCount = 0n, chainBlock = null;
  let contextHash = '', message = '', hasError = false, receipts = [], timer = null, modelIdentity = null, recoveryFault = '';
  const ethereum = options.ethereum ?? win?.ethereum;
  const storage = options.storage ?? (() => { try { return win?.localStorage; } catch { return null; } })();
  const listeners = [];
  let matchedSubjects = [], exampleButtons = [], matchButtons = [];

  function notice(text, error = false) { message = text; hasError = error; renderNotice(); }
  function renderNotice() { const node = el('notice'); if (node.textContent !== message) node.textContent = message; node.dataset.error = String(hasError); }
  function invalidate() { quote = null; controls.consent.checked = false; render(); }
  function subjectId() { const raw = controls['subject-id'].value.trim(); if (!/^[1-9]\d*$/.test(raw)) throw Error('Enter a positive registered subject ID.'); return BigInt(raw); }
  function lookback() { const value = Number(controls.lookback.value); if (!Number.isInteger(value) || value < 1 || value > 15) throw Error('Choose a lookback from 1 to 15 samples.'); return value; }
  function actionName() { const action = controls.action.value; if (!Object.hasOwn(ACTIONS, action)) throw Error('Choose a supported action.'); return action; }
  function isOwner() { return same(address, owner); }
  function freshQuote() { return intelQuoteMatches(quote, { address, chainId, action: controls.action.value, contextHash, now: now() }); }
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
      if (!record || !same(record.owner,address) || integer(record.chainId)!==INTEL_CHAIN_ID || !Object.hasOwn(ACTIONS,record.action) || !same(record.to,contractAddress(ACTIONS[record.action].contract)) || record.hash!==null&&!/^0x[0-9a-fA-F]{64}$/.test(record.hash) || !/^0x[0-9a-fA-F]{64}$/.test(record.dataHash??'') || !Number.isSafeInteger(record.nonce) || record.nonce<0 || big(record.gasLimit)<=0n || big(record.feeCeilingWei)<=0n || big(record.budgetWei)<=0n) throw Error('Invalid saved transaction identity.');
      pending=record;
    } catch(error) {recoveryFault=`Saved transaction recovery data is unreadable. Wallet writes remain disabled until that record is recovered. ${errorText(error)}`;throw Error(recoveryFault);}
  }
  function appendRows(node, rows) { node.replaceChildren(); for (const [label, value, stale] of rows) { const row = doc.createElement('div'), dt = doc.createElement('dt'), dd = doc.createElement('dd'); dt.textContent = label; dd.textContent = String(value); if (stale) dd.dataset.stale = 'true'; row.append(dt, dd); node.append(row); } }
  function render() {
    if (destroyed) return;
    const active = Boolean(deployment), connected = Boolean(address && chainId === INTEL_CHAIN_ID), writable = verified && connected && !busy && !pending && !recoveryFault;
    controls.connect.disabled = !active || busy; controls.connect.textContent = address ? `${short(address)} ↗` : 'Connect wallet ↗';
    controls.address.disabled = !verified || busy; controls.search.disabled = !verified || busy;
    controls.search.textContent = busy ? 'Reading the chain…' : 'Analyze address ↗';
    for (const button of [...exampleButtons, ...matchButtons]) button.disabled = !verified || busy;
    for (const control of [controls['subject-id'],controls.lookback,controls.load]) control.disabled = !verified || busy;
    for (const control of [controls.action,controls.kind,controls.target,controls.account,controls['register-prepare']]) control.disabled = !verified || busy || Boolean(pending);
    controls.estimate.disabled = !writable || (controls.action.value === 'register' ? !isOwner() : !current);
    controls.limit.disabled = !freshQuote() || busy; controls.consent.disabled = !freshQuote() || busy;
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
      el('quote-expiry').textContent = freshQuote() ? `Expires in ${Math.max(0, Math.ceil((quote.expiresAt - now()) / 1000))}s` : 'Estimate expired';
    } else { for (const id of ['fee','gas','gas-limit','gas-price','submission-price','reserve']) el(id).textContent = '—'; el('quote-expiry').textContent = 'No estimate'; }
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
    await Promise.all(['observations','reports','classifier'].map(async name => {
      const item = deployment[name];
      if (!eth.isAddress(item?.address) || !/^0x[0-9a-fA-F]{64}$/.test(item?.codeHash ?? '') || !nonzero(item.codeHash)) throw Error(`A deployed ${name} address and pinned bytecode hash are required.`);
      const code = await provider.getCode(item.address); if (code === '0x' || !same(eth.keccak256(code), item.codeHash)) throw Error(`The pinned ${name} bytecode does not match this chain.`);
    }));
    const [observationsAddress,classifierAddress,observationHash,classifierHash,reportModelId,reportManifest,reportChain,modelId,manifest] = await Promise.all([contracts.reports.observations(),contracts.reports.classifier(),contracts.reports.observationsCodeHash(),contracts.reports.classifierCodeHash(),contracts.reports.modelId(),contracts.reports.trainingManifestHash(),contracts.reports.chainId(),contracts.classifier.modelId(),contracts.classifier.trainingManifestHash()]);
    if (!same(observationsAddress,contractAddress('observations')) || !same(classifierAddress,contractAddress('classifier')) || !same(observationHash,deployment.observations.codeHash) || !same(classifierHash,deployment.classifier.codeHash) || !same(reportModelId,modelId) || !same(reportManifest,manifest) || integer(reportChain) !== INTEL_CHAIN_ID) throw Error('The report contract dependencies do not match the pinned deployment.');
    if (deployment.classifier.modelId && !same(modelId,deployment.classifier.modelId) || deployment.classifier.trainingManifestHash && !same(manifest,deployment.classifier.trainingManifestHash)) throw Error('The numeric model identity differs from the configured pin.');
    modelIdentity = {modelId,trainingManifestHash:manifest};
    verified = true;
  }
  function renderSources() {
    const node = el('sources'); node.replaceChildren(); node.hidden = !deployment;
    for (const name of ['observations','reports','classifier']) {
      const item = deployment[name], cell = doc.createElement('div'), label = doc.createElement('span'), addressNode = doc.createElement('code'), hash = doc.createElement('small');
      cell.className = 'intel-source'; label.textContent = name === 'classifier' ? 'Numeric model head' : name;
      addressNode.textContent = item?.address ?? 'Awaiting deployment'; hash.textContent = `Pinned code: ${item?.codeHash ?? 'unavailable'}${name === 'classifier' && modelIdentity ? ` · Model ${modelIdentity.modelId} · Training manifest ${modelIdentity.trainingManifestHash}` : ''}`;
      cell.append(label, addressNode, hash); node.append(cell);
    }
  }
  function clearSelection() {
    current = null; contextHash = ''; matchedSubjects = []; controls['subject-id'].value = '';
    el('matches').replaceChildren(); el('matches').hidden = true; matchButtons = [];
    invalidate(); renderCurrent();
  }
  function renderMatches() {
    const node = el('matches'); node.replaceChildren(); matchButtons = []; node.hidden = matchedSubjects.length < 2;
    for (const item of matchedSubjects) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'intel-example';
      const kind = integer(item.subject.kind);
      button.textContent = kind === 1 ? 'Token supply' : kind === 2 ? 'Watched balance · ' + short(item.subject.account) : 'Pool reserves';
      button.dataset.selected = String(big(item.id) === big(current?.id));
      listen(button, 'click', () => operation(async () => { controls['subject-id'].value = item.id.toString(); await load(); }));
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
  async function analyzeAddress(value = controls.address.value) {
    clearSelection();
    if (!verified) throw Error('Wait for the on-chain registry to connect.');
    const input = String(value).trim(); controls.address.value = input;
    if (!eth.isAddress(input) || !nonzero(input)) throw Error('Enter a valid, nonzero 0x address on Robinhood Chain.');
    const query = eth.getAddress(input); controls.address.value = query;
    const count = big(await contracts.observations.subjectCount());
    if (count < 0n || count > 256n) throw Error('The registry count is outside the supported range. No analysis was selected.');
    const records = [];
    for (let first = 1n; first <= count; first += 8n) {
      const ids = Array.from({length:Number(count-first+1n < 8n ? count-first+1n : 8n)}, (_, index) => first + BigInt(index));
      const group = await Promise.all(ids.map(async id => {
        const subject = tuple(await contracts.observations.subject(id), SUBJECT_FIELDS);
        if (integer(subject.kind) < 1 || integer(subject.kind) > 3 || !eth.isAddress(subject.target) || !nonzero(subject.target)) throw Error('A registered monitor could not be verified. Try reading the address again.');
        return {id,subject};
      }));
      records.push(...group);
    }
    subjectCount = count; el('subject-count').textContent = count + ' tracked monitors';
    matchedSubjects = records.filter(item => same(item.subject.target, query) || integer(item.subject.kind) === 2 && same(item.subject.account, query));
    renderMatches();
    if (!matchedSubjects.length) { notice('No S0UL monitor is registered for this address. The registry owner must add a compatible token or pool before it can be analysed.'); return; }
    controls['subject-id'].value = matchedSubjects[0].id.toString();
    await load();
  }
  async function initialize() {
    if (!deployment) { notice('Intelligence contracts awaiting deployment. No observations or reports are available yet.'); render(); return; }
    if (integer(deployment.chainId ?? INTEL_CHAIN_ID) !== INTEL_CHAIN_ID) throw Error('Intel deployment must target Robinhood Chain (4663).');
    renderSources();
    provider = options.provider ?? new eth.JsonRpcProvider(deployment.readRpcUrl ?? INTEL_DEFAULT_RPC, INTEL_CHAIN_ID, { staticNetwork: true });
    contracts = options.contracts ?? Object.fromEntries(['observations','reports','classifier'].map(name => [name,new eth.Contract(contractAddress(name),deployment[name]?.abi ?? INTEL_ABIS[name],provider)]));
    await verifyDeployment(); [owner, subjectCount, chainBlock] = await Promise.all([contracts.observations.owner(), contracts.observations.subjectCount(), provider.getBlock('latest')]);
    renderSources();
    el('dot').dataset.state = 'verified'; el('network').textContent = 'Robinhood Chain · Live';
    el('subject-count').textContent = subjectCount + ' tracked monitors';
    notice('Paste an address to read its registered analysis. No wallet or gas needed.');
    if (big(subjectCount)>0n && options.autoLoad!==false) {controls['subject-id'].value='1';await load();}
    renderExamples();
  }
  async function identity() {
    if (!ethereum?.request || !address || !walletProvider) throw Error('Connect a browser wallet before submitting a transaction.');
    const [accounts, chain] = await Promise.all([ethereum.request({ method: 'eth_accounts' }), ethereum.request({ method: 'eth_chainId' })]);
    if (Number(BigInt(chain)) !== INTEL_CHAIN_ID || !same(accounts?.[0], address)) { quote = null; address = null; chainId = null; throw Error('Wallet account or chain changed. Reconnect and estimate the action again.'); }
  }
  async function connect() {
    if (!ethereum?.request) throw Error('Open an Ethereum wallet to connect. Public observation reads do not require a wallet.');
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    let chain = Number(BigInt(await ethereum.request({ method: 'eth_chainId' })));
    if (chain !== INTEL_CHAIN_ID) { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1237' }] }); chain = Number(BigInt(await ethereum.request({ method: 'eth_chainId' }))); }
    if (chain !== INTEL_CHAIN_ID || !accounts?.[0]) throw Error('Select Robinhood Chain (4663) and an account in your wallet.');
    walletProvider = new eth.BrowserProvider(ethereum, 'any', { cacheTimeout: -1 }); address = eth.getAddress(accounts[0]); chainId = chain;
    restorePending(); invalidate(); notice(pending ? 'A saved submitted transaction needs reconciliation before another action.' : 'Wallet connected. Estimate one concrete action before approving its fee limit.');
  }
  async function readSubject(id = subjectId(), history = lookback()) {
    const block = await provider.getBlock('latest'); if (!block) throw Error('The current chain block is unavailable.'); const at = {blockTag:block.number};
    const raw = await contracts.observations.subject(id,at);
    const subject = tuple(raw, SUBJECT_FIELDS); if (integer(subject.kind) < 1 || integer(subject.kind) > 3 || !nonzero(subject.target)) throw Error('This subject is not registered.');
    const rawFrame = await contracts.observations.features(id, history,at), frame = tuple(rawFrame, FRAME_FIELDS);
    frame.current = tuple(frame.current, SNAPSHOT_FIELDS); frame.previous = tuple(frame.previous, SNAPSHOT_FIELDS);
    const snapshot = frame.current;
    const reportId = big(await contracts.reports.latestReport(id,at));
    let report = null, reportText = null;
    if (reportId > 0n) { const [r, text] = await Promise.all([contracts.reports.report(reportId,at), contracts.reports.render(reportId,at)]); report = tuple(r, REPORT_FIELDS); reportText = String(text); }
    const next = { id, history, subject, snapshot, frame, reportId, report, reportText, block };
    const hash = eth.keccak256(eth.toUtf8Bytes(textJSON({ id, history, subject, sequence: snapshot.sequence, currentHash: frame.currentHash, previousHash: frame.previousHash, flags:frame.flags,status:frame.status,latestReport: reportId })));
    return { next, hash };
  }
  function renderCurrent() {
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
    el('result-summary').textContent = !report ? 'This address is registered. Publish its first observation using Update the report on-chain below.' : big(report.previousSequence) === 0n ? 'One observation is saved. A later on-chain update enables a comparison.' : integer(report.label) === 5 ? 'These stored observations are not comparable. No trend is asserted.' : 'Compared two stored observations over ' + report.elapsedSeconds + ' seconds.';
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
  async function load() { quote = null; controls.consent.checked = false; const { next, hash } = await readSubject(); current = next; contextHash = hash; chainBlock = next.block; const input=controls.address.value.trim(); if (!same(input,next.subject.target) && !(integer(next.subject.kind)===2 && same(input,next.subject.account))) controls.address.value=next.subject.target; if (matchedSubjects.length && !matchedSubjects.some(item=>big(item.id)===big(next.id))) matchedSubjects=[]; renderCurrent(); renderMatches(); notice('Saved on-chain analysis loaded. Reading is free; updating requires a wallet transaction.'); }
  function registerIntent() {
    if (!isOwner()) throw Error('Only the registry owner can register a source.');
    const kind = Number(controls.kind.value), target = controls.target.value.trim(), account = controls.account.value.trim();
    if (![1,2,3].includes(kind) || !eth.isAddress(target) || !nonzero(target)) throw Error('Choose a reader and enter its deployed source address.');
    if (kind === 2 && (!eth.isAddress(account) || !nonzero(account))) throw Error('Enter the observed account address.');
    return { kind, target:eth.getAddress(target), account:kind === 2 ? eth.getAddress(account) : eth.ZeroAddress };
  }
  async function concreteAction(action) {
    const specification = ACTIONS[action];
    if (action === 'register') {
      const intent = registerIntent(), code = await provider.getCode(intent.target); if (code === '0x') throw Error('The source address has no deployed bytecode.');
      const expectedCodeHash = eth.keccak256(code), args = [intent.kind,intent.target,intent.account,expectedCodeHash];
      return { ...specification,args,contextHash:eth.keccak256(eth.toUtf8Bytes(textJSON({ ...intent,expectedCodeHash,owner }))) };
    }
    const id = subjectId(), history = lookback(), { next, hash } = await readSubject(id,history);
    current = next; contextHash = hash; renderCurrent();
    if (!next.subject.enabled) throw Error('This subject is disabled.');
    const args = action === 'snapshot' ? [id] : [id,history];
    if (action === 'snapshot') { const preview = await contracts.observations.snapshot.staticCall(...args,{from:address}); const result = integer(preview.status ?? preview[0]); if (result !== 0) throw Error(`Snapshot unavailable: ${READ_STATUSES[result] ?? 'reader failure'}.`); }
    return { ...specification,args,contextHash:hash };
  }
  async function liveFees() { const [block, fee] = await Promise.all([provider.getBlock('latest'),provider.getFeeData()]); const gasPriceWei = big(fee.gasPrice ?? fee.maxFeePerGas); if (!block || gasPriceWei <= 0n) throw Error('Current fee data is unavailable.'); return { block,gasPriceWei }; }
  async function estimate() {
    noPending();await identity(); await verifyDeployment(); quote = null; controls.consent.checked = false;
    const action = actionName(), concrete = await concreteAction(action), contract = contracts[concrete.contract];
    const [gasEstimate, fees] = await Promise.all([contract.getFunction(concrete.method).estimateGas(...concrete.args,{from:address}),liveFees()]);
    const gasLimit = (big(gasEstimate)*12000n+9999n)/10000n;
    if (gasLimit > big(fees.block.gasLimit) || gasLimit > 31_000_000n) throw Error('This action exceeds the supported single-transaction gas limit.');
    const feeCeilingWei = (fees.gasPriceWei*3n+1n)/2n;
    const submissionGasPriceWei = intelSubmissionGasPrice(fees.gasPriceWei,feeCeilingWei);
    const data = contract.interface.encodeFunctionData(concrete.method,concrete.args), to = contractAddress(concrete.contract);
    contextHash = concrete.contextHash;
    quote = {action,method:concrete.method,args:concrete.args,contract:concrete.contract,to,data,contextHash,owner:address,chainId,gasEstimate:big(gasEstimate),gasLimit,gasPriceWei:fees.gasPriceWei,submissionGasPriceWei,feeCeilingWei,estimatedWei:big(gasEstimate)*submissionGasPriceWei,reserveWei:gasLimit*feeCeilingWei,expiresAt:now()+45_000,blockNumber:fees.block.number};
    controls.limit.value = formatIntelETH(quote.reserveWei);
    notice(`Estimate ready for ${ACTIONS[action].label.toLowerCase()}. Review the exact action and single-transaction fee reserve.`);
  }
  async function settle(hash) {
    if (!pending || !/^0x[0-9a-fA-F]{64}$/.test(hash) || pending.hash && !same(hash,pending.hash)) throw Error('Use the exact submitted transaction hash from your wallet.');
    const [transaction, receipt] = await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
    if (!transaction) throw Error('The transaction is not visible yet. The saved wallet intent remains unresolved.');
    if(transaction.hash&&!same(transaction.hash,hash) || receipt?.hash&&!same(receipt.hash,hash) || receipt?.transactionHash&&!same(receipt.transactionHash,hash)) throw Error('The RPC returned a different transaction or receipt hash. Recovery remains unresolved.');
    const specification = ACTIONS[pending.action];
    const selector = contracts[specification.contract].interface.getFunction(specification.method).selector;
    if (!same(transaction.from,pending.owner) || !same(transaction.to,contractAddress(specification.contract)) || !same(transaction.to,pending.to) || !same(eth.keccak256(transaction.data),pending.dataHash) || !same(transaction.data.slice(0,10),selector) || big(transaction.value) !== 0n || Number(transaction.nonce) !== pending.nonce || integer(transaction.chainId) !== INTEL_CHAIN_ID || integer(pending.chainId) !== INTEL_CHAIN_ID) throw Error('The confirmed transaction does not match the saved wallet action.');
    if (!pending.hash) {pending.hash=hash;savePending(true);}
    if (!receipt) throw Error('The transaction is not confirmed yet. Its saved hash remains unresolved.');
    const canonical = await provider.getBlock(receipt.blockNumber); if (!same(canonical?.hash,receipt.blockHash)) throw Error('Transaction receipt is not on the current canonical chain.');
    const price = big(receipt.gasPrice ?? receipt.effectiveGasPrice ?? transaction.gasPrice), spent = big(receipt.gasUsed)*price;
    if(price<=0n || big(receipt.gasUsed)<=0n) throw Error('Confirmed receipt fee data is unavailable. Recovery remains unresolved.');
    let outcome = Number(receipt.status) === 1 ? 'Confirmed' : 'Reverted', resultRejected = false;
    for (const log of receipt.logs ?? []) {
      const source = same(log.address,contractAddress('observations')) ? 'observations' : same(log.address,contractAddress('reports')) ? 'reports' : null;
      if (!source) continue;
      let event; try {event=contracts[source].interface.parseLog(log);} catch {continue;}
      if (event?.name === 'SnapshotRejected') {outcome=`Reader rejected: ${READ_STATUSES[integer(event.args.status ?? event.args[1])] ?? 'unknown status'}`;resultRejected=true;}
      if (event?.name === 'SnapshotStored') outcome=`Snapshot ${event.args.sequence ?? event.args[1]} stored`;
      if (event?.name === 'ReportPublished') outcome=`Report ${event.args.reportId ?? event.args[0]} published`;
      if (event?.name === 'SubjectRegistered') outcome=`Subject ${event.args.subjectId ?? event.args[0]} registered`;
    }
    receipts.push({hash,action:pending.action,status:Number(receipt.status),outcome,gasUsed:big(receipt.gasUsed),spentWei:spent});
    const cap = big(pending.budgetWei), settledOwner = pending.owner, reserveExceeded = spent > cap || price > big(pending.feeCeilingWei) || big(transaction.gasLimit) > big(pending.gasLimit);
    pending = null; savePending(false,settledOwner); quote = null; controls.consent.checked = false;
    const list = el('receipts'); list.replaceChildren();
    for (const item of receipts.slice(-20)) { const row = doc.createElement('li'), hashNode = doc.createElement('code'); row.textContent = `${ACTIONS[item.action]?.label ?? item.action} · ${item.outcome} · ${formatIntelETH(item.spentWei)} ETH`; hashNode.textContent=item.hash;row.append(hashNode);list.append(row); }
    el('receipt-count').textContent = `· ${receipts.length} confirmed`;
    if (current) { const { next, hash:context } = await readSubject(current.id,current.history);current=next;contextHash=context;renderCurrent(); }
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
    pending = {hash:null,owner:address,chainId:INTEL_CHAIN_ID,to:accepted.to,dataHash:eth.keccak256(accepted.data),nonce,action:accepted.action,gasLimit:accepted.gasLimit.toString(),gasPriceWei:submissionGasPriceWei.toString(),feeCeilingWei:accepted.feeCeilingWei.toString(),budgetWei:budgetWei.toString()};
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
  listen(controls.address,'input',()=>{clearSelection();notice('Choose Analyze address to read its registered observations.');});
  listen(controls.connect,'click',()=>operation(connect)); listen(controls.load,'click',()=>operation(load)); listen(controls.estimate,'click',()=>operation(estimate)); listen(controls.send,'click',()=>operation(send));
  for (const control of [controls['subject-id'],controls.lookback]) listen(control,'input',()=>{current=null;contextHash='';invalidate();renderCurrent();el('features').textContent='No confirmed snapshots loaded.';el('report').textContent='No on-chain report loaded.';appendRows(el('report-details'),[]);});
  listen(controls.action,'change',invalidate); listen(controls.limit,'input',()=>{controls.consent.checked=false;render();});listen(controls.consent,'change',render);
  for (const control of [controls.kind,controls.target,controls.account]) listen(control,'input',()=>{contextHash='';invalidate();});
  listen(controls['register-prepare'],'click',()=>{controls.action.value='register';el('update').open=true;invalidate();notice('Registration selected. Estimate its exact source address and bytecode pin before approval.');});
  listen(controls.reconcile,'click',()=>operation(()=>settle(controls['recovery-hash'].value.trim())));
  const changed = () => { address=null;chainId=null;quote=null;controls.consent.checked=false;notice('Wallet account or chain changed. Reconnect and estimate again.');render(); };
  if (ethereum?.on) { ethereum.on('accountsChanged',changed);ethereum.on('chainChanged',changed);listeners.push(()=>ethereum.removeListener?.('accountsChanged',changed),()=>ethereum.removeListener?.('chainChanged',changed)); }
  const ready = operation(initialize);
  timer = (options.setInterval ?? globalThis.setInterval)(()=>{if(quote)render();},1000);
  return {ready,analyze:value=>operation(()=>analyzeAddress(value)),load:()=>operation(load),estimate:()=>operation(estimate),connect:()=>operation(connect),send:()=>operation(send),reconcile:hash=>operation(()=>settle(hash)),get state(){return{verified,address,chainId,subjectCount,current,matches:matchedSubjects.map(item=>({id:item.id,...item.subject})),quote:quote?{...quote}:null,pending:pending?{...pending}:null,recoveryFault,busy};},destroy(){destroyed=true;(options.clearInterval??globalThis.clearInterval)(timer);listeners.forEach(remove=>remove());if(!options.provider)provider?.destroy?.();walletProvider?.destroy?.();root.removeAttribute('data-s0ul-intel-mounted');}};
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

if (typeof document !== 'undefined') {
  const root = document.getElementById('s0ul-intel-root');
  if (root) {
    loadS0ULIntelDeployment(root).then(deployment=>mountS0ULIntel(root,{deployment})).catch(()=>mountS0ULIntel(root,{deployment:null}));
  }
}
