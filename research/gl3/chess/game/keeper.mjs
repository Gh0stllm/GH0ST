// Permissionless Stockfish step keeper for an already activated GL3 game.
// Prints the next action by default. --run signs only engine progress calls.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
if (args.length !== 2 && !(args.length === 5 && args[2] === '--run')) {
  throw new Error('Pass LIVE_RELEASE_JSON GAME_ARTIFACT_JSON [--run PRIVATE_KEY_FILE PENDING_JOURNAL]');
}
const [releasePath, artifactPath, mode, keyPath, journalPath] = args;
const { Contract, JsonRpcProvider, Wallet, ZeroHash, getAddress, keccak256 } = createRequire(
  fileURLToPath(new URL('../../../chess/package.json', import.meta.url)),
)('ethers');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const release = readJson(releasePath);
const artifact = readJson(artifactPath);
const chainId = 4_663_001n;
const rpc = 'https://rpc.gh0st.fyi/';
const genesis = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
if (release.schemaVersion !== 1 || release.status !== 'live' || release.chainId !== Number(chainId) || release.publicRpc !== rpc
    || release.genesisHash?.toLowerCase() !== genesis || !/^0x[0-9a-f]{64}$/i.test(release.coordinatorRuntimeHash || '')
    || artifact.contractName !== 'GL3StockfishChess' || !Array.isArray(artifact.abi)) {
  throw new Error('A live GL3 game release and its compiled ABI are required');
}
const address = getAddress(release.coordinator);
const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
const game = new Contract(address, artifact.abi, provider);
const [network, genesisBlock, code] = await Promise.all([provider.getNetwork(), provider.getBlock(0), provider.getCode(address)]);
if (network.chainId !== chainId || genesisBlock?.hash !== genesis || code === '0x'
    || keccak256(code) !== release.coordinatorRuntimeHash.toLowerCase()) {
  throw new Error('GL3 chain or deployed game runtime differs from the release');
}

let wallet;
if (mode === '--run') {
  if ((fs.statSync(keyPath).mode & 0o077) !== 0) throw new Error('The keeper key file must be private');
  wallet = new Wallet(fs.readFileSync(keyPath, 'utf8').trim(), provider);
}

async function nextAction() {
  const block = await provider.getBlock('latest');
  if (!block) throw new Error('GL3 did not return a current block');
  const at = { blockTag: block.number };
  if (!(await game.engineReady(at))) return null;
  const releaseId = await game.pendingEngineRelease(at);
  if (releaseId !== ZeroHash) return { method: 'releaseEndedGame', args: [releaseId] };

  const id = await game.activeGameId(at);
  if (id === ZeroHash) return null;
  const board = await game.getGame(id, at);
  if (board.result !== 0n || !board.blackToMove || BigInt(block.timestamp) > board.turnDeadline) return null;
  const search = await game.getSearch(id, at);
  if (search.phase === 0n) return { method: 'beginBotSearch', args: [id, board.ply, board.positionHash] };
  if (search.ply !== board.ply || search.positionHash !== board.positionHash
      || search.transcriptHash !== board.transcriptHash) throw new Error('Engine progress is bound to a different board');
  if (search.phase === 1n) return { method: 'advanceBotSearch', args: [id, search.generation, search.step] };
  if (search.phase === 2n) return { method: 'applyBotMove', args: [id, search.generation, search.step, search.root] };
  throw new Error('Unknown engine phase');
}

async function resolvePending() {
  if (!fs.existsSync(journalPath)) return;
  const pending = readJson(journalPath);
  if (pending.wallet !== wallet.address || pending.target !== address
      || !/^0x[0-9a-f]{64}$/i.test(pending.hash || '')) throw new Error('Pending journal identity differs');
  const receipt = await provider.getTransactionReceipt(pending.hash);
  if (!receipt) throw new Error(`Keeper transaction unresolved: ${pending.hash}`);
  const tx = await provider.getTransaction(pending.hash);
  if (!tx || tx.from !== wallet.address || tx.to !== address || tx.data !== pending.data
      || tx.nonce !== pending.nonce || tx.value !== 0n || receipt.status !== 1) {
    throw new Error(`Review the keeper transaction before continuing: ${pending.hash}`);
  }
  fs.unlinkSync(journalPath);
}

async function send(action) {
  const tx = await game.getFunction(action.method).populateTransaction(...action.args);
  const nonce = await provider.getTransactionCount(wallet.address, 'latest');
  if (await provider.getTransactionCount(wallet.address, 'pending') !== nonce) {
    throw new Error('The keeper wallet has a pending transaction');
  }
  const populated = await wallet.populateTransaction({ ...tx, nonce, value: 0n });
  if (populated.chainId !== chainId || getAddress(populated.to) !== address) throw new Error('Wrong transaction target');
  const raw = await wallet.signTransaction(populated);
  const hash = keccak256(raw);
  fs.writeFileSync(journalPath, JSON.stringify({ hash, data: tx.data, nonce, wallet: wallet.address, target: address }) + '\n',
    { flag: 'wx', mode: 0o600 });
  const submitted = await provider.broadcastTransaction(raw);
  if (submitted.hash !== hash) throw new Error('The returned transaction hash differs');
  process.stdout.write(`${action.method} ${hash}\n`);
  await submitted.wait(1, 45_000);
  await resolvePending();
}

if (!wallet) {
  const action = await nextAction();
  process.stdout.write(JSON.stringify(action, (_, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
} else {
  const parent = path.dirname(path.resolve(journalPath));
  if (!fs.statSync(parent).isDirectory()) throw new Error('Use an existing journal directory');
  await resolvePending();
  for (;;) {
    const action = await nextAction();
    if (action) await send(action);
    else await sleep(2_000);
  }
}
