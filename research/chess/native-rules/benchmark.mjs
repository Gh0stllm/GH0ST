// Local EVM receipts for a pinned third-party rules comparison. No public RPC or signer.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';
import { Chess } from 'chess.js';

const file = name => new URL(name, import.meta.url);
const source = name => readFileSync(file(name), 'utf8');
const raw = source('vendor/MoveVerification.sol');
const gitBlob = createHash('sha1').update(`blob ${Buffer.byteLength(raw)}\0`).update(raw).digest('hex');
if (gitBlob !== '61cc22012af502e56a4b52a298f74bd071ef27c9') throw new Error('Pinned third-party source mismatch');
const input = {
  language: 'Solidity',
  sources: {
    'vendor/MoveVerification.sol': { content: raw },
    'contracts/RuleCostGame.sol': { content: source('contracts/RuleCostGame.sol') },
    '@openzeppelin/contracts/utils/math/Math.sol': { content: source('contracts/BenchmarkMath.sol') },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
const failures = (compiled.errors || []).filter(e => e.severity === 'error');
if (failures.length) throw new Error(failures.map(e => e.formattedMessage).join('\n'));
const rulesArtifact = compiled.contracts['vendor/MoveVerification.sol'].MoveVerification;
const gameArtifact = compiled.contracts['contracts/RuleCostGame.sol'].RuleCostGame;
const engine = ganache.provider({
  chain: { chainId: 31337, hardfork: 'shanghai', allowUnlimitedContractSize: true },
  miner: { blockGasLimit: 32_000_000 }, wallet: { deterministic: true }, logging: { quiet: true },
});
const provider = new BrowserProvider(engine, undefined, { cacheTimeout: -1, pollingInterval: 10 });
const report = {
  scope: 'Isolated local EVM third-party move-validation/state-write cost comparison; no GH0ST engine, prize escrow or public deployment',
  generatedAt: new Date().toISOString(), chainId: 31337, compiler: solc.version(),
  settings: input.settings,
  upstream: { repository: 'https://github.com/Chess-Fish/v1-core', commit: '97f9a0e8579da597fe07a71b5a7419ae76899249', blob: gitBlob, license: 'MIT' },
  importStandIn: 'Only uint256 min/max are supplied locally; upstream verifier source is byte-identical',
  limitations: ['Autoqueen only: underpromotion is not implemented', 'No threefold/50-move claim journal in the comparison wrapper', 'No Stockfish search, NNUE, entry fee or reward integration', 'Local receipt gas excludes Robinhood parent-chain data charges'],
  deployments: [], cases: [],
};
const tests = [
  ['black-checkmate', 'f2f3 e7e5 g2g4 d8h4', 3],
  ['white-checkmate', 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7', 2],
  ['both-castles', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8', 0],
  ['en-passant-capture', 'e2e4 a7a6 e4e5 d7d5 e5d6 e7d6', 0],
  ['both-queen-promotions', 'a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2 b7a8q g2h1q', 0],
];
const pieces = { p: 1, b: 2, n: 3, r: 4, q: 5, k: 6 };
function packedBoard(chess) {
  let value = 0n;
  for (const rank of chess.board()) for (const piece of rank) if (piece) {
    const i = piece.square.charCodeAt(0) - 97 + 8 * (Number(piece.square[1]) - 1);
    value |= BigInt(pieces[piece.type] + (piece.color === 'b' ? 8 : 0)) << BigInt(4 * i);
  }
  return value;
}
function encoded(uci) {
  const index = square => square.charCodeAt(0) - 97 + 8 * (Number(square[1]) - 1);
  return (index(uci.slice(0, 2)) << 6) | index(uci.slice(2, 4));
}
let receipts = 0;
try {
  const signer = await provider.getSigner();
  const deploy = async (name, artifact, args = []) => {
    const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
    const receipt = await contract.deploymentTransaction().wait(); receipts++;
    report.deployments.push({ name, runtimeBytes: artifact.evm.deployedBytecode.object.length / 2, initcodeBytes: artifact.evm.bytecode.object.length / 2, gas: String(receipt.gasUsed), transactionHash: receipt.hash });
    return contract;
  };
  const rules = await deploy('PinnedChessFishMoveVerifier', rulesArtifact);
  for (const [name, line, expected] of tests) {
    const game = await deploy(`RuleCostGame:${name}`, gameArtifact, [await rules.getAddress()]);
    const chess = new Chess(); const moves = [];
    for (const uci of line.split(' ')) {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] } : {}) });
      const receipt = await (await game.play(encoded(uci))).wait(); receipts++;
      const actual = await game.board();
      if (actual !== packedBoard(chess)) throw new Error(`Board mismatch ${name}:${uci}`);
      if (await game.blackToMove() !== (chess.turn() === 'b')) throw new Error(`Turn mismatch ${name}:${uci}`);
      moves.push({ uci, gas: String(receipt.gasUsed), transactionHash: receipt.hash, fen: chess.fen() });
    }
    const outcome = Number(await game.outcome());
    if (outcome !== expected) throw new Error(`Wrong terminal outcome ${name}: ${outcome}`);
    if ((expected === 2 || expected === 3) && !chess.isCheckmate()) throw new Error('Reference does not agree on mate');
    report.cases.push({ name, outcome, referenceCheckmate: chess.isCheckmate(), finalFen: chess.fen(), moves });
    console.log(name, moves.length, 'plies', 'outcome', outcome);
  }
  const invalid = await deploy('RuleCostGame:illegal-move', gameArtifact, [await rules.getAddress()]);
  let rejected = false; try { await invalid.play.staticCall(encoded('e2e5')); } catch { rejected = true; }
  if (!rejected) throw new Error('Illegal pawn move accepted');
  report.illegalMoveRejected = true;
  report.localReceipts = receipts;
  const gas = report.cases.flatMap(c => c.moves.map(m => Number(m.gas)));
  report.moveGas = { minimum: Math.min(...gas), maximum: Math.max(...gas), mean: Math.round(gas.reduce((a, b) => a + b, 0) / gas.length), plies: gas.length };
  report.passed = true;
  writeFileSync(file('results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, localReceipts: receipts, moveGas: report.moveGas, deployments: report.deployments.slice(0, 2) }, null, 2));
} finally { await engine.disconnect(); }
