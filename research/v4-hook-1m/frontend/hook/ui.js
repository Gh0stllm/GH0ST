/* Thin UI for the pinned wallet-only GH0ST swap engine. All model text is plain text. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const text = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const disabled = (id, value) => { const node = $(id); if (node) node.disabled = value; };
  const state = { ready: false, checked: false, connected: false, busy: false, refreshing: false, direction: 'ETH_TO_GH0ST',
    slippageBps: 50, quote: null, action: null, snapshot: null, feed: [], message: null,
    historyCursor: null, historyStarted: false, historyDone: false, historyBusy: false, historyError: null };
  const owner = '0x8d6b11cfdf079e27c17e05cb7ea81235887691c6';
  const short = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '';
  let client;
  function displayAmount(value, symbol) {
    if (value === undefined || value === null) return '—';
    const [whole, fractional = ''] = String(value).split('.'), digits = symbol === 'ETH' ? 6 : 4;
    const fraction = fractional.slice(0, digits).replace(/0+$/, '');
    if (whole === '0' && !fraction && /[1-9]/.test(fractional)) return `<${digits === 6 ? '0.000001' : '0.0001'}`;
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
  }
  function errorMessage(error) {
    const code = error?.code;
    if (code === 'ACTION_REJECTED' || Number(code) === 4001) return 'Request cancelled in your wallet. Nothing else was sent.';
    if (code === 'INSUFFICIENT_FUNDS') return 'Your wallet needs enough ETH for this amount and the network fee.';
    const message = String(error?.shortMessage || error?.message || 'The request could not be completed.');
    if (/no active liquidity|needs liquidity|no liquidity/i.test(message)) return 'This pool is waiting for liquidity. Swaps will open once it is funded.';
    if (/quote expired|fresh quote|deadline expired/i.test(message)) return 'Your quote expired. Review a fresh quote before continuing.';
    if (/account changed|reconnect/i.test(message)) return 'Your wallet changed. Connect again and review a fresh quote.';
    if (/revert|CALL_EXCEPTION/i.test(message)) return 'The swap could not be simulated at the current price. Refresh the quote and try a smaller amount.';
    if (/fetch|network|coalesce|timeout|missing response|request limit|rate limit/i.test(message)) return 'The network is taking longer than expected. Try refreshing shortly.';
    if (/Submission status is unknown/i.test(message)) return 'Check your wallet activity, then paste that transaction hash below to recover its result. Do not send it again.';
    if (/Contract verification|model does not match|another pool manager|verification is not configured/i.test(message)) return 'The on-chain contract check did not match. Swapping is paused.';
    return message.length <= 210 && !/0x[0-9a-f]{20}|\{.*\}/i.test(message) ? message : 'The request could not be completed. Check your wallet and refresh the quote.';
  }
  function setError(error) { text('error', error ? errorMessage(error) : ''); if ($('error')) $('error').hidden = !error; }
  function inputSymbol() { return state.direction === 'ETH_TO_GH0ST' ? 'ETH' : 'GH0ST'; }
  function outputSymbol() { return state.direction === 'ETH_TO_GH0ST' ? 'GH0ST' : 'ETH'; }
  function freshQuote() { return state.quote && Date.now() - state.quote.createdAt <= 120000; }
  function render() {
    const from = inputSymbol(), to = outputSymbol(), balances = state.snapshot?.balances;
    text('from-symbol', from); text('to-symbol', to);
    for (const [id, symbol] of [['from-icon', from], ['to-icon', to]]) { const icon=$(id); if (icon) { icon.textContent=symbol==='ETH'?'♦':'[·]'; icon.className='coin '+(symbol==='ETH'?'eth':'ghost'); } }
    const setting=$('slippage'); if (setting) setting.setAttribute('aria-label', `Slippage tolerance ${(state.slippageBps / 100).toFixed(1)} percent`);
    const slippageLabel=$('slippage-value'); if (slippageLabel) slippageLabel.textContent=`${state.slippageBps / 100}%`;
    text('from-balance', balances ? `Balance ${displayAmount(from === 'ETH' ? balances.eth : balances.ghost, from)}` : 'Balance —');
    text('to-balance', balances ? `Balance ${displayAmount(to === 'ETH' ? balances.eth : balances.ghost, to)}` : 'Balance —');
    text('wallet-label', state.connected ? short(client.account) : 'Connect wallet');
    const connect = $('connect-wallet'); if (connect) connect.setAttribute('aria-label', state.connected ? `Connected wallet ${client.account}` : 'Connect wallet');
    text('pool-status', state.checked ? state.ready ? 'Pool ready' : 'Awaiting liquidity' : 'Checking pool');
    text('status-detail', state.checked ? state.ready ? 'Robinhood Chain · 0.30% pool fee' : 'The hook is deployed. This pool needs its first liquidity.' : 'Verifying the live contracts on Robinhood Chain.');
    const dot = $('status-dot'); if (dot) { dot.dataset.state = state.checked ? state.ready ? 'ready' : 'waiting' : 'checking'; dot.classList.toggle('ready', state.checked && state.ready); }
    const setup = $('setup-link'); if (setup) {
      setup.hidden = !(state.connected && !state.ready && client.account?.toLowerCase() === owner);
      setup.href = 'https://gh0st-v4-signing.netlify.app/';
    }
    const hasAmount = !!$('from-amount')?.value.trim();
    let label = 'Connect wallet';
    if (state.busy) label = 'Please wait…';
    else if (state.connected && state.action?.kind === 'pending') label = state.action.label;
    else if (state.connected && !state.ready) label = state.checked ? 'Waiting for liquidity' : 'Checking pool…';
    else if (state.connected && !hasAmount) label = 'Enter an amount';
    else if (state.connected && !freshQuote()) label = state.quote ? 'Refresh quote' : 'Review quote';
    else if (state.connected) label = state.action?.label || 'Review swap';
    text('swap-button', label);
    disabled('swap-button', state.busy || (state.connected && state.action?.kind !== 'pending' && (!state.ready || !hasAmount)));
    disabled('connect-wallet', state.busy);
    disabled('quote-button', state.busy || !state.ready || !hasAmount);
    disabled('flip-pair', state.busy);
    disabled('from-amount', state.busy);
    for (const button of document.querySelectorAll('[data-slippage]')) {
      const selected = Number(button.dataset.slippage) === state.slippageBps;
      button.setAttribute('aria-pressed', String(selected)); button.classList.toggle('selected', selected); button.disabled = state.busy;
    }
    const details = $('quote-details'); if (details) details.hidden = !state.quote;
    text('to-amount', state.quote ? displayAmount(state.quote.amountOutFormatted, to) : '—');
    text('min-output', state.quote ? `${displayAmount(state.quote.minimumOutputFormatted, to)} ${to}` : '—');
    text('price-impact', state.quote ? `${(state.quote.priceImpactBps / 100).toFixed(2)}%` : '—');
    text('network-fee', state.quote ? 'Shown in wallet' : '—');
    if (state.quote) {
      const seconds = Math.max(0, Math.ceil((state.quote.createdAt + 120000 - Date.now()) / 1000));
      text('quote-expiry', seconds ? `Refresh in ${seconds}s` : 'Quote expired');
    } else text('quote-expiry', '—');
    disabled('load-transaction', state.busy || !$('tx-hash')?.value.trim());
    disabled('recover-pending', state.busy || !state.connected || !$('tx-hash')?.value.trim());
    if ($('recover-pending')) $('recover-pending').hidden=!(state.connected && state.action?.kind==='pending');
  }
  function invalidate() { state.quote = null; state.action = null; setError(null); render(); }
  async function updateAction() {
    state.action = state.connected && state.quote ? await client.nextAction(state.quote) : null;
    render();
  }
  function showMessage(message, label = 'Confirmed on-chain') {
    if (!message) return;
    state.message = message;
    text('latest-message', message.text); $('latest-message')?.classList.remove('empty');
    text('message-status', label);
    text('message-meta', `Sentence ${message.sequence}${message.blockNumber ? ` · Block ${message.blockNumber.toLocaleString()}` : ''}`);
    const link = $('message-tx'); if (link) {
      link.hidden = !message.transactionHash;
      if (message.transactionHash) { link.href = `${globalThis.GH0STSwap.CONSTANTS.explorer}/tx/${message.transactionHash}`; link.textContent = 'View transaction ↗'; }
    }
  }
  function renderFeed(rows) {
    const combined = new Map(state.feed.map(row => [`${row.transactionHash}:${row.logIndex}`, row]));
    for (const row of rows) combined.set(`${row.transactionHash}:${row.logIndex}`, row);
    state.feed = [...combined.values()].sort((a,b) => b.blockNumber-a.blockNumber || b.logIndex-a.logIndex);
    const list = $('feed-list'); if (!list) return;
    list.replaceChildren();
    const empty = $('feed-empty'); if (empty) empty.hidden = state.feed.length > 0 || !state.historyDone;
    text('history-count', state.historyStarted ? `${state.feed.length} ${state.feed.length === 1 ? 'thought' : 'thoughts'}${state.historyDone ? '' : ' loaded'}` : 'Reading the chain');
    // The newest thought has its own prominent block; earlier thoughts appear once below it.
    for (const row of state.feed.slice(1)) {
      const item = document.createElement('li'); item.className = 'feed-item';
      const words = document.createElement('p'); words.className = 'feed-message'; words.textContent = row.text;
      const meta = document.createElement('div'); meta.className = 'feed-meta';
      const number = document.createElement('span'); number.textContent = `Sentence ${row.sequence}`; meta.append(number);
      if (row.transactionHash) {
        const link = document.createElement('a'); link.href = `${globalThis.GH0STSwap.CONSTANTS.explorer}/tx/${row.transactionHash}`;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${short(row.transactionHash)} ↗`; meta.append(link);
      }
      item.append(words, meta); list.append(item);
    }
    if (state.feed.length && (!state.message || BigInt(state.feed[0].sequence) > BigInt(state.message.sequence))) showMessage(state.feed[0]);
    if (!state.feed.length && state.historyDone) {
      text('latest-message', 'Quiet, for now.'); text('message-meta', 'A confirmed swap will leave its words here.');
    }
    const more = $('load-more-thoughts');
    if (more) { more.hidden = !state.historyStarted || state.historyDone; more.disabled = state.historyBusy; more.textContent = state.historyBusy ? 'Reading history…' : 'Load earlier thoughts ↓'; }
    disabled('refresh-feed', state.historyBusy);
    text('history-status', state.historyError || (state.historyBusy ? 'Reading confirmed events from Robinhood Chain…' : state.historyDone ? 'All confirmed thoughts from this pool. Updates automatically.' : 'Newest first. Load earlier thoughts to continue the on-chain history.'));
  }
  async function loadHistory() {
    if (state.historyBusy || state.historyDone) return;
    state.historyBusy = true; state.historyError = null; renderFeed([]);
    try {
      // Fill the visible archive automatically, including quiet gaps since deployment.
      let collected = 0;
      for (let pageNumber=0; pageNumber<16; pageNumber++) {
        const page = await client.historyPage({ cursor: state.historyCursor, limit: 20-collected });
        state.historyStarted = true; state.historyCursor = page.nextCursor; state.historyDone = !page.hasMore;
        renderFeed(page.rows);
        collected += page.rows.length;
        if (collected >= 20 || state.historyDone) break;
      }
    } catch (_) { state.historyError = 'Could not load the full history. Refresh to try again.'; }
    finally { state.historyBusy = false; renderFeed([]); }
  }
  async function refreshStatus() {
    const result = await client.status(); state.snapshot = result; state.checked = true; state.ready = result.ready;
    state.connected = !!client.account; render(); return result;
  }
  async function refreshFeed() {
    if (!state.historyStarted) return loadHistory();
    if (state.historyBusy) return;
    try { renderFeed(await client.messages({ limit: 20 })); state.historyError = null; renderFeed([]); }
    catch (_) { state.historyError = 'Could not refresh the latest thoughts. Your loaded history is still here.'; renderFeed([]); }
  }
  async function run(work) {
    if (state.busy) return;
    state.busy = true; setError(null); render();
    try { return await work(); }
    catch (e) { setError(e); }
    finally { state.busy = false; state.connected = !!client.account; render(); }
  }
  async function connect() {
    const result = await client.connect(); state.snapshot = result; state.ready = result.ready; state.checked = true; state.connected = true;
    invalidate();
    document.dispatchEvent(new CustomEvent('h00k-wallet-connected', {detail:{account:client.account}}));
    try { const action=await client.nextAction(null); if(action.kind==='pending') { state.action=action; render(); } } catch (_) { /* No pending action: a quote is required. */ }
  }
  async function getQuote() {
    state.quote = await client.quote({ amount: $('from-amount').value.trim(), direction: state.direction, slippageBps: state.slippageBps });
    await updateAction();
  }
  async function processResult(result) {
    if (result?.pending) {
      text('message-status', 'Transaction pending');
      if (result.hash) { const field = $('tx-hash'); if (field) field.value = result.hash; }
      state.action = { kind: 'pending', label: 'Check pending transaction' }; return;
    }
    if (result?.message) {
      showMessage(result.message, 'Your swap · confirmed on-chain'); state.quote = null; state.action = null;
      const hash = $('tx-hash'); if (hash) hash.value = result.hash || result.message.transactionHash || '';
      try { await refreshFeed(); } catch (_) { /* Receipt is already verified; a feed timeout does not undo it. */ }
    } else if (state.quote) await updateAction();
    try { await refreshStatus(); } catch (_) { /* The completed receipt remains authoritative. */ }
  }
  async function mainAction() {
    if (!state.connected) { await connect(); return; }
    if (state.action?.kind === 'pending') { await processResult(await client.executeNext(state.quote)); return; }
    if (!freshQuote()) { await getQuote(); return; }
    // Exactly one explicit user click reaches one wallet action.
    await processResult(await client.executeNext(state.quote));
  }
  function bind() {
    client = globalThis.GH0STSwap.createClient({ ethers: globalThis.ethers, onStatus: update => {
      if (update.phase === 'disconnected') { state.connected = false; state.snapshot = null; invalidate(); }
      else if (update.phase === 'submitted') { text('message-status', 'Transaction submitted · awaiting confirmation'); const input = $('tx-hash'); if (input) input.value = update.hash; }
      else if (typeof update.ready === 'boolean') { state.snapshot = update; state.ready = update.ready; state.checked = true; state.connected = !!update.account; render(); }
    } });
    $('connect-wallet')?.addEventListener('click', () => run(connect));
    $('swap-button')?.addEventListener('click', () => run(mainAction));
    $('quote-button')?.addEventListener('click', () => run(getQuote));
    $('from-amount')?.addEventListener('input', invalidate);
    $('flip-pair')?.addEventListener('click', () => { if (!state.busy) { state.direction = state.direction === 'ETH_TO_GH0ST' ? 'GH0ST_TO_ETH' : 'ETH_TO_GH0ST'; invalidate(); } });
    for (const button of document.querySelectorAll('[data-slippage]')) button.addEventListener('click', () => {
      if (!state.busy) { state.slippageBps = Number(button.dataset.slippage); button.closest('details')?.removeAttribute('open'); invalidate(); }
    });
    $('tx-hash')?.addEventListener('input', render);
    $('load-transaction')?.addEventListener('click', () => run(async () => {
      const hash = $('tx-hash').value.trim(), result = await client.receipt(hash);
      if (!result) throw Error('This transaction is still pending or was not found on Robinhood Chain.');
      if (!result.messages.length) throw Error('This transaction has no verified GH0ST sentence for this pool.');
      showMessage(result.messages.at(-1));
    }));
    $('recover-pending')?.addEventListener('click', () => run(async () => processResult(await client.recoverPending($('tx-hash').value.trim()))));
    $('refresh-feed')?.addEventListener('click', refreshFeed);
    $('load-more-thoughts')?.addEventListener('click', loadHistory);
    const refresh = async () => {
      if (document.hidden || state.busy || state.refreshing) return;
      state.refreshing = true;
      try { await Promise.all([refreshStatus(), refreshFeed()]); }
      catch (e) {
        if (!state.checked) { text('pool-status', 'Connection delayed'); text('status-detail', 'The public network is taking a moment. Connect your wallet or try again shortly.'); }
        if (!state.feed.length && !state.historyDone) text('history-status', 'History is taking a moment to load. Refresh to try again.');
      } finally { state.refreshing = false; }
    };
    document.addEventListener('h00k-liquidity-added', () => { refresh(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(refresh, 30000);
    setInterval(() => { if (!document.hidden && state.quote && !state.busy) render(); }, 1000);
    globalThis.GH0STSwapUI=Object.freeze({syncWallet:connect});
    render(); refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
