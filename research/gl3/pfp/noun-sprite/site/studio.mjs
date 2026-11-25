const CHAIN_ID = '0x1237';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/';
const EXPLORER = 'https://robin.etherscan.io';
const MODEL_HASH = '0xff0ae8bbcea0dd9dfdc616197f6b2b6787d1fb80726e6b856cf29af38cb67651';
const MODEL = '0x1b2ccc09';
const GENERATE = '0x0565a8f8';
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const DATA = /^0x(?:[0-9a-f]{2})+$/i;
const SEED = /^0x[0-9a-f]{32}$/i;
const BITMAP = /^0x[0-9a-f]{512}$/i;
const MAX_UINT64 = (1n << 64n) - 1n;
const SUBJECTS = ['Ghost', 'Cat', 'Robot', 'Alien', 'Skull', 'Owl', 'Fox', 'Rocket', 'Planet', 'Mountain', 'Castle', 'Flower'];
const ALIASES = [
  ['ghost', 'spirit', 'gh0st', 'phantom'], ['cat', 'kitten', 'feline'], ['robot', 'android', 'droid'],
  ['alien', 'extraterrestrial', 'martian'], ['skull', 'skeleton'], ['owl', 'owlet'], ['fox', 'vixen'],
  ['rocket', 'spaceship', 'shuttle'], ['planet', 'saturn', 'world'], ['mountain', 'peak', 'alpine'],
  ['castle', 'fortress', 'palace'], ['flower', 'blossom', 'daisy'],
];
const MODIFIERS = ['Glow', 'Stars', 'Sparks', 'Frame', 'Halo', 'Emblem', 'Scanlines', 'Ivory'];
const MODIFIER_WORDS = [
  ['glow', 'glowing'], ['star', 'stars'], ['spark', 'sparks'], ['frame', 'framed'],
  ['halo'], ['emblem'], ['scanline', 'scanlines'], ['ivory'],
];
const PALETTE = [[9, 8, 12, 255], [234, 193, 138, 255], [244, 237, 225, 255]];
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const bytesOf = value => Uint8Array.from(value.slice(2).match(/../g), pair => Number.parseInt(pair, 16));
const word = value => value.toString(16).padStart(64, '0');
const selector = signature => keccak256('0x' + hex(new TextEncoder().encode(signature))).slice(0, 10);

const ROTATION = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const ROUND = [
  0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an,
  0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n,
];
const rotate = (lane, bits) => ((lane << BigInt(bits)) | (lane >> BigInt(64 - bits))) & MAX_UINT64;

// Keccak-256 uses Ethereum's 0x01 padding. Web Crypto's SHA-256 has a different domain.
export function keccak256(value) {
  const bytes = value === '0x' ? new Uint8Array() : bytesOf(value);
  const padded = new Uint8Array((Math.floor(bytes.length / 136) + 1) * 136);
  padded.set(bytes);
  padded[bytes.length] = 1;
  padded[padded.length - 1] |= 128;
  const a = new Array(25).fill(0n);
  const b = new Array(25);
  for (let block = 0; block < padded.length; block += 136) {
    for (let i = 0; i < 136; i++) a[i >> 3] ^= BigInt(padded[block + i]) << BigInt((i & 7) * 8);
    for (const rc of ROUND) {
      const c = a.slice(0, 5).map((_, x) => a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]);
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotate(c[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(a[x + 5 * y] ^ d, ROTATION[x + 5 * y]);
      }
      for (let i = 0; i < 25; i++) {
        const x = i % 5;
        a[i] = b[i] ^ (~b[i - x + (x + 1) % 5] & b[i - x + (x + 2) % 5]);
      }
      a[0] ^= rc;
    }
  }
  return '0x' + hex(Uint8Array.from({ length: 32 }, (_, i) => Number((a[i >> 3] >> BigInt((i & 7) * 8)) & 255n)));
}

const RECORD = selector('record(bytes16,uint8,uint8)');
const IMAGE_EVENT = keccak256('0x' + hex(new TextEncoder().encode('ImageGenerated(bytes16,uint8,uint8,bytes32)')));
const seedWord = seed => seed.slice(2).padEnd(64, '0');
const equal = (left, right) => typeof left === 'string' && left.toLowerCase() === right?.toLowerCase();

export function imageParameters(seed, subject, style) {
  if (!SEED.test(seed)) throw Error('Enter a seed with 32 hexadecimal digits after 0x.');
  if (!Number.isInteger(subject) || subject < 0 || subject >= SUBJECTS.length
      || !Number.isInteger(style) || style < 0 || style > 255) throw Error('The image parameters are invalid.');
  return { seed: seed.toLowerCase(), subject, style };
}

export function promptParameters(prompt) {
  const phrase = prompt.trim();
  const words = phrase.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const subject = words.map(value => ALIASES.findIndex(terms => terms.includes(value))).find(index => index >= 0);
  if (subject === undefined) throw Error('Include a supported subject, such as a cat, rocket, or flower.');
  const style = MODIFIER_WORDS.reduce((mask, terms, bit) => mask | (terms.some(term => words.includes(term)) ? 1 << bit : 0), 0);
  const seed = keccak256('0x' + hex(new TextEncoder().encode(phrase))).slice(0, 34);
  return imageParameters(seed, subject, style);
}

export function calldata(params, record = false) {
  const { seed, subject, style } = imageParameters(params.seed, params.subject, params.style);
  return (record ? RECORD : GENERATE) + seedWord(seed) + word(subject) + word(style);
}

export function decodeResult(result) {
  const prefix = '0x' + word(32) + word(256);
  if (typeof result !== 'string' || !result.startsWith(prefix) || !BITMAP.test('0x' + result.slice(prefix.length))) {
    throw Error('The model did not return a 32×32 image.');
  }
  return '0x' + result.slice(prefix.length).toLowerCase();
}

export function unpackImage(bitmap) {
  if (!BITMAP.test(bitmap)) throw Error('The model returned an invalid bitmap.');
  const pixels = bytesOf(bitmap);
  const image = new Uint8ClampedArray(32 * 32 * 4);
  for (let index = 0; index < 1024; index++) {
    const color = PALETTE[(pixels[index >> 2] >> ((index & 3) * 2)) & 3];
    if (!color) throw Error('The model returned an invalid pixel.');
    image.set(color, index * 4);
  }
  return image;
}

export function matchesProof(receipt, pending) {
  return equal(receipt?.transactionHash, pending.hash) && receipt.status === '0x1' && Array.isArray(receipt.logs)
    && receipt.logs.some(log => equal(log.address, pending.contract) && equal(log.data, pending.commitment)
      && log.topics?.length === 4 && [IMAGE_EVENT, '0x' + seedWord(pending.seed), '0x' + word(pending.subject), '0x' + word(pending.style)]
        .every((topic, index) => equal(log.topics[index], topic)));
}

let rpcId = 0;
async function rpc(method, params) {
  const id = ++rpcId;
  const response = await fetch(RPC_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Robinhood RPC is unavailable. Try again shortly.');
  const message = await response.json();
  if (message.id !== id || message.error || !Object.hasOwn(message, 'result')) {
    const error = Error('Robinhood RPC could not complete the request.');
    error.data = message.error?.data;
    throw error;
  }
  return message.result;
}

const assets = new Map();
function asset(name) {
  if (!assets.has(name)) {
    assets.set(name, fetch(new URL(name, import.meta.url)).then(response => {
      if (!response.ok) throw Error('Studio could not load its configuration.');
      return response.json();
    }));
  }
  return assets.get(name);
}

async function robinhoodWallet() {
  const wallet = window.ethereum;
  if (!wallet?.request) throw Error('Open Image Studio in a browser with an Ethereum wallet.');
  const [from] = await wallet.request({ method: 'eth_requestAccounts' });
  if (!ADDRESS.test(from)) throw Error('Choose a wallet account first.');
  if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN_ID) {
    try {
      await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_ID, chainName: 'Robinhood Chain',
        rpcUrls: [RPC_URL], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [EXPLORER] }] });
    }
  }
  if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN_ID) throw Error('Switch your wallet to Robinhood Chain.');
  return { wallet, from };
}

function studio() {
  const byId = id => document.getElementById(id);
  const form = byId('generator');
  const subjectInput = byId('subject');
  const seedInput = byId('seed');
  const generate = byId('generate');
  const record = byId('record');
  const proof = byId('proof');
  const status = byId('status');
  const canvas = byId('avatar');
  const context = canvas.getContext('2d');
  const small = document.createElement('canvas');
  small.width = small.height = 32;
  const smallContext = small.getContext('2d');
  const storageKey = 'gh0st-original-pending:' + MODEL_HASH.slice(2);
  let contract = null;
  let rendered = null;
  let pending = null;
  let busy = false;

  SUBJECTS.forEach((name, index) => subjectInput.add(new Option(name, index)));
  const toggles = MODIFIERS.map(name => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, name);
    byId('modifiers').append(label);
    return input;
  });

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function selected() {
    const style = toggles.reduce((value, element, bit) => value | (element.checked ? 1 << bit : 0), 0);
    return imageParameters(seedInput.value.trim(), Number(subjectInput.value), style);
  }

  function updateForm() {
    generate.disabled = busy || !contract;
    record.textContent = pending ? 'Check transaction' : 'Record on Robinhood';
    let matches = false;
    try {
      const params = selected();
      matches = rendered?.verified && rendered.seed === params.seed && rendered.subject === params.subject
        && rendered.style === params.style;
    } catch { /* Leave the form editable so the user can correct the seed. */ }
    record.disabled = busy || !contract || (!pending && !matches);
  }

  function setForm(params) {
    seedInput.value = params.seed;
    subjectInput.value = String(params.subject);
    toggles.forEach((element, bit) => { element.checked = Boolean(params.style & (1 << bit)); });
    updateForm();
  }

  function render(params, bitmap, verified) {
    smallContext.putImageData(new ImageData(unpackImage(bitmap), 32, 32), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(small, 0, 0, canvas.width, canvas.height);
    rendered = { ...params, verified, commitment: keccak256(bitmap) };
    byId('image-subject').textContent = SUBJECTS[params.subject];
    const modifiers = MODIFIERS.filter((_, bit) => params.style & (1 << bit));
    byId('style-code').textContent = modifiers.length ? `${modifiers.length} ${modifiers.length === 1 ? 'modifier' : 'modifiers'}` : 'Plain';
    byId('style-code').title = modifiers.join(', ');
    byId('image-source').textContent = verified ? 'ROBINHOOD CONTRACT' : 'MODEL SAMPLE';
    canvas.setAttribute('aria-label', '32 by 32 pixel art of a ' + SUBJECTS[params.subject].toLowerCase());
    byId('download').disabled = byId('share').disabled = false;
  }

  function showProof(hash, label) {
    proof.hidden = false;
    proof.href = EXPLORER + '/tx/' + hash;
    proof.textContent = label;
  }

  function storePending(value) {
    pending = value;
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch { /* A receipt can still be checked within the open page. */ }
  }

  async function reconcile(tries) {
    for (let i = 0; i < tries; i++) {
      const receipt = await rpc('eth_getTransactionReceipt', [pending.hash]);
      if (receipt) {
        const transaction = pending;
        storePending(null);
        if (receipt.status === '0x0') throw Error('The transaction reverted. Check the explorer for details.');
        if (!matchesProof(receipt, transaction)) throw Error('The receipt did not contain the expected image proof.');
        showProof(transaction.hash, 'View verified image proof');
        setStatus('Image recorded. The receipt matches this image and its parameters.');
        return;
      }
      if (i + 1 < tries) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    setStatus('The transaction is pending. Check it here or in the explorer.');
  }

  form.addEventListener('input', updateForm);
  form.addEventListener('change', updateForm);
  byId('apply-prompt').addEventListener('click', () => {
    try {
      setForm(promptParameters(byId('prompt').value));
      setStatus('Parameters set from your prompt.');
      if (contract) form.requestSubmit();
    } catch (error) { setStatus(error.message, true); }
  });
  byId('prompt').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); byId('apply-prompt').click(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !contract) return;
    busy = true;
    updateForm();
    setStatus('Running a free on-chain preview…');
    try {
      const params = selected();
      const output = await rpc('eth_call', [{ to: contract, data: calldata(params) }, 'latest']);
      render(params, decodeResult(output), true);
      if (!pending) proof.hidden = true;
      setStatus('Preview ready. Recording the image hash uses one wallet transaction.');
    } catch (error) { setStatus(error.message, true); }
    finally { busy = false; updateForm(); }
  });

  byId('random').addEventListener('click', () => {
    seedInput.value = '0x' + hex(crypto.getRandomValues(new Uint8Array(16)));
    updateForm();
    seedInput.focus();
  });
  byId('download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'gh0st-sprite-' + rendered.seed.slice(2) + '.png';
    link.click();
  });
  byId('share').addEventListener('click', async () => {
    const url = new URL(location.href);
    const { seed, subject, style } = rendered;
    url.search = new URLSearchParams({ seed, subject, style }).toString();
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus('Sprite link copied.');
    } catch { setStatus('Clipboard unavailable. Image seed ' + seed + '.'); }
  });

  record.addEventListener('click', async () => {
    if (busy || !contract || record.disabled) return;
    busy = true;
    updateForm();
    try {
      if (pending) { await reconcile(1); return; }
      const sprite = rendered;
      const { wallet, from } = await robinhoodWallet();
      setStatus('Review the image transaction in your wallet. Robinhood gas is paid in ETH.');
      const hash = await wallet.request({ method: 'eth_sendTransaction',
        params: [{ from, to: contract, data: calldata(sprite, true), value: '0x0' }] });
      if (!HASH.test(hash)) throw Error('The wallet did not return a transaction hash. Check wallet activity.');
      storePending({ contract, hash, ...sprite });
      showProof(hash, 'View submitted transaction');
      setStatus('Waiting for the Robinhood receipt…');
      await reconcile(18);
    } catch (error) { setStatus(error.code === 4001 ? 'Wallet request declined.' : error.message, true); }
    finally { busy = false; updateForm(); }
  });

  async function boot() {
    try {
      const sample = await asset('./sample.json');
      const params = imageParameters(sample.seed, sample.subject, sample.style);
      setForm(params);
      render(params, sample.bitmap, false);
      let shared = false;
      const query = new URLSearchParams(location.search);
      if (['seed', 'subject', 'style'].every(key => query.has(key))) {
        try {
          setForm(imageParameters(query.get('seed'), Number(query.get('subject')), Number(query.get('style'))));
          shared = true;
        } catch { /* An invalid shared link can still open the sample. */ }
      }
      const deployment = await asset('./deployment.json');
      if (deployment.contract === null) {
        setStatus('Model sample loaded. The Robinhood deployment is pending.');
        return;
      }
      if (deployment.chainId !== 4663 || deployment.modelHash !== MODEL_HASH || !ADDRESS.test(deployment.contract)
          || !Array.isArray(deployment.rpcUrls) || deployment.rpcUrls.length !== 1 || deployment.rpcUrls[0] !== RPC_URL) {
        throw Error('The configured deployment does not match this model.');
      }
      const [network, code, model] = await Promise.all([
        rpc('eth_chainId', []), rpc('eth_getCode', [deployment.contract, 'latest']),
        rpc('eth_call', [{ to: deployment.contract, data: MODEL }, 'latest']),
      ]);
      if (network !== CHAIN_ID || !DATA.test(code) || !equal(model, MODEL_HASH)) throw Error('The deployed model could not be verified.');
      contract = deployment.contract;
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (saved?.contract === contract && HASH.test(saved.hash) && HASH.test(saved.commitment)) {
          pending = { ...saved, ...imageParameters(saved.seed, saved.subject, saved.style) };
          showProof(pending.hash, 'View submitted transaction');
        }
      } catch { /* An invalid local record leaves the generator available. */ }
      setStatus(pending ? 'A submitted transaction is ready to check.' : 'Robinhood model verified. Preview a sprite to start.');
      updateForm();
      if (shared) form.requestSubmit();
    } catch (error) { setStatus(error.message, true); }
  }
  boot();
}

const ANIMAL_MODEL_ID = '0xa3d27bb2b903ac80d15fdb97379623d9c2a80e93f8b6c19c5b3f314661afd41d';
const ANIMAL_SEED = /^0x[0-9a-f]{16}$/i;
const ANIMAL_SIZE = 48;
const ANIMAL_BYTES = ANIMAL_SIZE ** 2 * 4;
const ANIMAL_GENERATE = selector('generate(string,uint64)');
const ANIMAL_RECORD = selector('generateAndRecord(string,uint64)');
const ANIMAL_ID = selector('modelId()');
const ANIMAL_COMMITMENT = selector('codeCommitment()');
const ANIMAL_UNKNOWN = selector('NoKnownNoun()');
const ANIMAL_EVENT = keccak256('0x' + hex(new TextEncoder().encode('SpriteGenerated(address,bytes32,uint64,bytes32)')));
const animalPromptBytes = prompt => new TextEncoder().encode(prompt);

export function animalParameters(prompt, seed) {
  if (typeof prompt !== 'string' || !prompt.trim() || animalPromptBytes(prompt).length > 160) {
    throw Error('Enter a prompt up to 160 bytes.');
  }
  if (!ANIMAL_SEED.test(seed)) throw Error('Enter a seed with 16 hexadecimal digits after 0x.');
  return { prompt, seed: seed.toLowerCase() };
}

export function animalCalldata(parameters, record = false) {
  const { prompt, seed } = animalParameters(parameters.prompt, parameters.seed);
  const bytes = animalPromptBytes(prompt);
  const body = hex(bytes).padEnd(64 * Math.ceil(bytes.length / 32), '0');
  return (record ? ANIMAL_RECORD : ANIMAL_GENERATE) + word(64) + word(BigInt(seed)) + word(bytes.length) + body;
}

function checkAnimalPixels(pixels) {
  if (!DATA.test(pixels) || pixels.length !== 2 + ANIMAL_BYTES * 2) throw Error('The model did not return a 48×48 image.');
  return pixels.toLowerCase();
}

export function decodeAnimal(result) {
  const prefix = '0x' + word(32) + word(ANIMAL_BYTES);
  if (typeof result !== 'string' || !result.startsWith(prefix)) throw Error('The model did not return a 48×48 image.');
  return checkAnimalPixels('0x' + result.slice(prefix.length));
}

export function animalFactoryChild(factory) {
  if (!ADDRESS.test(factory)) throw Error('The factory address is invalid.');
  // RLP([factory, 9]) for the ninth contract created by the atomic factory.
  return '0x' + keccak256('0xd694' + factory.slice(2) + '09').slice(-40);
}

export function matchesAnimalProof(receipt, pending) {
  const promptHash = keccak256('0x' + hex(animalPromptBytes(pending.prompt)));
  const senderTopic = '0x' + pending.from.slice(2).padStart(64, '0');
  return equal(receipt?.transactionHash, pending.hash) && receipt.status === '0x1' && Array.isArray(receipt.logs)
    && receipt.logs.some(log => equal(log.address, pending.contract)
      && equal(log.data, '0x' + word(BigInt(pending.seed)) + pending.pixelsHash.slice(2))
      && log.topics?.length === 3 && [ANIMAL_EVENT, senderTopic, promptHash].every((topic, i) => equal(log.topics[i], topic)));
}

async function verifyAnimalDeployment(config) {
  if (config.chainId !== 4663 || !equal(config.modelId, ANIMAL_MODEL_ID) || !ADDRESS.test(config.contract)
      || !ADDRESS.test(config.factory) || !equal(animalFactoryChild(config.factory), config.contract)
      || ![config.transactionHash, config.blockHash, config.codeCommitment, config.runtimeCodeHash].every(value => HASH.test(value))) {
    throw Error('The animal model deployment configuration is incomplete.');
  }
  const queries = [
    rpc('eth_chainId', []),
    rpc('eth_getCode', [config.contract, 'latest']),
    rpc('eth_getTransactionReceipt', [config.transactionHash]),
    ...[ANIMAL_ID, ANIMAL_COMMITMENT].map(data => rpc('eth_call', [{ to: config.contract, data }, 'latest'])),
  ];
  const [chainId, code, receipt, modelId, commitment] = await Promise.all(queries);
  if (chainId !== CHAIN_ID || !DATA.test(code) || !equal(keccak256(code), config.runtimeCodeHash)
      || !equal(modelId, ANIMAL_MODEL_ID) || !equal(commitment, config.codeCommitment)
      || receipt?.status !== '0x1' || receipt.to != null || !equal(receipt.contractAddress, config.factory)
      || !equal(receipt.transactionHash, config.transactionHash) || !equal(receipt.blockHash, config.blockHash)
      || !/^0x[\da-f]+$/i.test(receipt.blockNumber)) throw Error('The Robinhood animal model could not be verified.');
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!equal(block?.hash, config.blockHash) || !block.transactions?.some(hash => equal(hash, config.transactionHash))) {
    throw Error('The Robinhood deployment receipt could not be verified.');
  }
  return config.contract;
}

function animalStudio(onVerified) {
  const node = id => document.getElementById('animal-' + id);
  const form = node('generator');
  const canvas = node('avatar');
  const context = canvas.getContext('2d');
  const promptInput = node('prompt');
  const seedInput = node('seed');
  const record = node('record');
  const proof = node('proof');
  const status = node('status');
  const storageKey = 'gh0st-animal-pending:' + ANIMAL_MODEL_ID.slice(2);
  let contract = null;
  let rendered = null;
  let pending = null;
  let busy = false;

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  function selected() { return animalParameters(promptInput.value, seedInput.value.trim()); }

  function refresh() {
    let matches = false;
    try {
      const params = selected();
      matches = rendered?.verified && params.prompt === rendered.prompt && params.seed === rendered.seed;
    } catch { /* Invalid parameters never enable a recording. */ }
    node('generate').disabled = busy || !contract;
    record.disabled = busy || !contract || (!pending && !matches);
    record.textContent = pending ? 'Check transaction' : 'Record on Robinhood';
  }

  function setForm(params) {
    promptInput.value = params.prompt;
    seedInput.value = params.seed;
    refresh();
  }

  function render(params, pixels, verified) {
    const rgba = new Uint8ClampedArray(bytesOf(checkAnimalPixels(pixels)));
    context.putImageData(new ImageData(rgba, ANIMAL_SIZE, ANIMAL_SIZE), 0, 0);
    rendered = { ...params, verified, pixelsHash: keccak256(pixels) };
    node('source').textContent = verified ? 'ROBINHOOD CONTRACT' : 'MODEL SAMPLE';
    node('seed-label').textContent = rendered.seed;
    canvas.setAttribute('aria-label', '48 by 48 sprite for ' + rendered.prompt);
    node('download').disabled = node('share').disabled = false;
  }

  function showProof(hash, label) {
    proof.href = EXPLORER + '/tx/' + hash;
    proof.textContent = label;
    proof.hidden = false;
  }

  function pendingTransaction(value) {
    pending = value;
    try {
      if (pending) sessionStorage.setItem(storageKey, JSON.stringify(pending));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The current tab can still check the receipt. */ }
  }

  async function reconcile(tries) {
    for (let i = 0; i < tries; i++) {
      const receipt = await rpc('eth_getTransactionReceipt', [pending.hash]);
      if (receipt) {
        const tx = pending;
        pendingTransaction(null);
        if (receipt.status === '0x0') throw Error('The transaction reverted. Check the explorer for details.');
        if (!matchesAnimalProof(receipt, tx)) throw Error('The receipt did not contain the expected sprite proof.');
        showProof(tx.hash, 'View verified sprite proof');
        setStatus('Sprite recorded. The receipt matches the prompt, seed and image.');
        return;
      }
      if (i + 1 < tries) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    setStatus('The transaction is pending. Check it here or in the explorer.');
  }

  form.addEventListener('input', refresh);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !contract) return;
    busy = true;
    refresh();
    setStatus('Running a free on-chain preview…');
    try {
      const params = selected();
      const output = await rpc('eth_call', [{ to: contract, data: animalCalldata(params) }, 'latest']);
      render(params, decodeAnimal(output), true);
      if (!pending) proof.hidden = true;
      setStatus('Preview ready. Recording publishes your prompt and seed in one Robinhood transaction.');
    } catch (error) {
      const data = typeof error.data === 'string' ? error.data : error.data?.data;
      setStatus(data?.toLowerCase?.().startsWith(ANIMAL_UNKNOWN) ? 'Name one of the supported animals and try again.' : error.message, true);
    } finally { busy = false; refresh(); }
  });

  node('random').addEventListener('click', () => {
    seedInput.value = '0x' + hex(crypto.getRandomValues(new Uint8Array(8)));
    refresh();
    seedInput.focus();
  });

  node('download').addEventListener('click', () => {
    if (!rendered) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'gh0st-animal-' + rendered.seed.slice(2) + '.png';
    link.click();
  });

  node('share').addEventListener('click', async () => {
    if (!rendered) return;
    const url = new URL(location.href);
    url.search = new URLSearchParams({ model: 'animal', prompt: rendered.prompt, seed: rendered.seed });
    try { await navigator.clipboard.writeText(url.href); setStatus('Sprite link copied.'); }
    catch { setStatus('Clipboard unavailable.'); }
  });

  record.addEventListener('click', async () => {
    if (busy || !contract || record.disabled) return;
    busy = true;
    refresh();
    try {
      if (pending) { await reconcile(1); return; }
      const sprite = rendered;
      const { wallet, from } = await robinhoodWallet();
      setStatus('Review the sprite transaction in your wallet. Robinhood gas is paid in ETH.');
      const hash = await wallet.request({ method: 'eth_sendTransaction',
        params: [{ from, to: contract, data: animalCalldata(sprite, true), value: '0x0' }] });
      if (!HASH.test(hash)) throw Error('The wallet did not return a transaction hash. Check wallet activity.');
      pendingTransaction({ contract, from, hash, ...sprite });
      showProof(hash, 'View submitted transaction');
      setStatus('Waiting for the Robinhood receipt…');
      await reconcile(18);
    } catch (error) { setStatus(error.code === 4001 ? 'Wallet request declined.' : error.message, true); }
    finally { busy = false; refresh(); }
  });

  async function boot() {
    try {
      const [{ animal: samples }, { animal: deployment }] = await Promise.all([asset('./sample.json'), asset('./deployment.json')]);
      const sample = samples.examples[0];
      const initial = animalParameters(sample.prompt, sample.seed);
      setForm(initial);
      render(initial, sample.pixels, false);
      node('names').textContent = samples.animals.join(', ');
      for (const example of samples.examples) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = example.prompt;
        button.addEventListener('click', () => {
          const params = animalParameters(example.prompt, example.seed);
          setForm(params);
          if (contract) form.requestSubmit();
          else render(params, example.pixels, false);
        });
        node('examples').append(button);
      }

      const query = new URLSearchParams(location.search);
      let shared = false;
      if (query.get('model') === 'animal' && query.has('prompt') && query.has('seed')) {
        try { setForm(animalParameters(query.get('prompt'), query.get('seed'))); shared = true; }
        catch { /* The verified sample remains available when share parameters are invalid. */ }
      }
      if (!deployment || deployment.contract === null) {
        setStatus('Model samples are available. Robinhood generation is pending deployment.');
        return;
      }
      contract = await verifyAnimalDeployment(deployment);
      node('deploy-proof').href = EXPLORER + '/tx/' + deployment.transactionHash;
      node('deploy-proof').hidden = false;
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (equal(saved?.contract, contract) && ADDRESS.test(saved.from) && HASH.test(saved.hash) && HASH.test(saved.pixelsHash)) {
          pending = { ...saved, ...animalParameters(saved.prompt, saved.seed) };
          showProof(pending.hash, 'View submitted transaction');
        }
      } catch { /* Invalid saved data never activates a wallet transaction. */ }
      setStatus(pending ? 'A submitted transaction is ready to check.' : 'Robinhood model verified. Preview a sprite to start.');
      refresh();
      onVerified();
      if (shared) form.requestSubmit();
    } catch (error) { setStatus(error.message, true); }
  }
  boot();
}

function switcher() {
  const $ = id => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  let preferred = query.get('model');
  if (['seed', 'subject', 'style'].every(key => query.has(key))) preferred = 'original';
  function select(mode) {
    $('animal-studio').hidden = mode !== 'animal';
    $('original-studio').hidden = mode !== 'original';
    $('animal-mode').setAttribute('aria-pressed', String(mode === 'animal'));
    $('original-mode').setAttribute('aria-pressed', String(mode === 'original'));
    $('model-intro').textContent = mode === 'animal'
      ? 'Describe one of 100 supported animals. Robinhood Chain runs the model and draws a 48×48 sprite.'
      : 'Make 32×32 pixel art with the original GH0ST model on Robinhood Chain. Choose from 12 subjects and eight modifiers.';
  }
  for (const mode of ['animal', 'original']) {
    $(mode + '-mode').addEventListener('click', () => { preferred = mode; select(mode); });
  }
  select(preferred === 'animal' ? 'animal' : 'original');
  studio();
  animalStudio(() => { if (!preferred) select('animal'); });
}

if (typeof document !== 'undefined') switcher();


