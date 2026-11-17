// No accounts, signing, transactions, storage or network fetches. Wallet requests
// run only from the explicit Add network button after the visitor picks a wallet.
export const NETWORK = Object.freeze({
  chainId: '0x4726d9',
  chainName: 'GH0ST GL3',
  nativeCurrency: Object.freeze({ name: 'GH0ST', symbol: 'GH0ST', decimals: 18 }),
  rpcUrls: Object.freeze(['https://rpc.gh0st.fyi']),
  blockExplorerUrls: Object.freeze(['https://scan.gh0st.fyi']),
});

const networkCopy = () => ({ ...NETWORK, nativeCurrency: { ...NETWORK.nativeCurrency }, rpcUrls: [...NETWORK.rpcUrls], blockExplorerUrls: [...NETWORK.blockExplorerUrls] });
export function walletName(info, fallback = 'Browser wallet') {
  const value = typeof info?.name === 'string' ? info.name : fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || fallback;
}

export function discoverWallets(target, changed = () => {}) {
  const providers = [], seen = new Set();
  const add = (provider, info, fallback) => {
    if (!provider || typeof provider.request !== 'function' || seen.has(provider) || providers.length >= 20) return;
    seen.add(provider);
    providers.push({ provider, name: walletName(info, fallback) });
    changed(providers.slice());
  };
  const announce = event => add(event?.detail?.provider, event?.detail?.info);
  target.addEventListener('eip6963:announceProvider', announce);
  const legacy = target.ethereum;
  for (const provider of Array.isArray(legacy?.providers) ? legacy.providers : legacy ? [legacy] : []) {
    add(provider, null, provider.isRabby ? 'Rabby' : provider.isMetaMask ? 'MetaMask' : provider.isCoinbaseWallet ? 'Coinbase Wallet' : 'Browser wallet');
  }
  target.dispatchEvent(new target.Event('eip6963:requestProvider'));
  return { providers: () => providers.slice(), close: () => target.removeEventListener('eip6963:announceProvider', announce) };
}

export async function addNetwork(provider, switchAfter = true) {
  if (!provider || typeof provider.request !== 'function') return { status: 'unsupported', added: false, message: 'Choose a wallet, or copy the network details below.' };
  try {
    await provider.request({ method: 'wallet_addEthereumChain', params: [networkCopy()] });
  } catch (error) {
    const code = Number(error?.code);
    return { status: code === 4001 ? 'declined' : code === 4200 || code === -32601 ? 'unsupported' : 'error', added: false,
      message: code === 4001 ? 'You declined the request. You can try again when ready.' : code === 4200 || code === -32601 ? 'This wallet cannot add a network here. Copy the details below.' : 'The wallet could not add GL3. Check your wallet or copy the details below.' };
  }
  if (!switchAfter) return { status: 'added', added: true, switched: false, message: 'GL3 was added to your wallet.' };
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: NETWORK.chainId }] });
    return { status: 'switched', added: true, switched: true, message: 'Your wallet is ready on GH0ST GL3.' };
  } catch (error) {
    return { status: Number(error?.code) === 4001 ? 'switch-declined' : 'switch-unavailable', added: true, switched: false,
      message: Number(error?.code) === 4001 ? 'GL3 was added. You declined switching networks.' : 'GL3 was added. Switch networks inside your wallet when ready.' };
  }
}

export const networkDetails = () => `Network: ${NETWORK.chainName}\nChain ID: 4663001 (${NETWORK.chainId})\nRPC: ${NETWORK.rpcUrls[0]}\nCurrency: GH0ST (18 decimals)\nExplorer: ${NETWORK.blockExplorerUrls[0]}`;

function mount() {
  const document = window.document;
  if (document.getElementById('gh0st-gl3-wallet-control')) return;
  const host = document.createElement('div'); host.id = 'gh0st-gl3-wallet-control';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/gh0st-network-wallet.css';
  shadow.append(style);
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const dock = element('div', null, 'dock'), open = element('button', '[· ·]  Add GL3', 'open'), hide = element('button', '×', 'hide');
  open.type = hide.type = 'button'; open.setAttribute('aria-haspopup', 'dialog'); hide.setAttribute('aria-label', 'Hide the GL3 network button on this page');
  dock.append(open, hide); shadow.append(dock);
  const veil = element('div', null, 'veil'); veil.hidden = true;
  const panel = element('section', null, 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Add GH0ST GL3 to your wallet'); panel.tabIndex = -1;
  const head = element('div', null, 'head'), title = element('h2', 'GH0ST GL3'), close = element('button', '×', 'close'); close.type = 'button'; close.setAttribute('aria-label', 'Close network settings'); head.append(title, close); panel.append(head);
  panel.append(element('p', 'Add the network, then use GH0ST for gas. Your wallet asks for approval; this page never requests funds or a signature.', 'muted'));
  const label = element('label', 'Choose your wallet'); label.htmlFor = 'gl3-wallet-choice';
  const select = element('select'); select.id = 'gl3-wallet-choice'; select.setAttribute('aria-label', 'Choose your wallet'); panel.append(label, select);
  const switchLabel = element('label', null, 'switch'), switchBox = element('input'); switchBox.type = 'checkbox'; switchBox.checked = true; switchLabel.append(switchBox, document.createTextNode('Switch to GL3 after adding')); panel.append(switchLabel);
  const add = element('button', 'Add network', 'action'); add.type = 'button'; add.disabled = true; panel.append(add);
  const status = element('p', '', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.append(status);
  const details = element('textarea', null, 'details'); details.readOnly = true; details.rows = 6; details.value = networkDetails(); details.setAttribute('aria-label', 'GL3 network details'); panel.append(details);
  const copy = element('button', 'Copy network details', 'copy'); copy.type = 'button'; panel.append(copy); veil.append(panel); shadow.append(veil); document.body.append(host);
  let candidates = [], discovery, timer, busy = false, hiddenByVisitor = false;
  const showCandidates = list => {
    candidates = list; select.replaceChildren();
    if (list.length !== 1) { const option = element('option', list.length ? 'Select a wallet…' : 'No wallet detected'); option.value = ''; select.append(option); }
    list.forEach((wallet, i) => { const option = element('option', wallet.name); option.value = String(i); select.append(option); });
    select.value = list.length === 1 ? '0' : ''; add.disabled = busy || !list.length || select.value === '';
  };
  const closePanel = () => { veil.hidden = true; discovery?.close(); clearTimeout(timer); open.focus(); };
  open.addEventListener('click', () => {
    veil.hidden = false; status.textContent = 'Looking for browser wallets…'; showCandidates([]); panel.focus();
    discovery?.close(); clearTimeout(timer); discovery = discoverWallets(window);
    timer = setTimeout(() => { showCandidates(discovery.providers()); discovery.close(); status.textContent = candidates.length ? 'Review the details, then approve in your selected wallet.' : 'Install a browser wallet, or copy these details into your wallet app.'; }, 200);
  });
  close.addEventListener('click', closePanel); veil.addEventListener('click', event => { if (event.target === veil) closePanel(); });
  hide.addEventListener('click', () => { hiddenByVisitor = true; dock.hidden = true; });
  select.addEventListener('change', () => { add.disabled = busy || select.value === ''; });
  add.addEventListener('click', async () => {
    if (busy || select.value === '' || !candidates[Number(select.value)]) return;
    busy = true; add.disabled = true; select.disabled = true; status.textContent = 'Approve the network request in your wallet.';
    try { const result = await addNetwork(candidates[Number(select.value)].provider, switchBox.checked); status.textContent = result.message; }
    finally { busy = false; add.disabled = select.value === ''; select.disabled = false; }
  });
  copy.addEventListener('click', async () => {
    try { await window.navigator.clipboard.writeText(networkDetails()); status.textContent = 'Network details copied.'; }
    catch { details.focus(); details.select(); status.textContent = 'The details are selected. Copy them into your wallet.'; }
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button,select,input,textarea')].filter(node => !node.disabled);
      const first = controls[0], last = controls[controls.length - 1], active = shadow.activeElement;
      if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
  });
  // Avoid covering the visitor's active page form. This never hides the modal.
  const formFocus = () => { const active = document.activeElement; dock.hidden = hiddenByVisitor || Boolean(active && active !== host && active.matches?.('input,textarea,select,[contenteditable="true"]')); };
  document.addEventListener('focusin', formFocus); document.addEventListener('focusout', () => setTimeout(formFocus, 0));
}

if (typeof window !== 'undefined' && window.document) {
  if (window.document.readyState === 'loading') window.document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
}
