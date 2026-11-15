// Independent chess.js replay of completed native-proxy match evidence only.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
const runId = process.argv[2] || 'baseline-3m';
if (!/^[a-z0-9-]+$/.test(runId)) throw new Error('Invalid local run ID');
const root = new URL('./results/' + runId + '/', import.meta.url);
const config = JSON.parse(readFileSync(new URL('config.json', root), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const report = { scope: 'Independent chess.js legal replay of completed native CPU proxy games, not Solidity/ICP execution or a strength rating', checkedAt: new Date().toISOString(), library: 'chess.js 1.4.0', completedOnly: true, games: [] };
for (const job of config.jobs) {
  const path = new URL(job.id + '.json', root);
  if (!existsSync(path)) continue;
  const raw = readFileSync(path); const game = JSON.parse(raw);
  if (!game.completed) continue;
  const board = new Chess();
  for (const record of game.moves) {
    if (board.fen() !== record.fen_before) throw new Error(`Starting FEN differs at ${job.id}:${record.ply}`);
    const uci = record.uci;
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) });
    if (move.san !== record.san) throw new Error('SAN differs');
  }
  if (board.fen() !== game.final_fen || board.history().length !== game.plies) throw new Error(`Final position differs: ${job.id}`);
  const pgnText = readFileSync(new URL(job.id + '.pgn', root), 'utf8');
  const pgnBoard = new Chess(); pgnBoard.loadPgn(pgnText);
  if (pgnBoard.fen() !== board.fen()) throw new Error('PGN final position differs');
  let valid = false;
  if (game.termination === 'checkmate') valid = board.isCheckmate() && game.result === (board.turn() === 'b' ? '1-0' : '0-1');
  else if (game.termination === 'insufficient_material') valid = board.isInsufficientMaterial() && game.result === '1/2-1/2';
  else if (game.termination === 'stalemate') valid = board.isStalemate() && game.result === '1/2-1/2';
  else if (game.termination === 'claimed_threefold_current') valid = board.turn() === 'b' && board.isThreefoldRepetition() && game.result === '1/2-1/2';
  else if (game.termination === 'claimed_fifty_moves_current') valid = board.turn() === 'b' && board.isDrawByFiftyMoves() && game.result === '1/2-1/2';
  else throw new Error(`Add an independent validator for terminal reason: ${game.termination}`);
  if (!valid) throw new Error(`Terminal result disagrees: ${job.id}`);
  report.games.push({ id: job.id, plies: game.plies, result: game.result, termination: game.termination, jsonSha256: sha(raw), pgnSha256: sha(pgnText), legalReplayAndTerminalAgreed: true });
}
report.completedGamesVerified = report.games.length; report.passed = true;
writeFileSync(new URL('validation-js-completed.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
