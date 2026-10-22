import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCharacterGeometry, mountS0ULCharacter } from '../website/s0ul-character.mjs';

const website = fileURLToPath(new URL('../website/', import.meta.url));
const origin = 'https://gh0st.wiki';
const read = name => readFile(path.join(website, name), 'utf8');
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => match[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];

test('standalone /s0ul/ assets resolve using their browser URL, including nested CSS and module imports', async () => {
  const html = await read('s0ul/index.html');
  const base = new URL('/s0ul/', origin), seen = new Set(), queue = [];
  const enqueue = (value, from) => {
    if (!value || value.startsWith('#') || /^(?:data|mailto|tel|javascript):/i.test(value)) return;
    const url = new URL(value, from);
    if (url.origin === origin) queue.push(url);
  };
  const enqueueImports = (source, from) => {
    for (const match of source.matchAll(/(?:\b(?:import|export)\s+[^;]*?\s+from\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) enqueue(match[1], from);
  };
  for (const tag of [...tags(html, 'script'), ...tags(html, 'img')]) enqueue(attr(tag, 'src'), base);
  for (const tag of tags(html, 'link')) if (/^(?:stylesheet|preload|modulepreload|icon)$/.test(attr(tag, 'rel') ?? '')) enqueue(attr(tag, 'href'), base);
  for (const match of html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)) enqueueImports(match[1], base);
  let modules = 0, stylesheets = 0;
  while (queue.length) {
    const url = queue.shift(), key = url.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    const local = path.resolve(website, '.' + decodeURIComponent(key));
    assert.ok(local.startsWith(website), 'local asset must remain inside the published website');
    const info = await stat(local).catch(() => null);
    assert.ok(info?.isFile(), `Missing browser asset ${url.href}`);
    if (/\.(?:m?js|css)$/.test(key)) {
      const source = await readFile(local, 'utf8');
      if (/\.css$/.test(key)) {
        ++stylesheets;
        for (const match of source.matchAll(/url\(\s*["']?([^\s)"']+)/g)) enqueue(match[1], url);
      } else {
        ++modules;
        enqueueImports(source, url);
      }
    }
  }
  assert.ok(modules >= 5, 'standalone page must load character, UI, client, gas and ethers modules');
  assert.ok(stylesheets >= 2, 'page styling and the shared agent controls must both resolve');
  assert.ok(seen.has('/s0ul-ui.mjs'));
  assert.ok(seen.has('/s0ul-client.mjs'));
  assert.ok(seen.has('/s0ul-gas.mjs'));
  assert.ok(seen.has('/mint/vendor/ethers.js'));
});

test('S0UL has one standalone mount and its homepage entry routes to the separate page', async () => {
  const [standalone, home] = await Promise.all([read('s0ul/index.html'), read('index.html')]);
  assert.equal((standalone.match(/\bid=["']s0ul-agent-root["']/g) ?? []).length, 1);
  assert.equal((home.match(/\bid=["']s0ul-agent-root["']/g) ?? []).length, 0);
  assert.equal(tags(standalone, 'script').filter(tag => /s0ul-ui\.mjs(?:[?"']|$)/.test(tag)).length, 1);
  assert.equal(tags(home, 'script').filter(tag => /s0ul-ui\.mjs(?:[?"']|$)/.test(tag)).length, 0);
  assert.ok(tags(home, 'a').some(tag => attr(tag, 'href') === '/s0ul/'), 'homepage navigation must open /s0ul/');
  assert.match(home, /(?:location\.(?:replace|assign)|location\.href)[\s\S]{0,120}\/s0ul\//, 'legacy #s0ul visitors must route to the standalone page');
  assert.match(standalone, /<main\b/i);
  assert.match(standalone, /<h1\b/i);
  assert.ok(tags(standalone, 'link').some(tag => attr(tag, 'rel') === 'canonical' && attr(tag, 'href') === 'https://gh0st.wiki/s0ul/'));
  assert.ok(tags(standalone, 'a').some(tag => ['/', '/#home'].includes(attr(tag, 'href'))), 'standalone page must provide a way back to the observatory');
  assert.match(standalone, /<noscript\b/i);
});

test('moving the panel preserves the already validated wallet, gas and approval implementation', async () => {
  const report = JSON.parse(await readFile(new URL('./validation-report.json', import.meta.url), 'utf8'));
  for (const name of ['s0ul-gas.mjs', 's0ul-client.mjs', 's0ul-ui.mjs', 's0ul-agent.css']) {
    const source = await readFile(path.join(website, name));
    assert.equal(createHash('sha256').update(source).digest('hex'), report.sha256['website/' + name], name + ' changed after wallet validation');
  }
  const character = await read('s0ul-character.mjs');
  assert.doesNotMatch(character, /eth_sendTransaction|eth_sendRawTransaction|new\s+(?:\w+\.)?Wallet\s*\(|privateKey\s*[:=]/, 'decorative character must not create a signer or send transactions');
});

test('reference portrait keeps white brackets and mouth around amber eye dots', () => {
  const points = createCharacterGeometry();
  assert.ok(points.length > 0);
  assert.ok(points.every(point => ['x', 'y', 'z'].every(key => Number.isFinite(point[key]))));
  const channels = color => color.match(/[a-f\d]{2}/gi)?.map(hex => parseInt(hex, 16));
  const white = color => { const rgb = channels(color); return rgb?.length === 3 && Math.min(...rgb) >= 230 && Math.max(...rgb) - Math.min(...rgb) < 20; };
  const amber = color => { const rgb = channels(color); return rgb?.length === 3 && rgb[0] > 230 && rgb[1] > 130 && rgb[1] < 210 && rgb[2] < 150; };
  const brackets = points.filter(point => point.group === 'bracket'), eyes = points.filter(point => /eye|right-/.test(point.group)), mouth = points.filter(point => point.group === 'mouth');
  assert.ok(brackets.length > 20 && brackets.every(point => white(point.color)));
  assert.ok(eyes.length > 20 && eyes.every(point => amber(point.color)));
  assert.ok(mouth.length >= 3 && mouth.every(point => white(point.color)));
  assert.ok(Math.min(...brackets.map(p => p.x)) < Math.min(...eyes.map(p => p.x)));
  assert.ok(Math.max(...brackets.map(p => p.x)) > Math.max(...eyes.map(p => p.x)));
  assert.ok(Math.min(...mouth.map(p => p.y)) > Math.max(...eyes.map(p => p.y)));
});

function characterFixture({ reducedMotion = false } = {}) {
  const frames = new Map(), timers = new Map(), images = [], cores = [], nodes = new Map();
  let sequence = 0, observer, time = 0;
  class Element {
    constructor(tagName = 'DIV') { this.tagName = tagName; this.dataset = {}; this.style = {}; this.listeners = new Map(); this.attrs = {}; this.textContent = ''; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; if (name === 'data-s0ul-character-mounted') delete this.dataset.s0ulCharacterMounted; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name) { this.listeners.delete(name); }
    fire(name, event = {}) { this.listeners.get(name)?.(event); }
    replaceChildren(...children) { this.children = children; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; }
    getContext() { return { setTransform() {}, clearRect() {}, fillRect() {},
      beginPath() { this.currentArc = null; }, arc(...args) { this.currentArc = args; },
      fill() { cores.push({ color: this.fillStyle, arc: this.currentArc }); },
      createRadialGradient: () => ({ addColorStop() {} }),
      drawImage: (...args) => images.push(args) }; }
  }
  for (const id of ['s0ul-character', 's0ul-character-pause', 's0ul-character-greet', 's0ul-character-status', 's0ul-agent-root', 's0ul-outcome', 's0ul-execution-title', 's0ul-quote', 's0ul-notice', 's0ul-pause']) {
    const el = new Element(); el.id = id; nodes.set(id, el);
  }
  const media = new Element(); media.matches = reducedMotion;
  const win = new Element();
  Object.assign(win, { devicePixelRatio: 3, matchMedia: () => media,
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() { observer = null; } } });
  const doc = new Element();
  Object.assign(doc, { hidden: false, defaultView: win, getElementById: id => nodes.get(id), createElement: tag => new Element(tag.toUpperCase()) });
  for (const node of nodes.values()) node.ownerDocument = doc;
  const portrait = mountS0ULCharacter(nodes.get('s0ul-character'), { window: win, now: () => time,
    requestAnimationFrame: fn => { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id) });
  function flush() { const pending = [...frames.values()]; frames.clear(); time += 33; for (const fn of pending) fn(time); }
  return { portrait, frames, timers, images, cores, nodes, doc, media, flush, observe: () => observer?.() };
}

test('portrait supports keyboard greeting and live status without invoking wallet or task controls', t => {
  const f = characterFixture(); t.after(() => f.portrait.destroy());
  assert.equal(f.portrait.canvas.attrs.role, 'button'); assert.equal(f.portrait.canvas.attrs.tabindex, '0');
  assert.match(f.portrait.canvas.attrs['aria-label'], /Enter or Space/);
  assert.equal(f.nodes.get('s0ul-character-status').attrs['aria-live'], 'polite');
  assert.ok(f.images.length > 0, 'initial render must paint the reference dots');
  assert.ok(f.cores.length > 0 && f.cores.every(core => core.arc?.slice(0, 3).every(Number.isFinite)), 'dots must render finite solid cores');
  assert.equal(new Set(f.cores.map(core => core.color)).size, 2, 'solid cores must preserve both portrait colors');
  let prevented = false;
  f.portrait.canvas.fire('keydown', { key: 'Enter', repeat: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.nodes.get('s0ul-character-status').textContent, 'Portrait greeting.');
  assert.equal(f.nodes.get('s0ul-outcome').dataset.outcome, undefined, 'portrait interaction cannot change contract execution state');
  for (const fn of [...f.timers.values()]) fn();
  f.nodes.get('s0ul-outcome').dataset.outcome = '3'; f.observe();
  assert.match(f.nodes.get('s0ul-character-status').textContent, /rejected/);
  f.nodes.get('s0ul-outcome').dataset.outcome = '2'; f.observe();
  assert.match(f.nodes.get('s0ul-character-status').textContent, /confirmed on-chain/);
});

test('reduced motion, Pause, hidden tabs and destroy stop continuous portrait animation', () => {
  const reduced = characterFixture({ reducedMotion: true });
  assert.equal(reduced.portrait.paused, true);
  assert.equal(reduced.nodes.get('s0ul-character-pause').disabled, true);
  reduced.flush(); assert.equal(reduced.frames.size, 0);
  reduced.portrait.greet(); reduced.flush(); assert.equal(reduced.frames.size, 0);
  reduced.portrait.destroy(); assert.equal(reduced.timers.size, 0);
  const normal = characterFixture();
  assert.equal(normal.portrait.paused, false); assert.equal(normal.frames.size, 1);
  normal.nodes.get('s0ul-character-pause').fire('click');
  assert.equal(normal.portrait.paused, true); assert.equal(normal.frames.size, 0);
  normal.nodes.get('s0ul-character-pause').fire('click');
  assert.equal(normal.portrait.paused, false); assert.equal(normal.frames.size, 1);
  normal.doc.hidden = true; normal.doc.fire('visibilitychange'); assert.equal(normal.frames.size, 0);
  normal.doc.hidden = false; normal.doc.fire('visibilitychange'); assert.equal(normal.frames.size, 1);
  normal.portrait.destroy(); assert.equal(normal.frames.size, 0);
  assert.equal(normal.portrait.canvas.listeners.size, 0);
});
