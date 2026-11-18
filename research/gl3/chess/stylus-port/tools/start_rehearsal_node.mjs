// Import the prepared archive into a new private database and start stock
// Nitro on loopback. Run only on a disposable Linux test worker.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length !== 5 || process.platform !== 'linux') {
  throw new Error('On the Linux test worker, pass NITRO_BIN NITRO_CHAIN_INFO IMPORT_DIR NEW_NODE_DIR RPC_PORT');
}
const [binary, chainInfo, importDir, dataDir] = args.slice(0, 4).map(arg => path.resolve(arg));
const port = Number(args[4]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const source = readJson(chainInfo).find(row => row['chain-name'] === 'arb-dev-test'
  && row['chain-config']?.chainId === 412346);
if (!source) throw new Error('Expected stock Nitro development-chain parameters');
const info = {
  ...source,
  'chain-name': 'gl3-stockfish-rehearsal',
  'chain-config': {
    ...source['chain-config'],
    arbitrum: { ...source['chain-config'].arbitrum, InitialArbOSVersion: 61, AllowDebugPrecompiles: false },
  },
};
const initFile = path.join(importDir, 'init.json');
const init = readJson(initFile);
if (init.NextBlockNumber !== 0 || init.AccountsPath !== 'accounts.json'
    || fs.statSync(path.join(importDir, init.AccountsPath)).size === 0) {
  throw new Error('An isolated rehearsal import is required');
}
fs.mkdirSync(dataDir, { mode: 0o700 });
const common = ['--dev', '--chain.name', info['chain-name'], '--chain.info-json', JSON.stringify([info]),
  '--persistent.chain', path.join(dataDir, 'chain'), '--persistent.global-config', path.join(dataDir, 'global'),
  '--http.addr=127.0.0.1', `--http.port=${port}`, '--http.api=net,web3,eth,arb',
  '--auth.addr=', '--ipc.path=', '--ws.addr=', '--node.batch-poster.enable=false',
  '--node.staker.enable=false', '--execution.parent-chain-reader.enable=false',
  '--execution.stylus-target.allow-offchain-activation=false', '--execution.sequencer.max-block-speed=100ms',
  '--execution.sequencer.poll-interval=5ms', '--version-alerter.enable=false',
  '--file-logging.enable=false', '--node.feed.output.enable=false', '--log-level=WARN'];
// Import and dev initialization are mutually exclusive for a fresh database.
// The second invocation reopens the database, and --dev supplies the private
// initial consensus message without a parent chain or any production state.
const imported = spawnSync(binary, [...common, '--init.dev-init=false',
  `--init.import-file=${initFile}`, '--init.then-quit'], { stdio: 'inherit', timeout: 480_000 });
if (imported.error || imported.status !== 0) {
  throw new Error('Archive import failed', { cause: imported.error || imported.signal || imported.status });
}
const node = spawn(binary, common, { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => node.kill(signal));
node.on('error', error => { console.error(error.message); process.exitCode = 1; });
node.on('exit', code => { process.exitCode = code ?? 1; });
