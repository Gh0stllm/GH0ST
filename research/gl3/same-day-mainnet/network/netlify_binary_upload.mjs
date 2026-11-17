// Binary transport for the reviewed additional function. Reuses the existing
// CLI's normal authentication helper; never searches credential files or prints
// a token. Root/operator execution only; this source has not uploaded anything.
import { readFileSync, createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
try {
  const cli = resolve(process.argv[2]), root = resolve(dirname(cli), '..');
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.name !== 'gl3-rpc' || !/^[a-f0-9]{24}$/.test(input.deployId) || !resolve(input.file).endsWith('/gl3-rpc.zip')) throw Error('Unreviewed upload binding');
  const { getToken } = await import(pathToFileURL(root + '/dist/utils/command-helpers.js'));
  const [token] = await getToken(); if (!token) throw Error('Existing CLI is not authenticated');
  const require = createRequire(cli), { NetlifyAPI } = await import(pathToFileURL(require.resolve('@netlify/api')));
  const api = new NetlifyAPI(token);
  const r = await api.uploadDeployFunction({ deploy_id: input.deployId, name: input.name, runtime: 'js', body: () => createReadStream(input.file) });
  process.stdout.write(JSON.stringify({ name: r.name, sha: r.sha, uploaded: true }));
} catch { process.stderr.write('Reviewed Netlify function upload failed; credentials and raw response withheld.\n'); process.exitCode = 1; }
