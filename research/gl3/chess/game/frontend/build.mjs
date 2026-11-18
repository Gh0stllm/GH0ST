// Package the player for a verified release without contacting the chain or hosting.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [releaseFile, artifactFile, destination, dependencyFile = fileURLToPath(new URL('../../../../chess/package.json', import.meta.url))] = process.argv.slice(2);
if (!releaseFile || !artifactFile || !destination || process.argv.length > 6) {
  throw new Error('Pass LIVE_RELEASE_JSON GAME_ARTIFACT_JSON NEW_OUTPUT_DIRECTORY [CHESS_PACKAGE_JSON]');
}
const dependencyManifest = path.resolve(dependencyFile);
const { build } = createRequire(dependencyManifest)('esbuild');
const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8'));
if (release.schemaVersion !== 1 || release.status !== 'live' || release.chainId !== 4_663_001
    || artifact.contractName !== 'GL3StockfishChess' || !Array.isArray(artifact.abi)) {
  throw new Error('An activated GL3 release manifest and its compiled game artifact are required');
}

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = ['index.html', 'style.css'].map(name => [name, fs.readFileSync(path.join(root, name))]);
const fontDirectory = fileURLToPath(new URL('../../../../chess/frontend/assets/', import.meta.url));
for (const name of ['manrope.woff2', 'license-manrope.txt']) {
  assets.push([path.join('assets', name), fs.readFileSync(path.join(fontDirectory, name))]);
}
const bundled = await build({
  entryPoints: [path.join(root, 'player.mjs')],
  outfile: 'player.js', write: false, bundle: true, minify: true,
  format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof',
  nodePaths: [path.join(path.dirname(dependencyManifest), 'node_modules')],
});
const publicFields = [
  'schemaVersion', 'status', 'chainId', 'publicRpc', 'genesisHash', 'coordinator',
  'poolOwner', 'coordinatorRuntimeHash', 'deploymentTransaction', 'engineModuleHash', 'engineSeedRoot',
];
const gameFields = ['contractName', 'abi', 'bytecode', 'deployedBytecode', 'immutableReferences'];
const project = (source, fields) => Object.fromEntries(fields.map(field => [field, source[field]]));
const encode = value => JSON.stringify(value, null, 2) + '\n';
const files = [
  ...assets,
  ['player.js', bundled.outputFiles[0].contents],
  ['public-config.json', encode(project(release, publicFields))],
  ['game-artifact.json', encode(project(artifact, gameFields))],
];
fs.mkdirSync(destination);
fs.mkdirSync(path.join(destination, 'assets'));
for (const [name, contents] of files) fs.writeFileSync(path.join(destination, name), contents, { flag: 'wx' });
process.stdout.write(`Packaged the GL3 chess player in ${destination}\n`);
