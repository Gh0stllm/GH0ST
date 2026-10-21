import { initHero } from './hero.js';
import { createMintController, describeWalletError, formatGH0ST } from './wallet.js';

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(3, '0');
const shortAddress = value => value.slice(0, 6) + '…' + value.slice(-4);
const nf = new Intl.NumberFormat('en-US');
const BURN = 200000000000000000000000n;
const COLORS = { Cyan:'#00dce7',Emerald:'#36f5a2',Amber:'#ffbf47',Violet:'#b49aff',Ice:'#a0ddff',Rose:'#ff91c4',Lime:'#c4f66d',Cobalt:'#659dff',Pearl:'#d3e7f5' };
const PAGE_SIZE = 36;
let collection = [], config = null, selected = null, page = 0, filtered = [];
let controller = null, publicController = null, walletState = null, publicState = null;
let hero = null, manualPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let selectionRequest = 0, galleryRequest = 0, toastTimer = 0, lastConfirmedHash = null;
let artworkStatus = 'awaiting-deployment';
const availability = new Map();

function toast(message) {
  $('toast-text').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
$('toast-close').onclick = () => { $('toast').hidden = true; clearTimeout(toastTimer); };

async function json(file) {
  const r = await fetch(file, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Error('The Genesis collection could not be loaded. Please refresh.');
  return r.json();
}

function motionLabel() {
  const button = $('motion-toggle');
  button.setAttribute('aria-pressed', String(manualPaused));
  button.setAttribute('aria-label', manualPaused ? 'Resume character animation' : 'Pause character animation');
  button.textContent = (manualPaused ? '▷  MOTION OFF' : 'Ⅱ  MOTION ON');
}
motionLabel();
$('motion-toggle').onclick = () => {
  manualPaused = !manualPaused;
  manualPaused ? hero?.pause() : hero?.resume();
  motionLabel();
};

function updateProvenance(item) {
  $('record-id').textContent = '#' + pad(item.id);
  $('record-shard-index').textContent = String(item.id - 1).padStart(5, '0') + ' / 00494';
  $('record-shard').textContent = shortAddress(item.shardAddress) + ' ↗';
  $('record-shard').href = config.explorer + '/address/' + item.shardAddress;
  $('record-shard').title = item.shardAddress;
  $('record-range').textContent = nf.format(item.payloadOffset) + '–' + nf.format(item.payloadOffset + item.payloadLength - 1) + ' bytes';
  $('record-hash').textContent = item.runtimeCodeHash;
  $('record-metadata').href = 'https://ipfs.io/ipfs/' + item.metadataIPFS.slice(7);
}

function selectPiece(id, scroll = false) {
  const item = collection.find(x => x.id === Number(id));
  if (!item) return;
  selected = item;
  $('selected-art').src = item.imageLocal;
  $('selected-art').alt = item.name + ', ' + item.expression + ' ' + item.face + ', ' + item.accent + ' / ' + item.signal;
  $('piece-number').textContent = pad(item.id) + ' / 495';
  $('piece-face').textContent = item.face;
  $('piece-expression').textContent = item.expression.toUpperCase();
  $('selected-name').textContent = 'Genesis #' + pad(item.id);
  $('trait-expression').textContent = item.expression;
  $('trait-accent').textContent = item.accent;
  $('trait-accent').style.color = COLORS[item.accent];
  $('trait-signal').textContent = item.signal;
  $('hero-id').textContent = 'SIGNAL #' + pad(item.id);
  hero?.setArtwork(item);
  updateProvenance(item);
  document.querySelectorAll('.art-card').forEach(card => {
    const active = Number(card.dataset.id) === item.id;
    card.classList.toggle('selected', active);
    card.setAttribute('aria-pressed', String(active));
  });
  const url = new URL(location.href);
  url.searchParams.set('piece', String(item.id));
  history.replaceState(null, '', url);
  artworkStatus = config.nftAddress && config.expectedNFTCodeHash ? 'checking' : 'awaiting-deployment';
  renderWallet();
  checkSelectedAvailability();
  if (scroll) $('mint').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start' });
}

function resetFilters() {
  $('search-art').value = '';
  $('filter-expression').value = '';
  $('filter-accent').value = '';
  filterCollection();
}

function filterCollection() {
  const q = $('search-art').value.trim().toLowerCase().replace(/^#/, '');
  const expression = $('filter-expression').value;
  const accent = $('filter-accent').value;
  const numeric = /^\d+$/.test(q);
  filtered = collection.filter(item => (!expression || item.expression === expression) && (!accent || item.accent === accent) &&
    (!q || (numeric ? item.id === Number(q) : (item.name + ' ' + item.expression + ' ' + item.accent + ' ' + item.signal + ' ' + item.face).toLowerCase().includes(q))));
  page = 0;
  renderGallery();
}

function renderGallery() {
  const grid = $('gallery-grid');
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const nodes = slice.map(item => {
    const button = document.createElement('button');
    button.className = 'art-card' + (item.id === selected?.id ? ' selected' : '');
    button.dataset.id = item.id;
    button.setAttribute('aria-pressed', String(item.id === selected?.id));
    button.setAttribute('aria-label', 'Select ' + item.name + ', ' + item.expression + ', ' + item.accent + ', ' + item.signal);
    const image = document.createElement('img');
    image.src = item.imageLocal;
    image.alt = item.face + ' — ' + item.expression + ', ' + item.accent + ' / ' + item.signal;
    image.className = 'card-art';
    image.loading = 'lazy'; image.decoding = 'async'; image.width = 1280; image.height = 1280;
    const info = document.createElement('div'); info.className = 'card-info';
    const top = document.createElement('div'); top.className = 'card-top';
    const id = document.createElement('span'); id.className = 'card-id'; id.textContent = '#' + pad(item.id);
    const status = document.createElement('span'); status.className = 'card-status'; status.dataset.statusId = item.id;
    const cached = availability.get(item.id);
    status.textContent = cached?.status === 'minted' ? 'MINTED' : cached?.status === 'available' ? 'AVAILABLE' : config.nftAddress ? 'CHECKING' : 'VIEW PIECE';
    top.append(id, status);
    const name = document.createElement('span'); name.className = 'card-expression'; name.textContent = item.expression;
    const traits = document.createElement('span'); traits.className = 'card-traits';
    const dot = document.createElement('i'); dot.className = 'card-accent-dot'; dot.style.backgroundColor = COLORS[item.accent];
    traits.append(dot, document.createTextNode(item.accent + ' / ' + item.signal));
    info.append(top, name, traits); button.append(image, info);
    button.onclick = () => selectPiece(item.id, true);
    return button;
  });
  grid.replaceChildren(...nodes);
  grid.hidden = !slice.length;
  $('gallery-empty').hidden = Boolean(slice.length);
  const start = slice.length ? page * PAGE_SIZE + 1 : 0, end = Math.min((page + 1) * PAGE_SIZE, filtered.length);
  $('gallery-count').textContent = 'SHOWING ' + start + '–' + end + ' OF ' + filtered.length + ' ORIGINALS';
  $('gallery-page').textContent = 'PAGE ' + String(page + 1).padStart(2,'0') + ' / ' + String(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))).padStart(2,'0');
  $('gallery-prev').disabled = page === 0;
  $('gallery-next').disabled = (page + 1) * PAGE_SIZE >= filtered.length;
  checkGalleryAvailability(slice);
}

function readController() { return publicController || (walletState?.connected && walletState.chainId === 4663 ? controller : null); }

async function checkSelectedAvailability() {
  const id = selected?.id, request = ++selectionRequest;
  const reader = readController();
  if (!id || !reader || !walletState?.configured) return;
  try {
    const result = await reader.tokenStatus(id);
    availability.set(id, { ...result, at: Date.now() });
    if (request !== selectionRequest || selected?.id !== id) return;
    artworkStatus = result.status;
  } catch {
    if (request !== selectionRequest) return;
    artworkStatus = 'unknown';
  }
  renderWallet();
}

async function checkGalleryAvailability(items) {
  const request = ++galleryRequest, reader = readController();
  if (!reader || !walletState?.configured) return;
  let next = 0;
  await Promise.allSettled(Array.from({length:3}, async () => {
    while (next < items.length && request === galleryRequest) {
      const item = items[next++];
      let result = availability.get(item.id);
      if (!result || Date.now() - result.at > 20000) {
        try { result = { ...await reader.tokenStatus(item.id), at:Date.now() }; availability.set(item.id,result); }
        catch { result = { status:'unknown' }; }
      }
      if (request !== galleryRequest) return;
      const node = document.querySelector('[data-status-id="' + item.id + '"]');
      if (node) node.textContent = result.status === 'minted' ? 'MINTED' : result.status === 'available' ? 'AVAILABLE' : 'UNCONFIRMED';
    }
  }));
}

function renderWallet() {
  const s = walletState;
  if (!s) return;
  const pending = ['pending','uncertain','awaiting-signature'].includes(s.phase);
  const wrongChain = s.chainId !== null && s.chainId !== 4663;
  const accountLabel = document.querySelector('[data-wallet-label]');
  accountLabel.textContent = s.connected ? shortAddress(s.account) : s.busy ? 'Connecting…' : 'Connect wallet';
  const headerWallet = document.querySelector('.wallet-button');
  headerWallet.setAttribute('aria-label', s.connected ? 'Disconnect wallet ' + shortAddress(s.account) : 'Connect wallet');
  headerWallet.title = s.connected ? 'Disconnect wallet' : 'Connect an Ethereum-compatible wallet';
  headerWallet.lastElementChild.textContent = s.connected ? '×' : '↗';
  document.querySelectorAll('[data-connect]').forEach(b => { b.disabled = s.busy; });
  $('mint-connect').hidden = s.connected || wrongChain;
  $('switch-network').hidden = !wrongChain;
  $('switch-network').disabled = s.busy;
  $('wallet-quota').textContent = s.mintedBy === null ? '—' : String(s.mintedBy);
  $('wallet-balance').textContent = s.balance === null ? s.connected ? 'Unavailable on this network' : 'Connect to view' : formatGH0ST(s.balance);
  const totals = s.totalMinted ?? publicState?.totalMinted;
  $('collection-minted').textContent = totals === null || totals === undefined ? '—' : nf.format(totals);
  const launch = !s.configured ? 'MINT AWAITING DEPLOYMENT' : (s.verified || publicState?.verified) ? totals === 495 ? 'GENESIS FULLY MINTED' : 'PUBLIC MINT OPEN' : 'VERIFYING DEPLOYMENT';
  document.querySelectorAll('[data-launch-label]').forEach(el => { el.textContent = launch; });
  $('mint-availability').textContent = !s.configured ? 'DEPLOYMENT PENDING' : artworkStatus === 'available' ? 'RANDOM MINT / PREVIEW ONLY' : artworkStatus === 'minted' ? 'PREVIEW MINTED / RANDOM MINT AVAILABLE' : 'RANDOM MINT / PREVIEW ONLY';
  $('mint-status-mark').textContent = '/ ' + (s.connected ? 'CONNECTED' : '001');
  const hasApproval = s.allowance !== null && BigInt(s.allowance) >= BURN;
  const enoughBalance = s.balance !== null && BigInt(s.balance) >= BURN;
  const hasQuota = s.remaining !== null && s.remaining > 0;
  const enabled = s.configured && s.connected && s.verified && !wrongChain && !s.busy && !pending && enoughBalance && hasQuota && (s.totalMinted ?? publicState?.totalMinted ?? 495) < 495;
  $('approve-button').hidden = !s.configured || !s.connected || wrongChain || hasApproval;
  $('approve-button').disabled = !enabled;
  $('mint-button').disabled = !enabled || !hasApproval;
  let mintLabel = !s.configured ? 'Mint awaiting deployment' : s.busy ? s.phase === 'awaiting-signature' ? 'Review your wallet' : s.phase === 'pending' ? 'Confirming transaction…' : 'Verifying…' : pending ? 'Confirmation pending' : !s.connected ? 'Connect to mint' : wrongChain ? 'Switch network to mint' : !s.verified ? 'Verify deployment to mint' : !hasQuota ? 'Three-mint limit reached' : !enoughBalance ? '200,000 GH0ST required' : !hasApproval ? 'Approve GH0ST first' : 'Burn 200,000 GH0ST & mint random';
  $('mint-button').textContent = mintLabel + (enabled && hasApproval ? '  ↗' : '');
  $('refresh-transaction').hidden = !s.configured || !['pending','uncertain','reverted'].includes(s.phase);
  $('refresh-transaction').disabled = s.busy;
  $('transaction-recovery').hidden = !s.configured || !['pending','uncertain'].includes(s.phase);
  $('resolve-transaction').disabled = s.busy;
  const status = $('transaction-status');
  status.classList.toggle('error', Boolean(s.error));
  status.classList.toggle('success', s.phase === 'confirmed' && !s.error);
  status.textContent = s.error || (!s.configured ? 'Explore the collection now. Minting will open after the NFT contract is deployed and verified.' : s.message);
  $('transaction-link').hidden = !s.txHash;
  if (s.txHash) $('transaction-link').href = config.explorer + '/tx/' + s.txHash;
  if (s.configured) $('faq-launch').textContent = 'Public minting is live on Robinhood Chain. This page verifies the configured contract’s runtime and fixed settings before enabling approvals or mints. Your wallet must be on Robinhood Chain (4663). A random available artwork is assigned by this page when you mint. Browsing does not reserve or select your mint. This is browser randomness, not contract-enforced randomness.';
}

function walletChanged(state) {
  const previous = walletState;
  walletState = state;
  renderWallet();
  if (!previous?.verified && state.verified || !previous?.connected && state.connected) checkSelectedAvailability();
  if (state.phase === 'confirmed' && state.txHash && state.txHash !== lastConfirmedHash) {
    lastConfirmedHash = state.txHash;
    if (state.txKind === 'mint') {
      if (state.lastMintedId) { availability.set(state.lastMintedId,{status:'minted',at:Date.now()}); selectPiece(state.lastMintedId); }
      toast('Genesis #' + pad(state.lastMintedId || selected.id) + ' minted. Welcome to the beginning.');
      checkSelectedAvailability();
      renderGallery();
    } else toast('Approval confirmed. You can now burn & mint a random original.');
  }
}

async function action(fn) {
  try { await fn(); }
  catch(error) { toast(describeWalletError(error)); }
}

function readOnlyProvider(endpoint) {
  let rpcId = 0;
  return { async request({method,params=[]}) {
    if (method === 'eth_accounts') return [];
    if (!['eth_chainId','eth_blockNumber','eth_getCode','eth_getStorageAt','eth_call','eth_getTransactionReceipt'].includes(method)) throw Error('This connection is read-only.');
    const id = ++rpcId;
    const response = await fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Network data is temporarily unavailable.');
    const body = await response.json();
    if (body.id !== id || body.error || body.result === undefined) {
      const error = Error(body.error?.message || 'Network response could not be verified.');
      if (body.error) Object.assign(error,body.error);
      throw error;
    }
    return body.result;
  } };
}

async function boot() {
  [collection,config] = await Promise.all([json('data/collection.json'),json('data/config.json')]);
  if (!Array.isArray(collection) || collection.length !== 495 || new Set(collection.map(x=>x.id)).size !== 495) throw Error('The Genesis edition could not be verified.');
  const proofs = await json('data/shard-proofs.json');
  hero = initHero($('genesisHero'));
  if ($('genesisHero').dataset.renderer) document.querySelector('.hero-stage').classList.add('loaded');
  if (manualPaused) hero.pause();
  for (const [field,key] of [['filter-expression','expression'],['filter-accent','accent']]) {
    const choices = [...new Set(collection.map(x=>x[key]))].sort();
    choices.forEach(value => { const option=document.createElement('option');option.value=value;option.textContent=value;$(field).append(option); });
  }
  controller = createMintController({config,proofs,onState:walletChanged});
  if (walletState.configured) {
    publicController = createMintController({config,proofs,provider:readOnlyProvider(config.publicRPC),storage:{getItem(){return null;},setItem(){},removeItem(){}},onState:s=>{ publicState=s;renderWallet(); }});
  }
  const initial = Number(new URL(location.href).searchParams.get('piece'));
  selectPiece(initial >= 1 && initial <= 495 && Number.isInteger(initial) ? initial : 71);
  filtered = [...collection]; renderGallery();
  $('previous-piece').onclick = () => selectPiece(selected.id === 1 ? 495 : selected.id - 1);
  $('next-piece').onclick = () => selectPiece(selected.id === 495 ? 1 : selected.id + 1);
  $('random-piece').onclick = () => { const values=new Uint32Array(1);crypto.getRandomValues(values);selectPiece(((selected.id + 1 + values[0] % 494) - 1) % 495 + 1); };
  for (const field of ['search-art','filter-expression','filter-accent']) $(field).addEventListener(field === 'search-art' ? 'input' : 'change',filterCollection);
  $('reset-filters').onclick = resetFilters; $('clear-search').onclick = resetFilters;
  $('gallery-prev').onclick = () => {if(page>0){page--;renderGallery();document.querySelector('.gallery-controls').scrollIntoView({behavior:'auto',block:'start'});}};
  $('gallery-next').onclick = () => {if((page+1)*PAGE_SIZE<filtered.length){page++;renderGallery();document.querySelector('.gallery-controls').scrollIntoView({behavior:'auto',block:'start'});}};
  document.querySelectorAll('[data-connect]').forEach(button => { button.onclick=()=>action(async()=>{
    if (walletState.connected && button.classList.contains('wallet-button')) {controller.disconnect();toast('Wallet disconnected from this page.');}
    else {await controller.connect();checkSelectedAvailability();}
  }); });
  $('switch-network').onclick=()=>action(()=>controller.switchNetwork());
  $('approve-button').onclick=()=>action(()=>controller.approve());
  $('mint-button').onclick=()=>action(()=>controller.mintRandom());
  $('refresh-transaction').onclick=()=>action(async()=>{await controller.refresh();await checkSelectedAvailability();});
  $('resolve-transaction').onclick=()=>action(async()=>{
    const hash=$('replacement-hash').value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw Error('Paste the full updated transaction hash from your wallet.');
    await controller.resolveTransaction(hash);
    await checkSelectedAvailability();
  });
  if (publicController) {
    const refreshPublic = async()=>{try{await publicController.refresh();await checkSelectedAvailability();checkGalleryAvailability(filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE));}catch{renderWallet();}};
    refreshPublic();
    setInterval(()=>{if(document.visibilityState==='visible')refreshPublic();},30000);
  }
}

const progress = document.querySelector('.scroll-progress');
let scrollQueued = false;
addEventListener('scroll',()=>{if(!scrollQueued){scrollQueued=true;requestAnimationFrame(()=>{const max=document.documentElement.scrollHeight-innerHeight;progress.style.transform='scaleX('+(max>0?scrollY/max:0)+')';scrollQueued=false;});}},{passive:true});

boot().catch(error=>{
  console.error('Genesis initialization failed.',error);
  $('gallery-count').textContent='COLLECTION TEMPORARILY UNAVAILABLE';
  $('transaction-status').textContent='The collection could not be loaded. Please refresh before connecting a wallet.';
  document.querySelectorAll('[data-connect]').forEach(b=>{b.disabled=true;});
  toast('The collection could not be loaded. Please refresh.');
});
