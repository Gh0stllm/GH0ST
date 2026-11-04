// Produce just the six static files required to add Spawn to AgentKit 0.3.0-alpha.1.
// Inputs are read-only. An unrelated change to the published Kit requires a new baseline.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [kitInput, spawnInput, output] = process.argv.slice(2);
if (!kitInput || !spawnInput || !output)
  throw new Error('Usage: node build.mjs <published-agentkit-dir> <spawn-dist-dir> <output-agentkit-dir>');
const baseline = resolve(kitInput), spawn = resolve(spawnInput), destination = resolve(output);
if ([baseline, spawn].some(path => path === destination || destination.startsWith(path + '/')))
  throw new Error('Output must be separate from inputs');

const required = ['index.html', 'signal.svg', 'spawn.css', 'spawn.js'];
const instances = await readdir(spawn, { withFileTypes: true });
if (instances.some(file => !file.isFile()) || instances.map(file => file.name).sort().join() !== required.join())
  throw new Error('Unexpected files in Spawn build output');
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
async function baselineFile(name, expected) {
  const path = resolve(baseline, name);
  if (!(await lstat(path)).isFile()) throw new Error('Expected regular file ' + name);
  const bytes = await readFile(path);
  if (digest('sha1', bytes) !== expected) throw new Error('Unexpected published baseline for ' + name);
  return bytes;
}
const previous = (await baselineFile('index.html', '9e54214908a2310ab52fe54532f0a07e089c4060')).toString();
const manifest = JSON.parse(await baselineFile('manifest.json', '2a1c86798b85183192be5c8c8c35d0deb62d6a44'));
const before = 'class="action-primary" href="#playground">Explore access';
if (previous.split(before).length !== 2) throw new Error('Unexpected landing page action');
const assets = new Map([['index.html', Buffer.from(previous.replace(before, 'class="action-primary" href="/agentkit/spawn/">Spawn a GH0ST'))]]);
for (const name of required) assets.set('spawn/' + name, await readFile(resolve(spawn, name)));
const files = new Map(manifest.files.map(entry => [entry.file, entry]));
for (const [file, bytes] of assets) files.set(file, { file, bytes: bytes.length, sha256: digest('sha256', bytes) });
manifest.files = [...files.values()].sort((a, b) => a.file.localeCompare(b.file));
assets.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
await mkdir(resolve(destination, 'spawn'), { recursive: true });
for (const [file, bytes] of assets) await writeFile(resolve(destination, file), bytes);
