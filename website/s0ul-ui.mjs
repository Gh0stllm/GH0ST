import { createS0ULClient } from './s0ul-client.mjs';

const PROOF = 'https://github.com/Gh0stllm/GH0ST/blob/main/s0ul-1m/AGENT.md';
const CONTROLLER = 'https://repo.sourcify.dev/4663/0x9F92776e33087DCF0d77b9BE23145efAC6cE695D';
const ACTIONS = {
  memory_set: { label: 'Save a preference', kind: 3, tokens: 5 },
  memory_get: { label: 'Read a preference', kind: 4, tokens: 6 },
  task_add: { label: 'Add a task', kind: 5, tokens: 8 },
  task_list: { label: 'List my tasks', kind: 6, tokens: 6 },
  task_done: { label: 'Complete a task', kind: 7, tokens: 8 },
  balance_eth: { label: 'Read my ETH balance', kind: 1, tokens: 6 },
  balance_gh0st: { label: 'Read my GH0ST balance', kind: 2, tokens: 6 },
  wait: { label: 'Wait', kind: 0, tokens: 2 },
};
const OUTCOMES = ['Unbound', 'In progress', 'Executed', 'Rejected', 'Cancelled'];
const REASONS = ['None', 'Engine cancelled', 'Invalid model output', 'Unsupported action', 'Action not permitted', 'State changed during inference', 'Task limit reached', 'Task does not exist', 'Token disabled', 'Token code changed', 'Token read failed', 'Output differs from your approved action'];
const bigint = value => { try { return BigInt(value ?? 0); } catch { return 0n; } };
const integer = value => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const shortAddress = value => value ? `${String(value).slice(0, 6)}…${String(value).slice(-4)}` : 'Not connected';
const textValue = value => typeof value === 'string' ? value : JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);

export function parseSpendingLimit(value) {
  const input = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input)) throw new Error('Enter a positive ETH spending limit with up to 18 decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (wei <= 0n) throw new Error('Your spending limit must be greater than zero.');
  return wei;
}

export function formatEtherValue(value, digits = 8) {
  const wei = bigint(value), negative = wei < 0n, absolute = negative ? -wei : wei;
  const whole = absolute / 10n ** 18n;
  const fraction = (absolute % 10n ** 18n).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function exactEther(value) { return formatEtherValue(value, 18); }
function expiryOf(quote) { const value = typeof quote?.expiresAt === 'string' ? Date.parse(quote.expiresAt) : Number(quote?.expiresAt); return value < 1e12 ? value * 1000 : value; }
function sameAddress(a, b) { return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase()); }
function toolResult(result) {
  if (result.balanceWei !== undefined) return result.asset === 'ETH' ? `${formatEtherValue(result.balanceWei)} ETH` : `${bigint(result.balanceWei).toLocaleString('en-US')} GH0ST raw units`;
  if (Array.isArray(result.tasks)) return result.tasks.length ? result.tasks.map(task => `${task.done ? 'Done' : 'Open'} · #${task.id} ${task.title}`).join('\n') : 'Your task list is empty.';
  if (result.taskId !== undefined) return result.title !== undefined ? `Task #${result.taskId}: ${result.title}` : `Task #${result.taskId} marked complete.`;
  if (result.value !== undefined) return result.key ? `${result.key} = ${result.value}` : String(result.value) || '(No value saved.)';
  if (result.message !== undefined) return String(result.message);
  return textValue(result);
}

export function intentFor(values) {
  if (!Object.hasOwn(ACTIONS, values.action)) throw new Error('Choose a supported task.');
  const task = ACTIONS[values.action];
  const key = values.key, value = String(values.value ?? '').trim();
  let expectedAction, defaultPrompt;
  if (values.action === 'memory_set') {
    if (!['theme', 'language', 'mode'].includes(key)) throw new Error('Choose a supported preference key.');
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(value)) throw new Error('Use 1–24 lowercase letters, digits or underscores, starting with a letter.');
    expectedAction = `MEM_SET|${key}|${value}`; defaultPrompt = `${key}=${value}`;
  } else if (values.action === 'memory_get') {
    if (!['theme', 'language', 'mode'].includes(key)) throw new Error('Choose a supported preference key.');
    expectedAction = `MEM_GET|${key}`; defaultPrompt = `Read my ${key}.`;
  } else if (values.action === 'task_add') {
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(value)) throw new Error('Use a task title of 1–24 lowercase letters, digits or underscores, starting with a letter.');
    expectedAction = `TASK_ADD|${value}`; defaultPrompt = `Add task ${value}.`;
  } else if (values.action === 'task_done') {
    const id = String(values.taskId ?? '').trim();
    if (!/^[1-9]\d?$/.test(id) || Number(id) > 64) throw new Error('Enter an existing task ID from 1 to 64.');
    expectedAction = `TASK_DONE|${id}`; defaultPrompt = `Complete task ${id}.`;
  } else if (values.action === 'task_list') {
    expectedAction = 'TASK_LIST|SELF'; defaultPrompt = 'List my tasks.';
  } else if (values.action === 'balance_eth') {
    expectedAction = 'BALANCE|SELF|ETH'; defaultPrompt = 'Check my ETH balance.';
  } else if (values.action === 'balance_gh0st') {
    expectedAction = 'BALANCE|SELF|GH0ST'; defaultPrompt = 'Check my GH0ST balance.';
  } else { expectedAction = 'WAIT'; defaultPrompt = 'Wait.'; }
  return { kind: task.kind, expectedAction, defaultPrompt, maxNewTokens: task.tokens };
}

export function quoteMatches(quote, intent, state, now = Date.now()) {
  const expiresAt = expiryOf(quote);
  if (!quote || !state?.connected || integer(state.chainId) !== 4663 || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  if (!sameAddress(quote.owner, state.address) || integer(quote.chainId) !== 4663) return false;
  if (quote.expectedAction !== intent.expectedAction || Number(quote.kind) !== intent.kind) return false;
  if (quote.requestId !== undefined && quote.requestId !== null) return state.requestId !== undefined && state.requestId !== null && String(quote.requestId) === String(state.requestId);
  return quote.prompt === intent.prompt && Number(quote.maxNewTokens) === intent.maxNewTokens;
}

export function mountS0ULAgent(root, options = {}) {
  if (!root || root.dataset.s0ulMounted) return null;
  root.dataset.s0ulMounted = 'true';
  const doc = root.ownerDocument, now = options.now ?? Date.now;
  root.innerHTML = `
    <section class="s0ul-section" aria-labelledby="s0ul-title">
      <div class="s0ul-heading"><div><div class="s0ul-eyebrow"><span class="s0ul-led" aria-hidden="true"></span> S0UL / Live on Robinhood Chain</div><h2 id="s0ul-title">Give the chain<br>a <em>task.</em></h2></div><p>Our 984,192-parameter model runs in Solidity. Review the full-task gas estimate, approve your limit, then follow real contract execution.</p></div>
      <div class="s0ul-layout">
        <div class="s0ul-workspace">
          <div class="s0ul-panel-top"><span class="s0ul-micro" id="s0ul-network">Robinhood Chain · 4663</span><a class="s0ul-source" href="${CONTROLLER}" target="_blank" rel="noopener noreferrer">Verified controller ↗</a></div>
          <div class="s0ul-wallet-row"><label class="s0ul-field">Wallet<select id="s0ul-wallet"><option value="">Browser wallet</option></select></label><button class="s0ul-button s0ul-button-outline" id="s0ul-connect" type="button">Connect wallet</button></div>
          <div class="s0ul-fields"><label class="s0ul-field">Task<select id="s0ul-task">${Object.entries(ACTIONS).map(([value, task]) => `<option value="${value}">${task.label}</option>`).join('')}</select></label><label class="s0ul-field" id="s0ul-key-field">Preference<select id="s0ul-key"><option value="theme">Theme</option><option value="language">Language</option><option value="mode">Mode</option></select></label><label class="s0ul-field" id="s0ul-value-field"><span id="s0ul-value-label">Value</span><input id="s0ul-value" type="text" maxlength="24" value="dark" spellcheck="false" autocomplete="off"></label><label class="s0ul-field" id="s0ul-id-field" hidden>Task ID<input id="s0ul-task-id" inputmode="numeric" value="1" autocomplete="off"></label></div>
          <div class="s0ul-intent"><span class="s0ul-micro">Only permitted action</span><code id="s0ul-intent">MEM_SET|theme|dark</code></div>
          <label class="s0ul-field">Prompt<textarea id="s0ul-prompt" rows="3" maxlength="2000" spellcheck="false">theme=dark</textarea></label>
          <div class="s0ul-fields"><label class="s0ul-field">Maximum output tokens<input id="s0ul-tokens" type="number" min="2" max="32" value="5"></label><div class="s0ul-field-note">Includes EOS. The estimate reserves the full token budget; generation may finish earlier.</div></div>
          <button class="s0ul-button s0ul-button-estimate" id="s0ul-quote" type="button" disabled><span>Estimate full task</span><span aria-hidden="true">↗</span></button>
          <p class="s0ul-small s0ul-free-note">Estimating is read-only and costs no gas.</p>
          <div id="s0ul-notice" class="s0ul-notice" role="status" aria-live="polite">Connect a wallet to calculate a current estimate.</div>
        </div>
        <aside class="s0ul-budget" aria-labelledby="s0ul-budget-title">
          <div class="s0ul-panel-top"><h3 id="s0ul-budget-title">Before you begin.</h3><span class="s0ul-micro" id="s0ul-quote-status">No estimate yet</span></div>
          <div class="s0ul-estimate"><span class="s0ul-micro" id="s0ul-fee-label">Estimated total network fee</span><div><strong id="s0ul-estimated-fee">—</strong><span> ETH</span></div><p id="s0ul-fee-caption">Startup + model inference + final action</p></div>
          <dl class="s0ul-quote-details"><div><dt id="s0ul-gas-label">Full-task gas estimate</dt><dd id="s0ul-estimated-gas">—</dd></div><div><dt>Wallet transactions</dt><dd id="s0ul-batches">—</dd></div><div><dt>Current gas price</dt><dd id="s0ul-gas-price">—</dd></div><div><dt>Gas buffer / fee ceiling</dt><dd id="s0ul-buffer">—</dd></div><div><dt>Buffered recommendation</dt><dd id="s0ul-recommended">—</dd></div></dl>
          <label class="s0ul-field">Total spending limit (ETH)<input id="s0ul-limit" inputmode="decimal" placeholder="Calculate an estimate first" autocomplete="off" disabled></label>
          <label class="s0ul-consent"><input id="s0ul-consent" type="checkbox" disabled><span>I reviewed this estimate and spending limit.</span></label>
          <button class="s0ul-button s0ul-button-primary" id="s0ul-start" type="button" disabled><span>Start task</span><span aria-hidden="true">→</span></button>
          <p class="s0ul-small">You pay gas through your wallet. Each transaction requires wallet confirmation. Fees can change; the app pauses before exceeding its accepted limit. Computation costs gas even if the model output is rejected.</p>
          <p class="s0ul-small s0ul-forecast-note" id="s0ul-forecast-note">This is a forecast, not a guaranteed price. The next transaction is estimated again before sending.</p>
        </aside>
      </div>
      <div class="s0ul-execution" aria-labelledby="s0ul-execution-title">
        <div class="s0ul-run-heading"><div><div class="s0ul-eyebrow">On-chain execution</div><h3 id="s0ul-execution-title">Ready for a request.</h3></div><span class="s0ul-run-badge" id="s0ul-outcome">No active task</span></div>
        <div class="s0ul-progress" role="progressbar" aria-label="Position within the approved token budget" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="s0ul-progress-fill"></span></div>
        <dl class="s0ul-run-details"><div><dt>Request</dt><dd id="s0ul-request">—</dd></div><div><dt>Model phase</dt><dd id="s0ul-phase">—</dd></div><div><dt>Position / output tokens</dt><dd id="s0ul-position">—</dd></div><div><dt>Actual fees paid</dt><dd id="s0ul-spent">0 ETH</dd></div></dl>
        <p class="s0ul-bound-intent" id="s0ul-bound-intent" hidden></p>
        <div class="s0ul-output-grid"><div><span class="s0ul-micro">Confirmed model output</span><pre id="s0ul-output">Waiting for confirmed model output.</pre></div><div><span class="s0ul-micro">Executed tool result</span><pre id="s0ul-result">No action executed.</pre></div></div>
        <div class="s0ul-run-actions"><button class="s0ul-button s0ul-button-outline" id="s0ul-run" type="button" disabled>Run batches</button><button class="s0ul-button s0ul-button-outline" id="s0ul-step" type="button" disabled>Next batch</button><button class="s0ul-button s0ul-button-outline" id="s0ul-pause" type="button" disabled>Pause</button><button class="s0ul-button s0ul-button-outline" id="s0ul-finalize" type="button" disabled>Finalize result</button><button class="s0ul-button s0ul-button-quiet" id="s0ul-cancel" type="button" disabled>Cancel request</button></div>
        <p class="s0ul-small" id="s0ul-run-note">A task advances only while a caller sends transactions. Pause stops future wallet requests; a submitted transaction still settles.</p>
        <div class="s0ul-recovery" id="s0ul-recovery" hidden><p>A wallet transaction needs reconciliation. No further transactions will be sent until it is resolved.</p><label class="s0ul-field">Transaction hash<input id="s0ul-recovery-hash" type="text" placeholder="0x…" autocomplete="off" spellcheck="false"></label><button class="s0ul-button s0ul-button-outline" id="s0ul-reconcile" type="button">Check transaction</button></div>
        <details class="s0ul-history"><summary>Transaction record <span id="s0ul-receipt-count">0 confirmed</span></summary><ol id="s0ul-receipts"></ol></details>
      </div>
      <div class="s0ul-footer"><div class="s0ul-resume"><label class="s0ul-field">Resume your request<input id="s0ul-resume-id" type="text" inputmode="numeric" placeholder="Request ID" autocomplete="off"></label><button class="s0ul-button s0ul-button-outline" id="s0ul-resume" type="button" disabled>Load request</button></div><p>One permitted action per request. Prompts, preferences and tasks are public on-chain. This small specialized model can produce incorrect arguments; exact-action checks protect your approved intent. <a href="${PROOF}" target="_blank" rel="noopener noreferrer">Capabilities &amp; proof ↗</a></p></div>
    </section>`;

  const el = id => root.querySelector(`#s0ul-${id}`);
  const controls = Object.fromEntries(['wallet','connect','task','key','value','task-id','prompt','tokens','quote','limit','consent','start','run','step','pause','finalize','cancel','resume-id','resume','recovery-hash','reconcile'].map(id => [id, el(id)]));
  let state = { connected: false, busy: false }, client = null, quote = null, quoteIntent = null, quoteRequest = null, quoting = false, activeOperation = false, uiError = '', destroyed = false;
  const providers = [];
  const createClient = options.createClient ?? createS0ULClient;
  let lastAccount = '', lastChain = '', lastReceiptSignature = '', lastIntentSignature = '';

  function values() { return { action: controls.task.value, key: controls.key.value, value: controls.value.value, taskId: controls['task-id'].value }; }
  function intent() {
    const result = intentFor(values()), prompt = controls.prompt.value.trim(), maxNewTokens = Number(controls.tokens.value);
    if (!prompt) throw new Error('Enter a prompt.');
    if (!Number.isSafeInteger(maxNewTokens) || maxNewTokens < 2 || maxNewTokens > 32) throw new Error('Choose an output budget from 2 to 32 tokens.');
    return { ...result, prompt, maxNewTokens };
  }
  function running() { return state.requestId !== null && state.requestId !== undefined && integer(state.request?.outcome ?? 1) === 1; }
  function blocked() { return Boolean(state.ambiguous || state.pending); }
  function freshQuote() {
    try { return Boolean(quote && quoteIntent && quoteMatches(quote, intent(), state, now()) && String(quoteRequest ?? '') === String(running() ? state.requestId : '')); }
    catch { return false; }
  }
  function acceptedCap() { return state.authorizationActive !== false && bigint(state.budgetWei) > bigint(state.spentWei); }
  function quotedSpent() { return quoteRequest === null ? 0n : bigint(state.spentWei); }
  function reviewedCap() {
    if (!freshQuote() || !controls.consent.checked || quote.canAfford === false) return false;
    try { return parseSpendingLimit(controls.limit.value) >= quotedSpent() + bigint(quote.budgetFeeWei); } catch { return false; }
  }
  function notice(message, error = false) { const target = el('notice'); if (target.textContent !== message) target.textContent = message; target.classList.toggle('s0ul-notice-error', error); }
  function invalidate(message = '') {
    quote = null; quoteIntent = null; quoteRequest = null; controls.consent.checked = false; uiError = message;
    client?.invalidateQuote?.(); render();
  }
  function restoreIntent() {
    const saved = state.intent;
    if (!saved?.expectedAction || state.requestId === undefined || state.requestId === null) return;
    const signature = `${state.address}:${state.requestId}:${saved.expectedAction}:${saved.prompt}:${saved.maxNewTokens}`;
    if (signature === lastIntentSignature) return;
    lastIntentSignature = signature;
    const parts = String(saved.expectedAction).split('|');
    const type = { MEM_SET: 'memory_set', MEM_GET: 'memory_get', TASK_ADD: 'task_add', TASK_LIST: 'task_list', TASK_DONE: 'task_done', WAIT: 'wait' }[parts[0]];
    const action = parts[0] === 'BALANCE' ? parts[2] === 'ETH' ? 'balance_eth' : parts[2] === 'GH0ST' ? 'balance_gh0st' : null : type;
    if (!action || !Object.hasOwn(ACTIONS, action)) return;
    controls.task.value = action;
    if (action.startsWith('memory_')) controls.key.value = parts[1];
    if (action === 'memory_set') controls.value.value = parts[2];
    if (action === 'task_add') controls.value.value = parts[1];
    if (action === 'task_done') controls['task-id'].value = parts[1];
    if (typeof saved.prompt === 'string') controls.prompt.value = saved.prompt;
    if (Number.isSafeInteger(Number(saved.maxNewTokens))) controls.tokens.value = String(saved.maxNewTokens);
    el('key-field').hidden = !['memory_set','memory_get'].includes(action);
    el('value-field').hidden = !['memory_set','task_add'].includes(action);
    el('id-field').hidden = action !== 'task_done';
    el('value-label').textContent = action === 'task_add' ? 'Task title' : 'Value';
    el('intent').textContent = saved.expectedAction;
  }
  function syncTask(reset = false) {
    const kind = controls.task.value;
    el('key-field').hidden = !['memory_set','memory_get'].includes(kind);
    el('value-field').hidden = !['memory_set','task_add'].includes(kind);
    el('id-field').hidden = kind !== 'task_done';
    el('value-label').textContent = kind === 'task_add' ? 'Task title' : 'Value';
    if (reset) {
      if (kind === 'task_add') controls.value.value = 'audit';
      else if (kind === 'memory_set') controls.value.value = 'dark';
      controls.tokens.value = String(ACTIONS[kind].tokens);
    }
    try { const next = intentFor(values()); el('intent').textContent = next.expectedAction; if (reset) controls.prompt.value = next.defaultPrompt; }
    catch { el('intent').textContent = 'Complete the task fields above.'; }
    invalidate();
  }
  function renderQuote() {
    const valid = freshQuote(), remaining = running();
    el('budget-title').textContent = remaining ? 'Before you continue.' : 'Before you begin.';
    el('fee-label').textContent = remaining ? 'Estimated remaining network fee' : 'Estimated total network fee';
    el('fee-caption').textContent = remaining ? 'Remaining computation + final action' : 'Startup + model inference + final action';
    el('gas-label').textContent = remaining ? 'Remaining gas estimate' : 'Full-task gas estimate';
    if (!quote) {
      el('estimated-fee').textContent = '—'; el('estimated-gas').textContent = '—'; el('batches').textContent = '—'; el('gas-price').textContent = '—'; el('buffer').textContent = '—'; el('recommended').textContent = '—'; el('quote-status').textContent = 'No current estimate';
    } else {
      el('estimated-fee').textContent = formatEtherValue(quote.estimatedFeeWei);
      el('estimated-gas').textContent = bigint(quote.estimatedGas ?? quote.totalGas).toLocaleString('en-US');
      el('batches').textContent = `≈${integer(quote.totalTransactionsEstimated ?? quote.totalTransactionsIdeal ?? quote.idealBatchTransactions).toLocaleString()} · up to ${integer(quote.totalTransactionsMax ?? quote.maxBatchTransactions).toLocaleString()}`;
      el('gas-price').textContent = `${Number(bigint(quote.gasPriceWei)) / 1e9} gwei`;
      el('buffer').textContent = `${integer(quote.gasMarginBps) / 100}% · ${Number(bigint(quote.feeCeilingWeiPerGas)) / 1e9} gwei`;
      el('recommended').textContent = `${formatEtherValue(quotedSpent() + bigint(quote.budgetFeeWei))} ETH`;
      const seconds = Math.max(0, Math.ceil((expiryOf(quote) - now()) / 1000));
      el('quote-status').textContent = valid ? `Refresh in ${seconds}s` : 'Estimate expired';
      el('forecast-note').textContent = quote.extrapolated || quote.configuration?.extrapolated
        ? 'This request exceeds the measured calibration range. The forecast uses extra headroom; review each wallet fee and the accepted spending limit.'
        : 'This is a forecast, not a guaranteed price. The next transaction is estimated again before sending. Startup and finalization need additional wallet confirmations.';
    }
    controls.limit.disabled = !valid || activeOperation || Boolean(state.busy);
    controls.consent.disabled = !valid || activeOperation || Boolean(state.busy);
    controls.start.disabled = !reviewedCap() || running() || activeOperation || state.busy || blocked();
  }
  function renderReceipts() {
    const receipts = Array.isArray(state.receipts) ? state.receipts : [];
    const signature = receipts.map(r => `${r.hash ?? r.transactionHash}:${r.status}`).join('|');
    el('receipt-count').textContent = `${receipts.length} confirmed`;
    if (signature === lastReceiptSignature) return;
    lastReceiptSignature = signature; const list = el('receipts'); list.replaceChildren();
    for (const receipt of receipts.slice(-20)) {
      const item = doc.createElement('li'), label = doc.createElement('span'), hash = doc.createElement('code');
      label.textContent = `${receipt.method ?? receipt.operation ?? 'Transaction'} · ${integer(receipt.status) === 0 ? 'Failed' : 'Confirmed'}`;
      hash.textContent = receipt.hash ?? receipt.transactionHash ?? 'Receipt recorded';
      item.append(label, hash); list.append(item);
    }
  }
  function render() {
    if (destroyed) return;
    const busy = activeOperation || Boolean(state.busy), active = running(), done = Boolean(state.progress?.done), constrained = state.request?.expectedActionHash;
    controls.connect.disabled = busy || blocked() && state.connected;
    controls.connect.textContent = state.connected ? shortAddress(state.address) : 'Connect wallet';
    el('network').textContent = state.connected ? integer(state.chainId) === 4663 ? `Robinhood Chain · ${shortAddress(state.address)}` : 'Switch wallet to Robinhood Chain' : 'Robinhood Chain · 4663';
    controls.wallet.disabled = busy;
    for (const control of [controls.task,controls.key,controls.value,controls['task-id'],controls.prompt,controls.tokens]) control.disabled = busy || active && Boolean(state.intent);
    controls.quote.disabled = !state.connected || integer(state.chainId) !== 4663 || busy || blocked();
    controls.quote.firstElementChild.textContent = quoting ? 'Calculating full task…' : active ? 'Estimate remaining task' : 'Estimate full task';
    controls.resume.disabled = !state.connected || integer(state.chainId) !== 4663 || busy || blocked();
    controls['resume-id'].disabled = busy;
    const approved = acceptedCap() && !quote || reviewedCap();
    const canContinue = active && !done && !blocked() && !busy && approved;
    controls.run.disabled = !canContinue; controls.step.disabled = !canContinue;
    controls.pause.disabled = !busy || !active;
    controls.finalize.disabled = !active || !done || blocked() || busy || !approved;
    controls.cancel.disabled = !active || blocked() || busy || !approved;
    controls.reconcile.disabled = busy || !state.connected;
    el('recovery').hidden = !blocked() || busy;
    if (state.pending?.hash && !controls['recovery-hash'].value) controls['recovery-hash'].value = state.pending.hash;
    el('request').textContent = state.requestId === null || state.requestId === undefined ? '—' : String(state.requestId);
    const outcome = state.request ? integer(state.request.outcome) : null;
    el('outcome').textContent = outcome === null ? 'No active task' : OUTCOMES[outcome] ?? 'Unknown state';
    el('outcome').dataset.outcome = String(outcome ?? 'none');
    el('execution-title').textContent = state.ambiguous ? 'Resolve the wallet transaction.' : state.status === 'paused' ? 'Progress paused.' : outcome === 2 ? 'Action confirmed on-chain.' : outcome === 3 ? 'Action rejected.' : outcome === 4 ? 'Request cancelled.' : busy ? state.status ? String(state.status).replace(/[_-]/g, ' ') : 'Confirm in your wallet.' : active ? done ? 'Model output is ready.' : 'Ready for the next batch.' : 'Ready for a request.';
    el('phase').textContent = state.progress?.phaseName ?? (state.progress?.phase !== undefined ? String(state.progress.phase) : '—');
    el('position').textContent = state.progress ? `${integer(state.progress.position) + 1} · ${integer(state.progress.generated)} generated` : '—';
    el('spent').textContent = `${formatEtherValue(state.spentWei)} ETH`;
    el('bound-intent').hidden = !constrained;
    el('bound-intent').textContent = state.intent?.expectedAction ? `Approved request action: ${state.intent.expectedAction}` : constrained ? 'This request has an immutable action commitment. Select its original task above to verify it before continuing.' : '';
    el('output').textContent = state.actualAction !== null && state.actualAction !== undefined ? String(state.actualAction) || '(Empty model output)' : state.outputError && state.outputIds?.length ? `${state.progress?.done ? 'Output could not be validated' : 'Generation in progress'}: ${state.outputError}\nConfirmed output token IDs: ${state.outputIds.join(', ')}` : 'Waiting for confirmed model output.';
    el('result').textContent = outcome === 3 ? REASONS[integer(state.request.reason)] ?? 'The controller rejected this action.' : state.result !== null && state.result !== undefined ? toolResult(state.result) : outcome === 2 ? 'Execution confirmed.' : 'No action executed.';
    const totalPositions = integer(state.progress?.promptLength) + integer(state.progress?.maxNewTokens) - 1;
    const progress = done ? 100 : state.progress && totalPositions > 0 ? Math.min(99, Math.max(0, Math.round(integer(state.progress.position) / totalPositions * 100))) : 0;
    const progressBar = root.querySelector('.s0ul-progress'); progressBar.setAttribute('aria-valuenow', String(progress)); el('progress-fill').style.width = `${progress}%`;
    if (constrained && state.progress?.done && outcome === 1) {
      el('run-note').textContent = state.outputError || state.intent?.expectedAction && state.actualAction !== state.intent.expectedAction
        ? 'Output mismatch: the model did not produce your approved action. Finalize result records a rejection and performs no tool write. Gas already spent is still paid.'
        : 'The confirmed model output is shown above. Finalization checks the original action commitment before executing the tool.';
    } else if (state.ambiguous) el('run-note').textContent = 'Check your wallet activity for the exact transaction hash. The app will verify its sender, target and calldata before recovering progress.';
    else el('run-note').textContent = 'A task advances only while a caller sends transactions. Pause stops future wallet requests; a submitted transaction still settles.';
    if (uiError) notice(uiError, true);
    else if (state.lastError) notice(String(state.lastError.message ?? state.lastError), true);
    else if (busy) notice(quoting ? 'Reading the chain and estimating the complete task. No transaction is being sent.' : 'Follow your wallet prompts. Confirmed transactions are recorded below.');
    else if (state.ambiguous) notice('Resolve the previous transaction before requesting another wallet transaction.', true);
    else if (freshQuote()) notice(quote.canAfford === false ? 'Your wallet balance is below the quoted remaining budget. Fund your wallet, then refresh the estimate.' : 'Estimate ready. Review the full task, spending limit and wallet confirmations before continuing.', quote.canAfford === false);
    else if (quote) notice('The estimate has expired or the task changed. Calculate it again before starting.');
    else if (!state.connected) notice('Connect a wallet to calculate a current estimate.');
    else if (integer(state.chainId) !== 4663) notice('Connect to Robinhood Chain (4663) in your wallet.');
    else if (active && acceptedCap()) notice('Your approved spending limit is active. Run batches or advance one batch at a time.');
    else if (active) notice('Request loaded. Match its original task intent above, then estimate the remaining work before approving a spending limit.');
    else notice('Choose a task and calculate its full gas estimate before starting.');
    renderQuote(); renderReceipts();
  }
  function receive(update) {
    state = update ?? {};
    const account = String(state.address ?? '').toLowerCase(), chain = String(state.chainId ?? '');
    if (!state.connected || lastAccount && account !== lastAccount || lastChain && chain !== lastChain) { quote = null; quoteIntent = null; quoteRequest = null; controls.consent.checked = false; }
    lastAccount = account; lastChain = chain;
    restoreIntent();
    render();
  }
  function provider() { return providers.find(item => item.id === controls.wallet.value)?.provider ?? options.ethereum ?? globalThis.window?.ethereum; }
  function ensureClient() {
    if (!client) client = createClient({ ethereum: provider(), onUpdate: receive, storage: options.storage });
    return client;
  }
  async function action(fn) {
    if (activeOperation) return;
    activeOperation = true; uiError = ''; render();
    try { await fn(ensureClient()); if (client?.state) state = client.state; }
    catch (error) { uiError = String(error?.shortMessage ?? error?.message ?? 'The operation could not be completed.'); }
    finally { activeOperation = false; quoting = false; render(); }
  }
  controls.connect.addEventListener('click', () => action(c => c.connect()));
  controls.wallet.addEventListener('change', () => { client?.pause?.(); client?.destroy?.(); client = null; state = { connected: false, busy: false }; lastAccount = ''; lastChain = ''; invalidate(); });
  controls.task.addEventListener('change', () => syncTask(true));
  for (const control of [controls.key,controls.value,controls['task-id']]) control.addEventListener('input', () => {
    try { const next = intentFor(values()); el('intent').textContent = next.expectedAction; controls.prompt.value = next.defaultPrompt; } catch { el('intent').textContent = 'Complete the task fields above.'; }
    invalidate();
  });
  for (const control of [controls.prompt,controls.tokens]) control.addEventListener('input', () => invalidate());
  controls.limit.addEventListener('input', () => { controls.consent.checked = false; render(); });
  controls.consent.addEventListener('change', render);
  controls.quote.addEventListener('click', () => action(async c => {
    const next = intent(); quoting = true; quote = null; quoteIntent = null; controls.consent.checked = false; render();
    const activeId = running() ? state.requestId : null;
    const calculated = await c.quote({ ...next, ...(activeId !== null ? { requestId: activeId } : {}) });
    quote = calculated; quoteIntent = next; quoteRequest = activeId;
    controls.limit.value = exactEther((activeId === null ? 0n : bigint(state.spentWei)) + bigint(calculated.budgetFeeWei));
  }));
  controls.start.addEventListener('click', () => action(async c => {
    if (!reviewedCap() || running()) throw new Error('Review a fresh estimate and spending limit before starting.');
    const accepted = quote; await c.start(accepted, { budgetWei: parseSpendingLimit(controls.limit.value) });
    quote = null; quoteIntent = null; quoteRequest = null; controls.consent.checked = false;
  }));
  function runOptions() {
    if (quote) { if (!reviewedCap()) throw new Error('Review the new estimate and spending limit first.'); return { budgetWei: parseSpendingLimit(controls.limit.value), quote }; }
    if (!acceptedCap()) throw new Error('Estimate the remaining task and approve a spending limit.');
    return {};
  }
  async function approveForOperation(c) {
    const settings = runOptions();
    if (settings.quote) {
      await c.approve(settings.quote, { budgetWei: settings.budgetWei });
      quote = null; quoteIntent = null; quoteRequest = null; controls.consent.checked = false;
    }
  }
  controls.run.addEventListener('click', () => action(async c => { await approveForOperation(c); await c.run(); }));
  controls.step.addEventListener('click', () => action(async c => { await approveForOperation(c); await c.advance(); }));
  controls.pause.addEventListener('click', () => { client?.pause(); uiError = ''; render(); });
  controls.finalize.addEventListener('click', () => action(async c => { await approveForOperation(c); await c.finalize(); }));
  controls.cancel.addEventListener('click', () => action(async c => { await approveForOperation(c); await c.cancel(); }));
  controls.resume.addEventListener('click', () => action(async c => {
    const id = controls['resume-id'].value.trim(); if (!/^[1-9]\d*$/.test(id)) throw new Error('Enter a positive request ID.');
    quote = null; quoteIntent = null; quoteRequest = null; controls.consent.checked = false; await c.loadRequest(id);
  }));
  controls.reconcile.addEventListener('click', () => action(async c => {
    const hash = controls['recovery-hash'].value.trim(); if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Enter the exact 32-byte transaction hash from your wallet.'); await c.reconcile(hash);
  }));
  function addProvider(detail) {
    if (!detail?.provider || providers.some(item => item.provider === detail.provider)) return;
    const id = String(providers.length), name = String(detail.info?.name ?? 'Browser wallet'); providers.push({ id, name, provider: detail.provider });
    if (providers.length === 1) controls.wallet.replaceChildren();
    const option = doc.createElement('option'); option.value = id; option.textContent = name; controls.wallet.append(option);
  }
  const onProvider = event => addProvider(event.detail);
  globalThis.window?.addEventListener('eip6963:announceProvider', onProvider);
  const fallback = options.ethereum ?? globalThis.window?.ethereum;
  if (fallback?.providers?.length) fallback.providers.forEach((item, index) => addProvider({ provider: item, info: { name: item.isMetaMask ? 'MetaMask' : item.isCoinbaseWallet ? 'Coinbase Wallet' : `Browser wallet ${index + 1}` } }));
  else if (fallback) addProvider({ provider: fallback, info: { name: fallback.isMetaMask ? 'MetaMask' : 'Browser wallet' } });
  if (globalThis.window && typeof globalThis.Event === 'function') globalThis.window.dispatchEvent(new Event('eip6963:requestProvider'));
  syncTask(false); render();
  const timer = globalThis.setInterval(() => { if (quote) render(); }, 1000);
  return { get client() { return client; }, render, destroy() { destroyed = true; globalThis.clearInterval(timer); globalThis.window?.removeEventListener('eip6963:announceProvider', onProvider); client?.pause?.(); client?.destroy?.(); root.removeAttribute('data-s0ul-mounted'); } };
}

if (typeof document !== 'undefined') {
  const mount = document.getElementById('s0ul-agent-root');
  if (mount) mountS0ULAgent(mount);
}
