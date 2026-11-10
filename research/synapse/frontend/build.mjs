import { createRequire } from 'node:module';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const gh0st = resolve(root, '../../../..');
const candidates = [join(root, 'package.json'), join(gh0st, 'gh0st-watch-research/research/gh0st-watch/protocol-jury/package.json'), join(gh0st, 'website-overhaul/package.json')];
function dependency(name) {
  for (const candidate of candidates) { try { return createRequire(candidate).resolve(name); } catch {} }
  if (name === 'ethers') return createRequire(join(gh0st, 'recovered-model/research/v4-hook-1m/package.json')).resolve(name);
  throw new Error(`Install ${name} with npm install in the frontend directory.`);
}
const { build } = await import(dependency('esbuild'));
const out = join(root, 'dist/synapse');
mkdirSync(out, { recursive: true });
await build({ entryPoints: [join(root, 'app.mjs')], bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: join(out, 'app.js'), alias: { ethers: dependency('ethers') }, legalComments: 'none' });
for (const file of ['index.html', 'style.css', 'deployment.json']) copyFileSync(join(root, file), join(out, file));
const config = JSON.parse(readFileSync(join(root, 'deployment.json')));
const modelDirectory = resolve(root, config.modelDirectory || '../model');
for (const file of ['model.json', 'alternate-expert.json']) copyFileSync(join(modelDirectory, file), join(out, file));
copyFileSync(join(root, 'assets/synapse.png'), join(out, 'synapse.png'));
const artifactPath = resolve(root, config.artifactsPath || '../results/build/artifacts.json');
const rawArtifacts = JSON.parse(readFileSync(artifactPath));
const artifacts = Object.values(rawArtifacts).some(item => item.abi) ? rawArtifacts : Object.assign({}, ...Object.values(rawArtifacts));
const v2 = Boolean(artifacts.SynapseGraphV2);
writeFileSync(join(out, 'abi.json'), JSON.stringify({ graph: artifacts[v2 ? 'SynapseGraphV2' : 'SynapseGraph'].abi, backbone: artifacts[v2 ? 'SynapseBackboneV2' : 'SynapseBackbone'].abi, expert: artifacts[v2 ? 'SynapseExpertV2' : 'SynapseExpert'].abi }));
writeFileSync(join(root, 'build-report.json'), JSON.stringify({ output: out, network: config.chainId, status: config.status, files: ['index.html', 'app.js', 'style.css', 'deployment.json', 'model.json', 'alternate-expert.json', 'abi.json', 'synapse.png'] }, null, 2) + '\n');
console.log(`Built /synapse/ (${config.status}) at ${out}`);
