import test from 'node:test';
import assert from 'node:assert/strict';
import { intentFor, parseSpendingLimit, formatEtherValue, quoteMatches, mountS0ULAgent } from '../website/s0ul-ui.mjs';

test('UI builds exact canonical intent for every exposed capability', () => {
  const cases = [
    [{ action: 'memory_set', key: 'theme', value: 'dark' }, 3, 'MEM_SET|theme|dark'],
    [{ action: 'memory_get', key: 'language' }, 4, 'MEM_GET|language'],
    [{ action: 'task_add', value: 'audit' }, 5, 'TASK_ADD|audit'],
    [{ action: 'task_list' }, 6, 'TASK_LIST|SELF'],
    [{ action: 'task_done', taskId: '64' }, 7, 'TASK_DONE|64'],
    [{ action: 'balance_eth' }, 1, 'BALANCE|SELF|ETH'],
    [{ action: 'balance_gh0st' }, 2, 'BALANCE|SELF|GH0ST'],
    [{ action: 'wait' }, 0, 'WAIT'],
  ];
  for (const [values, kind, canonical] of cases) {
    const intent = intentFor(values);
    assert.equal(intent.kind, kind);
    assert.equal(intent.expectedAction, canonical);
    assert.ok(intent.maxNewTokens >= 2 && intent.maxNewTokens <= 32);
    assert.ok(intent.defaultPrompt.length > 0);
  }
});

test('UI rejects unsupported actions, arbitrary memory keys, noncanonical slugs and IDs', () => {
  const cases = [
    { action: '__proto__' }, { action: 'transfer' },
    { action: 'memory_set', key: 'arbitrary', value: 'dark' },
    { action: 'memory_get', key: '__proto__' },
    ...['', 'Audit', 'has space', 'x|WAIT', 'é', 'a'.repeat(25), '1abc', '<script>'].map(value => ({ action: 'task_add', value })),
    ...['0', '01', '-1', '1.0', '1e2', '65', '10000', '1|SELF'].map(taskId => ({ action: 'task_done', taskId })),
  ];
  for (const values of cases) assert.throws(() => intentFor(values), JSON.stringify(values));
});

test('ETH budget input preserves exact wei and rejects rounded or exponential values', () => {
  assert.equal(parseSpendingLimit('0.000000000000000001'), 1n);
  assert.equal(parseSpendingLimit('9007199254740993.123456789012345678'), 9007199254740993123456789012345678n);
  assert.equal(formatEtherValue(9007199254740993123456789012345678n, 18), '9007199254740993.123456789012345678');
  for (const value of ['0', '-1', '1e18', 'NaN', 'Infinity', '0.0000000000000000001', '.1', '01', '1,000', ''])
    assert.throws(() => parseSpendingLimit(value), value);
});

test('start gating binds the quote to wallet, chain, exact prompt, tokens, action and expiry', () => {
  const now = 1_800_000_000_000;
  const state = { connected: true, chainId: 4663, address: '0x1111111111111111111111111111111111111111' };
  const intent = { expectedAction: 'MEM_SET|theme|dark', kind: 3, prompt: 'theme=dark', maxNewTokens: 5 };
  const quote = { ...intent, owner: state.address, chainId: 4663, expiresAt: now + 60_000 };
  assert.equal(quoteMatches(quote, intent, state, now), true);
  assert.equal(quoteMatches(quote, intent, { ...state, address: state.address.toUpperCase() }, now), true);
  for (const altered of [
    { owner: '0x2222222222222222222222222222222222222222' }, { chainId: 1 },
    { expectedAction: 'MEM_SET|theme|light' }, { kind: 5 }, { prompt: 'task=audit' },
    { maxNewTokens: 6 }, { expiresAt: now }, { expiresAt: now - 1 },
    { expiresAt: undefined }, { expiresAt: 'not-a-date' },
  ]) assert.equal(quoteMatches({ ...quote, ...altered }, intent, state, now), false, JSON.stringify(altered));
  assert.equal(quoteMatches(quote, intent, { ...state, connected: false }, now), false);
  assert.equal(quoteMatches(quote, intent, { ...state, chainId: 1 }, now), false);
  assert.equal(quoteMatches({ ...quote, requestId: '7' }, intent, { ...state, requestId: '7' }, now), true);
  assert.equal(quoteMatches({ ...quote, requestId: '7' }, intent, { ...state, requestId: '8' }, now), false);
});

// A small DOM seam exercises event wiring without a browser or wallet extension.
// Visual/layout and real browser checks are deliberately separate.
function uiFixture() {
  class Element {
    constructor() {
      this.dataset = {}; this.style = {}; this.listeners = new Map(); this.children = [];
      this.disabled = false; this.hidden = false; this.checked = false; this.value = ''; this.textContent = '';
      this.classList = { toggle() {} };
    }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    async fire(name) { if (name !== 'click' || !this.disabled) await this.listeners.get(name)?.(); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    get firstElementChild() { return this.children[0] ?? (this.children[0] = new Element()); }
  }
  const nodes = new Map(), root = new Element();
  root.ownerDocument = { createElement: () => new Element() };
  Object.defineProperty(root, 'innerHTML', { set(html) {
    for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new Element());
    const values = { task: 'memory_set', key: 'theme', value: 'dark', 'task-id': '1', prompt: 'theme=dark', tokens: '5' };
    for (const [id, value] of Object.entries(values)) nodes.get('s0ul-' + id).value = value;
  } });
  root.querySelector = selector => selector === '.s0ul-progress' ? (nodes.get('progress') ?? (nodes.set('progress', new Element()), nodes.get('progress'))) : nodes.get(selector.slice(1));
  const get = id => nodes.get('s0ul-' + id), calls = [], now = 1_800_000_000_000;
  let notify, state = { connected: false, busy: false }, q;
  function update(patch) { state = { ...state, ...patch }; notify(state); }
  const client = {
    get state() { return state; },
    async connect() { calls.push('connect'); update({ connected: true, chainId: 4663, address: '0x1111111111111111111111111111111111111111' }); },
    async quote(intent) { calls.push('quote'); q = { ...intent, owner: state.address, chainId: 4663, expiresAt: now + 60_000,
      estimatedFeeWei: 1n * 10n ** 18n, budgetFeeWei: 2n * 10n ** 18n, totalGas: 1_000_000n,
      gasPriceWei: 1_000_000_000n, feeCeilingWeiPerGas: 1_500_000_000n,
      gasMarginBps: 2500, idealBatchTransactions: 183, maxBatchTransactions: 723,
      totalTransactionsIdeal: 185, totalTransactionsMax: 725 }; return q; },
    async start(quote, { budgetWei }) { calls.push({ method: 'start', quote, budgetWei }); update({ requestId: '1',
      request: { outcome: 1 }, budgetWei, authorizationActive: true, spentWei: 0n, progress: { phase: 1, done: false } }); },
    pause() { calls.push('pause'); update({ status: 'paused' }); },
    invalidateQuote() { calls.push('invalidateQuote'); },
    destroy() { calls.push('destroy'); },
  };
  const mounted = mountS0ULAgent(root, { now: () => now, createClient: options => { notify = options.onUpdate; return client; } });
  return { get, calls, client, mounted, update };
}

test('UI event wiring requires a current quote and explicit consent before Start', async t => {
  const f = uiFixture(); t.after(() => f.mounted.destroy());
  assert.equal(f.get('start').disabled, true);
  await f.get('connect').fire('click'); await f.get('quote').fire('click');
  assert.deepEqual(f.calls.filter(call => typeof call === 'string' && ['connect', 'quote'].includes(call)), ['connect', 'quote']);
  assert.equal(f.calls.some(call => call.method === 'start'), false);
  assert.equal(f.get('start').disabled, true);
  assert.equal(f.get('limit').value, '2');
  f.get('consent').checked = true; await f.get('consent').fire('change');
  assert.equal(f.get('start').disabled, false);
  await f.get('start').fire('click');
  const start = f.calls.find(call => call.method === 'start');
  assert.equal(start.budgetWei, 2n * 10n ** 18n); assert.equal(start.quote.expectedAction, 'MEM_SET|theme|dark');
  assert.equal(f.get('start').disabled, true);
});

test('editing intent or spending limit clears consent and prevents an old quote from starting', async t => {
  const f = uiFixture(); t.after(() => f.mounted.destroy());
  await f.get('connect').fire('click'); await f.get('quote').fire('click');
  f.get('consent').checked = true; await f.get('consent').fire('change');
  f.get('limit').value = '3'; await f.get('limit').fire('input');
  assert.equal(f.get('consent').checked, false); assert.equal(f.get('start').disabled, true);
  f.get('consent').checked = true; await f.get('consent').fire('change');
  assert.equal(f.get('start').disabled, false);
  f.get('prompt').value = 'A different prompt'; await f.get('prompt').fire('input');
  assert.equal(f.get('consent').checked, false); assert.equal(f.get('start').disabled, true);
  await f.get('start').fire('click');
  assert.equal(f.calls.some(call => call.method === 'start'), false);
});

test('confirmed output renders as literal text and a recovered cap is not treated as new approval', async t => {
  const f = uiFixture(); t.after(() => f.mounted.destroy());
  await f.get('connect').fire('click');
  const actual = '<img src=x onerror=alert(1)>';
  f.update({ connected: true, address: '0x1111111111111111111111111111111111111111', chainId: 4663,
    requestId: '1', request: { outcome: 1 }, progress: { done: true, phase: 17 }, actualAction: actual,
    budgetWei: 10n ** 18n, spentWei: 0n, authorizationActive: false });
  assert.equal(f.get('output').textContent, actual);
  assert.equal(f.get('finalize').disabled, true);
  assert.equal(f.get('cancel').disabled, true);
  assert.equal(f.get('result').textContent, 'No action executed.');
});
