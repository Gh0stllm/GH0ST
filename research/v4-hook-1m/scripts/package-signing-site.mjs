// Build an allowlisted static signing site. No credentials are read or embedded.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'deployment');
const output = path.join(source, 'signing-site');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const helper = readFileSync(path.join(source, 'wallet-deploy.js'));
const planBytes = readFileSync(path.join(source, 'robinhood-mainnet-plan.json'));
const plan = JSON.parse(planBytes);
const pinnedDigest = helper.toString().match(/planSha256: '0x([a-f0-9]{64})'/)?.[1];
const pinnedModel = helper.toString().match(/modelHash: '(0x[a-f0-9]{64})'/)?.[1];
assert.equal(sha256(planBytes), pinnedDigest, 'Refuse a plan that differs from the reviewed helper');
assert.equal(plan.selected_model.model_hash, pinnedModel, 'Model identity mismatch');
assert.equal(plan.chain_id, 4663);
assert.equal(plan.transactions.length, 59);
assert.ok(plan.transactions.every(tx => tx.unsigned_transaction.value === '0'));

const html = readFileSync(path.join(source, 'wallet-deploy.html'));
const styles = [...html.toString().matchAll(/<style>([\s\S]*?)<\/style>/g)];
assert.equal(styles.length, 1, 'Review the CSP when changing the style blocks');
const styleHash = createHash('sha256').update(styles[0][1]).digest('base64');
const csp = `default-src 'none'; script-src 'self'; style-src 'sha256-${styleHash}'; connect-src 'self' https://api.coinbase.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const files = new Map([
  ['index.html', html],
  ['wallet-deploy.html', html],
  ['wallet-deploy.js', helper],
  ['liquidity-plan.js', readFileSync(path.join(source, 'liquidity-plan.js'))],
  ['liquidity-wallet.js', readFileSync(path.join(source, 'liquidity-wallet.js'))],
  ['robinhood-mainnet-plan.json', planBytes],
  ['vendor/ethers.umd.min.js', readFileSync(path.join(source, 'vendor/ethers.umd.min.js'))],
  ['vendor/LICENSE-ethers.md', readFileSync(path.join(source, 'vendor/LICENSE-ethers.md'))],
  ['robots.txt', Buffer.from('User-agent: *\nDisallow: /\n')],
  ['_headers', Buffer.from(`/*\n  Content-Security-Policy: ${csp}\n  Cache-Control: private, no-store, max-age=0\n  Netlify-CDN-Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Cross-Origin-Resource-Policy: same-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`)],
]);
mkdirSync(output, { recursive: true });
for (const [relative, bytes] of files) {
  assert.ok(!/nfp_[A-Za-z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(bytes.toString()), `Credential-like content: ${relative}`);
  const file = path.join(output, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
// Fail rather than accidentally publish a file left over from another build.
function walk(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
}
assert.deepEqual(walk(output).sort(), [...files.keys()].sort(), 'Unexpected file in signing-site output');
const manifest = { schema_version: 1, plan_sha256: pinnedDigest, model_hash: pinnedModel,
  files: Object.fromEntries([...files].map(([file, bytes]) => [file, { bytes: bytes.length, sha256: sha256(bytes) }])),
  protection_requirement: 'Netlify team login on ALL production, preview, and deploy-permalink URLs before uploading.' };
mkdirSync(path.join(root, '.netlify'), { recursive: true });
writeFileSync(path.join(root, '.netlify/signing-site-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, files: files.size, plan_sha256: pinnedDigest, credentials_embedded: false }, null, 2));
