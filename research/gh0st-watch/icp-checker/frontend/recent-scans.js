import {isPlatformToken} from './platform-token.js';

export const RECENTS_KEY = 'gh0st-watch:recent-scans:v1';
const limit = 12, maxChars = 800_000;
const explorers = {
  mainnet:'https://robinhoodchain.blockscout.com',
  testnet:'https://explorer.testnet.chain.robinhood.com',
};
const rules = ['mint','underflow','withdraw','authorization','replay','token'];
const text = v => typeof v === 'string';
const listOf = (v,check) => Array.isArray(v) && v.every(check);
const pairs = v => listOf(v,p => Array.isArray(p) && p.length === 2 && p.every(text));
const nat = v => Number.isSafeInteger(v) && v >= 0;
const address = v => text(v) && /^0x[\da-f]{40}$/i.test(v);
const hash = v => text(v) && /^0x[\da-f]{64}$/i.test(v);
const same = (entry,net,addr) => entry.network === net && address(addr) && entry.address.toLowerCase() === addr.toLowerCase();

function validReport(r,net,addr) {
  return r && address(r.address) && same(r,net,addr) && r.explorer === explorers[net] &&
    nat(r.block) && hash(r.blockHash) && hash(r.hash) && hash(r.logicHash) && nat(r.size) &&
    typeof r.verified === 'boolean' && typeof r.erc20 === 'boolean' &&
    (!r.proxy || address(r.proxy.address) && text(r.proxy.kind)) &&
    pairs(r.overview?.fields) && listOf(r.overview.controls,text) &&
    listOf(r.indicators,x => x && text(x.label) && nat(x.count)) &&
    Array.isArray(r.rules) && r.rules.length === rules.length && r.rules.every((x,i) => x && x.key === rules[i] &&
      ['Untested','Not reproduced','Reproduced'].includes(x.status) && text(x.title) && text(x.scope) && text(x.detail) && pairs(x.evidence));
}
function webUrl(v) {
  try { const url=new URL(v);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password; }
  catch {return false;}
}
function validIntel(intel) {
  if (intel === null) return true;
  if (!intel || typeof intel !== 'object') return false;
  const o=intel.origin;
  if (!o) return true;
  if (!address(o.creator) || !address(o.wallet) || !hash(o.tx) || !nat(o.block) ||
      !listOf(o.history?.items,x => x && address(x.address) && hash(x.tx) && nat(x.block))) return false;
  const e=o.bundle?.early;
  if (!e) return true;
  const match=e.funding?.match;
  return nat(e.logLimit) && listOf(e.blocks,b => b && nat(b.height) && listOf(b.rows,x => x && hash(x.hash) && (!x.sender || address(x.sender)))) &&
    (!match || address(match.funder) && listOf(match.proofs,x => x && address(x.recipient) && hash(x.tx)));
}
function safeDetails(d) {
  const kept={};
  if (!d || typeof d !== 'object') return kept;
  if (validIntel(d.intel)) kept.intel=d.intel;
  const m=d.market;
  if (m?.available === false && text(m.reason) || m?.available === true && webUrl(m.url) &&
      listOf(m.links,x => x && text(x.label) && webUrl(x.url))) kept.market=m;
  if (d.note === null || d.note && text(d.note.text) && text(d.note.source)) kept.note=d.note;
  return kept;
}
function validEntry(e) {
  return e && Object.hasOwn(explorers,e.network) && address(e.address) && text(e.name) && e.name.length <= 90 &&
    nat(e.openedAt) && nat(e.scannedAt) && listOf(e.trace,text) &&
    (isPlatformToken(e.network,e.address) ? e.report === null : validReport(e.report,e.network,e.address));
}

export function createRecentScans(storage) {
  if (storage === undefined) {try {storage=globalThis.localStorage;} catch {storage=null;}}
  let rows=[], lastRaw=null;
  function list() {
    let raw;
    try {raw=storage?.getItem(RECENTS_KEY) ?? null;} catch {return rows;}
    if (!storage || raw === lastRaw) return rows;
    lastRaw=raw;
    try {
      const parsed=raw && raw.length <= maxChars ? JSON.parse(raw) : [];
      rows=[];
      for (const e of Array.isArray(parsed) ? parsed : []) {
        if (validEntry(e) && !rows.some(x => same(x,e.network,e.address))) rows.push({...e,details:safeDetails(e.details)});
        if (rows.length === limit) break;
      }
    } catch {rows=[];}
    return rows;
  }
  function write(entries) {
    const next=entries.slice(0,limit);
    // Limit both the number of coins and actual storage size. An outsized
    // result must not evict the rest of the user's history.
    if (next.some(e => JSON.stringify(e).length > maxChars/2)) return false;
    let raw=JSON.stringify(next);
    while (raw.length > maxChars) {next.pop();raw=JSON.stringify(next);}
    rows=next;
    try {storage?.setItem(RECENTS_KEY,raw);lastRaw=raw;}
    catch {storage=null;} // Continue to deduplicate in memory if writes are denied or quota is full.
    return true;
  }
  function get(network,address) {return list().find(e => same(e,network,address)) ?? null;}
  function save({network,address,name,report=null,trace=[]}) {
    const old=get(network,address);
    const scannedAt=Math.max(Date.now(),old ? old.scannedAt+1 : 0);
    const entry={network,address,name:String(name || address).slice(0,90),report,trace,scannedAt,openedAt:scannedAt,details:{}};
    if (!validEntry(entry)) return null;
    return write([entry,...rows.filter(x => !same(x,network,address))]) ? entry : null;
  }
  function touch(network,address) {
    const entry=get(network,address);
    if (!entry) return null;
    const opened={...entry,openedAt:Math.max(Date.now(),entry.scannedAt)};
    write([opened,...rows.filter(x => x!==entry)]);
    return opened;
  }
  function attach(network,address,blockHash,details,scannedAt) {
    const entry=get(network,address);
    if (!entry?.report || entry.report.blockHash !== blockHash || entry.scannedAt !== scannedAt) return null;
    const updated={...entry,details:{...entry.details,...safeDetails(details)}};
    return write(rows.map(x => x===entry ? updated : x)) ? updated : null;
  }
  return {list,get,save,touch,attach};
}
