const palette = ['#09080c', '#eac18a', '#f4ede1'];
const subjects = [
  ['Ghost', 'spirit', 'gh0st', 'phantom'], ['Cat', 'kitten', 'feline'], ['Robot', 'android', 'droid'],
  ['Alien', 'extraterrestrial', 'martian'], ['Skull', 'skeleton'], ['Owl', 'owlet'], ['Fox', 'vixen'],
  ['Rocket', 'spaceship', 'shuttle'], ['Planet', 'saturn', 'world'], ['Mountain', 'peak', 'alpine'],
  ['Castle', 'fortress', 'palace'], ['Flower', 'blossom', 'daisy'],
];
const traitOptions = [
  ['Glow', 'glowing', 'glow'], ['Stars', 'star', 'stars', 'starry'],
  ['Sparks', 'spark', 'sparks', 'sparkling'], ['Frame', 'frame', 'framed', 'border'],
  ['Halo', 'halo'], ['Emblem', 'emblem', 'badge'], ['Scanlines', 'scanlines', 'retro'],
  ['Ivory accents', 'ivory', 'white'],
];
const selectById = id => document.getElementById(id);
const form = selectById('generator');
const phrase = selectById('phrase');
const subjectSelect = selectById('subject');
const imageSubject = selectById('image-subject');
const status = selectById('status');
const generate = selectById('generate');
const canvas = selectById('avatar');
const context = canvas.getContext('2d');
const download = selectById('download');
const share = selectById('share');
const source = selectById('image-source');
const styleCode = selectById('style-code');

subjects.forEach(([name], index) => subjectSelect.add(new Option(name, index)));
const controls = traitOptions.map(([name]) => {
  const label = document.createElement('label');
  label.className = 'trait';
  label.append(name);
  const select = document.createElement('select');
  select.name = name.toLowerCase().replaceAll(' ', '-');
  select.add(new Option('Off', 0));
  select.add(new Option('On', 1));
  label.append(select);
  selectById('traits').append(label);
  return select;
});

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const isSeed = value => /^0x[0-9a-f]{32}$/i.test(value);
const isAddress = value => /^0x[0-9a-f]{40}$/i.test(value ?? '');
let connection;
let rendered;
let rpcId = 0;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

async function seedFor(input) {
  if (isSeed(input)) return input.toLowerCase();
  if (/^0x[0-9a-f]*$/i.test(input)) throw Error('A hex seed needs exactly 32 digits after 0x.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.normalize('NFC')));
  return '0x' + hex(new Uint8Array(digest, 0, 16));
}

function applyWords(input) {
  if (isSeed(input)) return;
  const words = input.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const word of words) {
    const match = subjects.findIndex(([name, ...aliases]) => word === name.toLowerCase() || aliases.includes(word));
    if (match === -1) continue;
    subjectSelect.value = String(match);
    break;
  }
  for (const [index, [, ...aliases]] of traitOptions.entries()) {
    const active = words.some((word, i) => aliases.includes(word) && !['no', 'without'].includes(words[i - 1]));
    controls[index].value = String(Number(active));
  }
}

function styleForControls() {
  return controls.reduce((byte, select, index) => byte | (Number(select.value) << index), 0);
}

function applyStyle(style) {
  controls.forEach((select, i) => { select.value = String((style >> i) & 1); });
}

function paint(bitmap, seed, subject, style, label) {
  if (!/^0x[0-9a-f]{512}$/i.test(bitmap)) throw Error('The generator returned an invalid bitmap.');
  const bytes = bitmap.slice(2).match(/../g).map(byte => Number.parseInt(byte, 16));
  const pixels = Array.from({ length: 1024 }, (_, i) => (bytes[i >> 2] >> ((i & 3) * 2)) & 3);
  if (pixels.includes(3)) throw Error('The generator returned a color outside the palette.');
  const scale = canvas.width / 32;
  context.fillStyle = palette[0];
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, color] of pixels.entries()) {
    if (!color) continue;
    context.fillStyle = palette[color];
    context.beginPath();
    context.arc((index % 32 + .5) * scale, (Math.floor(index / 32) + .5) * scale, scale * .39, 0, 2 * Math.PI);
    context.fill();
  }
  rendered = { seed, subject, style };
  imageSubject.textContent = subjects[subject][0].toUpperCase();
  canvas.setAttribute('aria-label', '32 by 32 ' + subjects[subject][0].toLowerCase() + ' pixel art');
  source.textContent = label;
  styleCode.textContent = 'STYLE ' + style.toString(16).padStart(2, '0').toUpperCase();
  download.disabled = false;
  share.disabled = false;
}

async function rpc(url, method, params) {
  const id = ++rpcId;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error('The RPC did not respond.');
  const result = await response.json();
  if (result.id !== id || result.error || !Object.hasOwn(result, 'result')) {
    throw Error('The RPC could not execute the request.');
  }
  return result.result;
}

function calldata(seed, subject, style) {
  return '0x0565a8f8' + seed.slice(2).padEnd(64, '0') + subject.toString(16).padStart(64, '0')
    + style.toString(16).padStart(64, '0');
}

function decodeResult(result) {
  if (!/^0x[0-9a-f]{640}$/i.test(result) || BigInt('0x' + result.slice(2, 66)) !== 32n
      || BigInt('0x' + result.slice(66, 130)) !== 256n) {
    throw Error('The contract returned an invalid ABI response.');
  }
  return '0x' + result.slice(130);
}

async function fetchJson(file) {
  const response = await fetch(new URL(file, import.meta.url));
  if (!response.ok) throw Error('Could not load ' + file);
  return response.json();
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const requestedSeed = params.get('seed');
  const requestedSubject = params.get('subject');
  if (isSeed(requestedSeed ?? '')) phrase.value = requestedSeed.toLowerCase();
  applyWords(phrase.value);
  if (/^\d{1,2}$/.test(requestedSubject ?? '') && Number(requestedSubject) < subjects.length) {
    subjectSelect.value = String(Number(requestedSubject));
  }
  if (/^[0-9a-f]{2}$/i.test(params.get('style') ?? '')) applyStyle(Number.parseInt(params.get('style'), 16));
  try {
    const sample = await fetchJson('./sample.json');
    paint(sample.bitmap, sample.seed, sample.subject, sample.style, 'MODEL SAMPLE');
  } catch {
    context.fillStyle = palette[0];
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  try {
    const deployment = await fetchJson('./deployment.json');
    if (!isAddress(deployment.contract)) {
      setStatus('The generator has no published GL3 contract address yet. The preview is a sample from the model.');
      return;
    }
    const candidates = await Promise.allSettled(deployment.rpcUrls.map(async url => {
      const [chainId, code, digest] = await Promise.all([
        rpc(url, 'eth_chainId', []),
        rpc(url, 'eth_getCode', [deployment.contract, 'latest']),
        rpc(url, 'eth_call', [{ to: deployment.contract, data: '0x1b2ccc09' }, 'latest']),
      ]);
      if (Number(BigInt(chainId)) !== deployment.chainId || !/^0x[0-9a-f]{2,}$/i.test(code)
          || digest.toLowerCase() !== deployment.modelHash?.toLowerCase()) {
        throw Error('The configured contract is unavailable.');
      }
      return url;
    }));
    const urls = candidates.filter(item => item.status === 'fulfilled').map(item => item.value);
    if (!urls.length) throw Error('The generator is unavailable on the configured network.');
    const mainnet = deployment.chainId === 4663001 && deployment.mode !== 'local';
    connection = { contract: deployment.contract, urls, mainnet };
    generate.textContent = mainnet ? 'Generate on GL3' : 'Generate on test node';
    generate.disabled = false;
    setStatus(mainnet ? 'GL3 contract ready. Previews are read-only.' : 'Local contract connected.');
    if (isSeed(requestedSeed ?? '')) form.requestSubmit();
  } catch (error) {
    setStatus(error.message, true);
  }
}

phrase.addEventListener('input', () => applyWords(phrase.value));
selectById('random').addEventListener('click', () => {
  phrase.value = '0x' + hex(crypto.getRandomValues(new Uint8Array(16)));
  phrase.focus();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!connection || generate.disabled) return;
  const input = phrase.value.trim();
  if (!input) {
    setStatus('Enter a seed phrase first.', true);
    return;
  }
  generate.disabled = true;
  setStatus('Running the model…');
  try {
    const seed = await seedFor(input);
    const subject = Number(subjectSelect.value);
    const style = styleForControls();
    const request = [{ to: connection.contract, data: calldata(seed, subject, style) }, 'latest'];
    const bitmap = await Promise.any(connection.urls.map(async url => decodeResult(await rpc(url, 'eth_call', request))));
    paint(bitmap, seed, subject, style, connection.mainnet ? 'GL3 CONTRACT' : 'LOCAL CONTRACT');
    setStatus('Rendered from seed ' + seed);
  } catch (error) {
    setStatus(error instanceof AggregateError ? 'The generator did not respond. Try again.' : error.message, true);
  } finally {
    generate.disabled = false;
  }
});

download.addEventListener('click', () => {
  if (!rendered) return;
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'gh0st-' + subjects[rendered.subject][0].toLowerCase() + '-' + rendered.seed.slice(2, 10) + '.png';
  link.click();
});
share.addEventListener('click', async () => {
  if (!rendered) return;
  const url = new URL(location.href);
  url.search = new URLSearchParams({ seed: rendered.seed, subject: rendered.subject,
    style: rendered.style.toString(16).padStart(2, '0') });
  try {
    await navigator.clipboard.writeText(url.href);
    setStatus('Share link copied.');
  } catch {
    setStatus('Clipboard unavailable. Seed ' + rendered.seed + ', subject ' + rendered.subject + ', style ' + rendered.style);
  }
});

boot();
