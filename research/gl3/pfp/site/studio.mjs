const CHAIN_ID = '0x1237';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com/';
const EXPLORER = 'https://robin.etherscan.io';
const MODEL_ID = '0x38ff2be5a522e043afe0964079aefea60d00d44f3c13a9fe30fe00d8f405b144';
const GENERATE = '0x6086e029';
const RECORD = '0xa9091270';
const MODEL = '0x43cdaad2';
const IMAGE_EVENT = '0x92ee4a912ed5633628611603f2f60b5ec11ecf9e5bd6782f12881bad7abd5b43';
const MAX_UINT64 = (1n << 64n) - 1n;
const SUBJECTS = ['None', 'Ghost', 'Cat', 'Robot', 'Alien', 'Skull', 'Owl', 'Fox', 'Rocket',
  'Planet', 'Mountain', 'Castle', 'Flower', 'Crystal', 'Mushroom', 'Pine', 'Moon', 'Potion',
  'Sword', 'Jellyfish', 'Cactus', 'Key', 'Butterfly', 'Anchor', 'Whale'];
const TINTS = ['Amber', 'Blue', 'Red', 'Mint', 'Purple', 'Rose', 'Ivory', 'Teal'];
const RELATIONS = ['Single subject', 'Left of', 'Above'];
const BACKGROUNDS = ['Void', 'Night sky', 'Forest', 'Ocean', 'Ruins', 'Desert', 'Ice cave', 'Digital'];
const STYLES = ['Classic', 'Neon', 'Stained glass', 'Blueprint', 'Ink', 'Mosaic', 'Terminal'];
const PALETTES = ['Obsidian', 'Dusk', 'Dawn', 'Aurora', 'Sandstone', 'Plum', 'Frost', 'Copper',
  'Evergreen', 'Ocean', 'Arcade', 'Parchment', 'Cobalt', 'Low light', 'High contrast', 'Moonstone'];
const FIELDS = ['subject', 'subject-b', 'tint', 'tint-b', 'relation', 'background', 'style', 'palette'];
const COUNTS = [SUBJECTS.length, SUBJECTS.length, TINTS.length, TINTS.length, RELATIONS.length,
  BACKGROUNDS.length, STYLES.length, PALETTES.length];
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const DATA = /^0x(?:[0-9a-f]{2})+$/i;
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const bytesOf = value => Uint8Array.from(value.slice(2).match(/../g), pair => Number.parseInt(pair, 16));
const word = value => value.toString(16).padStart(64, '0');

export function parseUint64(value) {
  if (!/^(?:[0-9]{1,20}|0x[0-9a-f]{1,16})$/i.test(value)) throw Error('Enter a 64-bit decimal or hex number.');
  const number = BigInt(value);
  if (number > MAX_UINT64) throw Error('Enter a 64-bit decimal or hex number.');
  return number;
}

export function encodePrompt(fields) {
  const [a, b, , , relation] = fields;
  if (fields.length !== COUNTS.length || fields.some((n, i) => !Number.isInteger(n) || n < 0 || n >= COUNTS[i])
      || a === 0 || a === b || ((b === 0) !== (relation === 0))) throw Error('Choose two different subjects for this layout.');
  return fields.reduce((value, field) => (value << 8n) | BigInt(field), 0n);
}

export function decodePrompt(prompt) {
  const fields = FIELDS.map((_, i) => Number((prompt >> BigInt(56 - 8 * i)) & 255n));
  if (prompt < 0n || prompt > MAX_UINT64 || encodePrompt(fields) !== prompt) throw Error('The scene parameters are invalid.');
  return fields;
}

export const calldata = (prompt, seed, record = false) => (record ? RECORD : GENERATE) + word(prompt) + word(seed);

export function decodeResult(result) {
  if (typeof result !== 'string' || !/^0x[0-9a-f]{5632}$/i.test(result)) throw Error('The model returned the wrong image size.');
  const chunk = (offset, size) => result.slice(2 + 2 * offset, 2 + 2 * (offset + size)).toLowerCase();
  if (chunk(0, 32) !== word(64) || chunk(32, 32) !== word(2656)
      || chunk(64, 32) !== word(2560) || chunk(2656, 32) !== word(128)) {
    throw Error('The model returned an invalid image.');
  }
  return { pixels: '0x' + chunk(96, 2560), palette: '0x' + chunk(2688, 128) };
}

export function unpackImage(pixels, palette) {
  if (!/^0x[0-9a-f]{5120}$/i.test(pixels) || !/^0x[0-9a-f]{256}$/i.test(palette)) throw Error('The model returned an invalid image.');
  const packed = bytesOf(pixels);
  const colors = bytesOf(palette);
  const image = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) {
    const bit = i * 5;
    const byte = bit >> 3;
    const color = ((packed[byte] | (packed[byte + 1] << 8)) >> (bit & 7)) & 31;
    image.set(colors.subarray(color * 4, color * 4 + 4), i * 4);
  }
  return image;
}

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

export function matchesProof(receipt, pending) {
  const equal = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
  return equal(receipt?.transactionHash, pending.hash) && receipt.status === '0x1' && receipt.logs.some(log =>
    equal(log.address, pending.contract) && equal(log.data, pending.commitment) && log.topics?.length === 4
    && [IMAGE_EVENT, MODEL_ID, '0x' + word(pending.prompt), '0x' + word(pending.seed)]
      .every((topic, i) => equal(log.topics[i], topic)));
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
  if (message.id !== id || message.error || !Object.hasOwn(message, 'result')) throw Error('Robinhood RPC could not complete the request.');
  return message.result;
}

async function asset(name) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw Error('The Studio could not load its configuration.');
  return response.json();
}

function describe(fields) {
  const [a, b, tintA, tintB, relation] = fields;
  const first = TINTS[tintA] + ' ' + SUBJECTS[a];
  return b ? first + ' ' + RELATIONS[relation].toLowerCase() + ' ' + TINTS[tintB] + ' ' + SUBJECTS[b] : first;
}

function studio() {
  const byId = id => document.getElementById(id);
  const form = byId('generator');
  const selectors = FIELDS.map(byId);
  const status = byId('status');
  const canvas = byId('avatar');
  const context = canvas.getContext('2d');
  const small = document.createElement('canvas');
  small.width = small.height = 64;
  const smallContext = small.getContext('2d');
  const seedInput = byId('seed');
  const generate = byId('generate');
  const record = byId('record');
  const proof = byId('proof');
  const storageKey = 'gh0st-scene-pending:' + MODEL_ID.slice(2);
  let contract = null;
  let rendered = null;
  let pending = null;
  let busy = false;

  [SUBJECTS, SUBJECTS, TINTS, TINTS, RELATIONS, BACKGROUNDS, STYLES, PALETTES].forEach((choices, i) => {
    choices.forEach((name, index) => {
      if (index !== 0 || i > 1) selectors[i].add(new Option(name, index));
    });
  });

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function selected() {
    const fields = selectors.map(element => Number(element.value));
    if (fields[4] === 0) fields[1] = fields[3] = 0;
    return { prompt: encodePrompt(fields), seed: parseUint64(seedInput.value.trim()) };
  }

  function setForm(prompt, seed) {
    const fields = decodePrompt(prompt);
    selectors.forEach((element, i) => { element.value = String(i === 1 && fields[i] === 0 ? 13 : fields[i]); });
    seedInput.value = seed.toString();
    updateForm();
  }

  function updateForm() {
    const single = selectors[4].value === '0';
    byId('second-subject').hidden = byId('second-tint').hidden = single;
    generate.disabled = busy || !contract;
    record.textContent = pending ? 'Check transaction' : 'Record on Robinhood';
    let exact = false;
    try {
      const selection = selected();
      exact = rendered?.verified && rendered.prompt === selection.prompt && rendered.seed === selection.seed;
    } catch { /* Invalid selections can still be fixed in the form. */ }
    record.disabled = busy || !contract || (!pending && !exact);
  }

  function render(selection, result, verified) {
    const fields = decodePrompt(selection.prompt);
    smallContext.putImageData(new ImageData(unpackImage(result.pixels, result.palette), 64, 64), 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(small, 0, 0, canvas.width, canvas.height);
    rendered = { ...selection, verified, commitment: keccak256(result.pixels + result.palette.slice(2)) };
    const description = describe(fields);
    byId('image-subject').textContent = description;
    byId('style-code').textContent = STYLES[fields[6]];
    byId('image-source').textContent = verified ? 'ROBINHOOD CONTRACT' : 'MODEL SAMPLE';
    canvas.setAttribute('aria-label', '64 by 64 pixel art of ' + description);
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
      if (value) sessionStorage.setItem(storageKey, JSON.stringify({ ...value, prompt: value.prompt.toString(), seed: value.seed.toString() }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Receipt monitoring works without local browser storage. */ }
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !contract) return;
    busy = true;
    updateForm();
    setStatus('Running a free on-chain preview…');
    try {
      const selection = selected();
      const output = await rpc('eth_call', [{ to: contract, data: calldata(selection.prompt, selection.seed) }, 'latest']);
      render(selection, decodeResult(output), true);
      if (!pending) proof.hidden = true;
      setStatus('Preview ready. Recording the image hash uses one wallet transaction.');
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      busy = false;
      updateForm();
    }
  });

  byId('random').addEventListener('click', () => {
    seedInput.value = BigInt('0x' + hex(crypto.getRandomValues(new Uint8Array(8)))).toString();
    updateForm();
    seedInput.focus();
  });
  byId('download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'gh0st-scene-' + rendered.seed + '.png';
    link.click();
  });
  byId('share').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = new URLSearchParams({ prompt: rendered.prompt, seed: rendered.seed }).toString();
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus('Scene link copied.');
    } catch {
      setStatus('Clipboard unavailable. Scene ' + rendered.prompt + ' with seed ' + rendered.seed + '.');
    }
  });

  record.addEventListener('click', async () => {
    if (busy || !contract || record.disabled) return;
    busy = true;
    updateForm();
    try {
      if (pending) {
        await reconcile(1);
        return;
      }
      const scene = rendered;
      const wallet = window.ethereum;
      if (!wallet?.request) throw Error('Open Image Studio in a browser with an Ethereum wallet.');
      const [from] = await wallet.request({ method: 'eth_requestAccounts' });
      if (!ADDRESS.test(from)) throw Error('Choose a wallet account first.');
      if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN_ID) {
        try {
          await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
        } catch (error) {
          if (error.code !== 4902) throw error;
          await wallet.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: CHAIN_ID, chainName: 'Robinhood Chain', rpcUrls: [RPC_URL],
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [EXPLORER] }],
          });
        }
      }
      if (await wallet.request({ method: 'eth_chainId' }) !== CHAIN_ID) throw Error('Switch your wallet to Robinhood Chain.');
      setStatus('Review the image transaction in your wallet. Robinhood gas is paid in ETH.');
      const hash = await wallet.request({ method: 'eth_sendTransaction',
        params: [{ from, to: contract, data: calldata(scene.prompt, scene.seed, true), value: '0x0' }] });
      if (!HASH.test(hash)) throw Error('The wallet did not return a transaction hash. Check wallet activity.');
      storePending({ contract, hash, commitment: scene.commitment, prompt: scene.prompt, seed: scene.seed });
      showProof(hash, 'View submitted transaction');
      setStatus('Waiting for the Robinhood receipt…');
      await reconcile(18);
    } catch (error) {
      setStatus(error.code === 4001 ? 'Wallet request declined.' : error.message, true);
    } finally {
      busy = false;
      updateForm();
    }
  });

  async function boot() {
    try {
      const sample = await asset('./sample.json');
      const scene = { prompt: parseUint64(sample.prompt), seed: parseUint64(sample.seed) };
      setForm(scene.prompt, scene.seed);
      render(scene, { pixels: sample.pixelsHex, palette: sample.paletteHex }, false);
      const params = new URLSearchParams(location.search);
      const shared = params.has('prompt') && params.has('seed');
      if (shared) setForm(parseUint64(params.get('prompt')), parseUint64(params.get('seed')));
      const deployment = await asset('./deployment.json');
      if (deployment.contract === null) {
        setStatus('Model sample loaded. The Robinhood deployment is pending.');
        return;
      }
      if (deployment.chainId !== 4663 || deployment.modelId !== MODEL_ID || !ADDRESS.test(deployment.contract)
          || !HASH.test(deployment.runtimeCodeHash)) throw Error('The configured deployment does not match this model.');
      const [network, code, model] = await Promise.all([
        rpc('eth_chainId', []), rpc('eth_getCode', [deployment.contract, 'latest']),
        rpc('eth_call', [{ to: deployment.contract, data: MODEL }, 'latest']),
      ]);
      if (network !== CHAIN_ID || model?.toLowerCase() !== MODEL_ID || !DATA.test(code)
          || keccak256(code) !== deployment.runtimeCodeHash.toLowerCase()) throw Error('The deployed model could not be verified.');
      contract = deployment.contract;
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (saved?.contract === contract && HASH.test(saved.hash) && HASH.test(saved.commitment)) {
          pending = { ...saved, prompt: parseUint64(saved.prompt), seed: parseUint64(saved.seed) };
          showProof(pending.hash, 'View submitted transaction');
        }
      } catch { /* An invalid local record does not disable the model. */ }
      setStatus(pending ? 'A submitted transaction is ready to check.' : 'Robinhood model verified. Preview a scene to start.');
      updateForm();
      if (shared) form.requestSubmit();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  boot();
}

if (typeof document !== 'undefined') studio();
