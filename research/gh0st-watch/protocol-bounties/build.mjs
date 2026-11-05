import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Principal } from '@icp-sdk/core/principal';

const source = fileURLToPath(new URL('.', import.meta.url));
const [canisterId = 'ggcey-baaaa-aaaao-bbsgq-cai', output = resolve(source, 'dist')] = process.argv.slice(2);
if (Principal.fromText(canisterId).isAnonymous()) throw new Error('Provide a Bounties canister principal.');

const host = new URL(process.env.BOUNTIES_IC_HOST ?? 'https://icp-api.io');
if (host.protocol !== 'https:' || host.username || host.password || host.pathname !== '/' || host.search || host.hash) {
  throw new Error('BOUNTIES_IC_HOST must be an HTTPS origin.');
}
const fixture = process.env.BOUNTIES_FIXTURE === '1';
const target = resolve(output, 'bounties');
if (target === resolve(source)) throw new Error('Use an output directory separate from the source.');
await mkdir(target, { recursive: true });
await Promise.all([
  cp(resolve(source, 'index.html'), resolve(target, 'index.html')),
  cp(resolve(source, 'style.css'), resolve(target, 'style.css')),
  build({
    entryPoints: [resolve(source, 'app.js')],
    outfile: resolve(target, 'app.js'),
    format: 'esm',
    bundle: true,
    minify: true,
    target: 'es2022',
    legalComments: 'eof',
    define: {
      BOUNTIES_CANISTER_ID: JSON.stringify(canisterId),
      BOUNTIES_IC_HOST: JSON.stringify(host.origin),
      BOUNTIES_FIXTURE: String(fixture),
    },
  }),
]);
console.log(`Built ${target} for ${canisterId}`);
