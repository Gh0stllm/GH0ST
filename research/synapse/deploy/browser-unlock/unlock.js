/* Ethers is served from the pinned local dependency. No network provider or
 * password/key export exists in this page. Only signed exact transactions leave. */
(() => {
  'use strict';
  const { Transaction, Wallet, Interface, getAddress, getCreateAddress, keccak256, formatEther } = ethers;
  const OWNER = '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
  const TOKEN = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
  const FEE = 6n * 10n ** 18n;
  const terminal = new Set(['confirmed', 'failed', 'uncertain', 'expired']);
  const get = id => document.getElementById(id);
  const input = get('password'), button = get('unlock'), message = get('status');
  let review, plan, busy = false, submitted = false;
  const expect = (value, text) => { if (!value) throw Error(text || 'The plan does not match the reviewed deployment.'); };
  const enable = active => { input.disabled = !active; button.disabled = !active; };
  async function local(endpoint, options = {}) {
    try { return await fetch(`./${endpoint}`, { cache: 'no-store', credentials: 'omit', redirect: 'error', ...options }); }
    catch { throw Error('The local signing service is unreachable. Open the latest signing link.'); }
  }
  async function read(endpoint, asText = false) {
    const response = await local(endpoint);
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw Error(error.message || 'Local signing service unavailable.'); }
    return asText ? response.text() : response.json();
  }
  async function checkedPlan(value) {
    const expectedHash = new URLSearchParams(location.hash.slice(1)).get('plan');
    expect(/^[0-9a-f]{64}$/.test(expectedHash || '') && expectedHash === value.planHash, 'Open the exact reviewed signing link.');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.planText)));
    expect(Array.from(bytes, item => item.toString(16).padStart(2, '0')).join('') === expectedHash);
    const candidate = JSON.parse(value.planText);
    expect(candidate.schema === 'gh0st-synapse-unsigned-plan-v1' && candidate.broadcast === false && candidate.kernelVersion === 2);
    expect(getAddress(candidate.owner) === OWNER && BigInt(candidate.chainId) === 4663n && getAddress(candidate.paymentToken) === getAddress(TOKEN));
    expect(candidate.actions.length === 9 && candidate.transactions.length === 6 && candidate.optionalSmokeTransactions.length === 3);
    const entries = [...candidate.transactions, ...candidate.optionalSmokeTransactions];
    let maxCost = 0n;
    for (const [index, action] of candidate.actions.entries()) {
      const entry = entries[index], tx = Transaction.from(action.unsignedSerialized);
      expect(!tx.signature && tx.type === 2 && tx.chainId === 4663n && tx.value === 0n && tx.nonce === candidate.nonceStart + index);
      expect(action.id === index && action.nonce === tx.nonce && tx.unsignedHash === action.unsignedHash && action.unsignedHash === entry.unsignedHash && action.unsignedSerialized === entry.unsignedSerialized);
      expect(keccak256(tx.data) === entry.calldataHash && tx.data === entry.data);
      expect(tx.gasLimit > 0n && tx.gasLimit <= 16777216n && tx.maxFeePerGas > 0n && tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas);
      expect(tx.gasLimit * tx.maxFeePerGas === BigInt(action.maxCostWei)); maxCost += BigInt(action.maxCostWei);
      if (index < 6) expect(tx.to === null && getCreateAddress({ from: OWNER, nonce: tx.nonce }) === getAddress(entry.predictedAddress));
      if (index === 6) {
        expect(tx.to === getAddress(TOKEN));
        expect(tx.data === new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [candidate.addresses.baseGraph, FEE]));
      }
      if (index === 7) {
        expect(tx.to === getAddress(candidate.addresses.baseGraph));
        const call = new Interface(['function inferPaid(uint16[],bytes32,uint256,uint256)']).decodeFunctionData('inferPaid', tx.data);
        expect(JSON.stringify(Array.from(call[0], Number)) === JSON.stringify(entry.inputTokens) && call[1] === candidate.transactions[4].graph.graphId && call[2] === FEE && call[3] === BigInt(entry.deadline));
      }
      if (index === 8) expect(tx.to === getAddress(candidate.addresses.baseGraph) && tx.data === new Interface(['function withdraw()']).encodeFunctionData('withdraw', []));
    }
    expect(maxCost === BigInt(value.maxNetworkFeeWei));
    expect(Date.now() < value.expiresAt, 'This signing session has expired.');
    return candidate;
  }
  function showState(state) {
    if (state.message) message.textContent = state.message;
    get('progress').textContent = state.state === 'ready' ? '' : `${state.completedActions || 0} / ${state.totalActions || 9} confirmed`;
    if (state.hashes) {
      get('hashes').replaceChildren();
      for (const [index, hash] of state.hashes.entries()) { const p = document.createElement('p'), link = document.createElement('a'); link.href = `https://explorer.robinhood.com/tx/${hash}`; link.textContent = `${index + 1}. ${hash}`; link.rel = 'noopener noreferrer'; link.target = '_blank'; p.append(link); get('hashes').append(p); }
      get('proof').hidden = false;
    }
  }
  async function follow() {
    try { const state = await read('status'); showState(state); if (terminal.has(state.state)) return; }
    catch { message.textContent = 'The service is not responding. Signed transactions may already have been submitted. Checking status before any further action.'; }
    setTimeout(follow, 3000);
  }
  function render() {
    get('owner').textContent = OWNER;
    get('model').textContent = `${plan.modelDirectory} · ${plan.transactions[0].module.vocabulary} tokens · context ${plan.transactions[0].module.contextSize} · width ${plan.transactions[0].module.hiddenSize}`;
    get('fee').textContent = `${formatEther(BigInt(review.maxNetworkFeeWei))} ETH (includes current chain data estimate)`;
    get('plan-hash').textContent = review.planHash;
    for (const action of plan.actions) {
      const block = document.createElement('div'); block.className = 'action';
      const title = document.createElement('strong'); title.textContent = `${action.id + 1}. ${action.label.replace(/^optional:/, '').replace(/^deploy:/, 'Deploy ')}`;
      const target = document.createElement('p'); target.className = 'muted'; target.textContent = action.destination;
      const details = document.createElement('p'); details.className = 'muted'; details.textContent = `Nonce ${action.nonce} · fee cap ${action.maxCostEth} ETH`;
      const hash = document.createElement('code'); hash.textContent = action.unsignedHash;
      block.append(title, target, details, hash); get('actions').append(block);
    }
    get('plan').hidden = false; get('actions-section').hidden = false;
  }
  async function signAll() {
    let password = input.value; input.value = '';
    try {
      const encrypted = await read('keystore', true);
      let wallet;
      try { const unlocking = Wallet.fromEncryptedJson(encrypted, password); password = ''; wallet = await unlocking; }
      catch { throw Error('Could not unlock the wallet. Check the password and try again.'); }
      expect(wallet.address === OWNER, 'The unlocked wallet does not match the deployment wallet.');
      const raw = [];
      for (const action of plan.actions) {
        const signed = await wallet.signTransaction(Transaction.from(action.unsignedSerialized));
        const decoded = Transaction.from(signed);
        expect(decoded.from === OWNER && decoded.unsignedHash === action.unsignedHash, 'A signature differs from the reviewed transaction.');
        raw.push(signed);
      }
      wallet = undefined;
      return raw;
    } finally { password = ''; }
  }
  button.addEventListener('click', async event => {
    if (!event.isTrusted || busy || submitted || !plan || !input.value) return;
    busy = true; enable(false); message.textContent = 'Unlocking this wallet in your tab and signing the exact nine transactions…';
    try {
      const rawSignedTransactions = await signAll(); submitted = true;
      message.textContent = 'Sending the signed plan to the local service…';
      try { const response = await local('submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planHash: review.planHash, rawSignedTransactions }) }); expect(response.ok, 'Submission response was unsuccessful'); }
      catch { message.textContent = 'The submission outcome is unknown. Checking the saved plan status before any further action.'; }
      void follow();
    } catch (error) { message.textContent = error.message; if (!submitted && Date.now() < review.expiresAt) { enable(true); input.focus(); } }
    finally { busy = false; }
  });
  async function init() {
    if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') { message.textContent = 'Open the local signing link on this Mac.'; return; }
    try {
      [review] = await Promise.all([read('plan')]); plan = await checkedPlan(review); render();
      const state = await read('status'); showState(state);
      if (state.state === 'ready') { enable(true); message.textContent = 'Ready for your wallet password.'; }
      else if (!terminal.has(state.state)) void follow();
    } catch { message.textContent = 'The reviewed plan could not be verified. Open the exact latest signing link.'; }
  }
  void init();
})();
