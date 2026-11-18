import { Chess } from 'chess.js';
import { formatUnits, ZeroHash } from 'ethers';
import { ENTRY_FEE, TOTAL_PRIZE, fenBoard, readableError, same, shorten } from '../../../../chess/frontend/core.mjs';
import { GL3ChessWallet, GL3_EXPLORER } from './wallet.mjs';

const $ = id => document.getElementById(id);
const symbols = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const pieceNames = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const outcomes = [
  '', 'White won by checkmate', 'Stockfish won by checkmate', 'Draw', 'White resigned',
  'White ran out of time', 'Stockfish timed out · entry refunded', 'Engine limit reached · entry refunded',
];
const searchActions = [
  ['Start search', 'beginBotSearch'],
  ['Advance one step', 'advanceBotSearch'],
  ['Apply Stockfish move', 'applyBotMove'],
];
const state = {
  wallet: null,
  network: null,
  position: null,
  chess: null,
  selection: '',
  gameId: '',
  account: null,
  balance: 0n,
  credit: 0n,
  progress: null,
  busy: false,
};

function amount(value) {
  const [whole, fraction] = formatUnits(value, 18).split('.');
  return BigInt(whole).toLocaleString() + (fraction === '0' ? '' : `.${fraction}`);
}

function notice(message) {
  $('notice').textContent = message;
}

function pendingAction() {
  if (!state.wallet) return { draft: null, blocked: false };
  try {
    const draft = state.wallet.pending();
    return { draft, blocked: Boolean(draft) };
  } catch {
    return { draft: null, blocked: true };
  }
}

function selectGame(gameId) {
  state.gameId = gameId;
  state.selection = '';
  state.progress = null;
  $('game-id').value = gameId;
  try {
    localStorage.setItem(`${state.wallet.key}:game`, gameId);
  } catch {
    // The game remains available by ID if optional local selection storage is blocked.
  }
}

function savedGame() {
  try {
    return localStorage.getItem(`${state.wallet.key}:game`) || '';
  } catch {
    return '';
  }
}

function setPosition(position) {
  const old = state.position;
  if (!same(old?.gameId, position?.gameId) || old?.game.ply !== position?.game.ply
      || old?.game.result !== position?.game.result) {
    state.selection = '';
    state.progress = null;
    state.chess = position ? new Chess() : null;
    for (const move of position?.moves || []) state.chess.move(move.uci);
  }
  if (state.progress?.step !== position?.search.step) state.progress = null;
  state.position = position;
}

function renderBoard(canPlay) {
  const board = $('board');
  const position = state.position;
  board.hidden = !position;
  $('empty-board').hidden = Boolean(position);
  if (!position) {
    board.replaceChildren();
    return;
  }
  const focus = board.contains(document.activeElement) ? document.activeElement.dataset.square : null;
  const legal = canPlay ? state.chess.moves({ verbose: true }) : [];
  const sources = new Set(legal.map(move => move.from));
  const targets = new Set(legal.filter(move => move.from === state.selection).map(move => move.to));
  const squares = fenBoard(position.fen).map(({ square, piece, row, file }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'square';
    button.classList.toggle('dark', Boolean((row + file) % 2));
    button.classList.toggle('selected', canPlay && state.selection === square);
    button.classList.toggle('legal', targets.has(square));
    button.dataset.square = square;
    button.disabled = !sources.has(square) && !targets.has(square);
    const white = piece === piece?.toUpperCase();
    button.setAttribute('aria-label', piece
      ? `${square}, ${white ? 'white' : 'black'} ${pieceNames[piece.toUpperCase()]}`
      : square);
    if (sources.has(square)) button.setAttribute('aria-pressed', String(state.selection === square));
    if (piece) {
      const icon = document.createElement('span');
      icon.className = white ? 'piece white' : 'piece';
      icon.textContent = symbols[piece.toUpperCase()];
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
    }
    if (row === 7 || file === 0) {
      for (const [className, value] of [
        ...(row === 7 ? [['file', square[0]]] : []),
        ...(file === 0 ? [['rank', square[1]]] : []),
      ]) {
        const coordinate = document.createElement('span');
        coordinate.className = `coordinate ${className}`;
        coordinate.textContent = value;
        coordinate.setAttribute('aria-hidden', 'true');
        button.append(coordinate);
      }
    }
    return button;
  });
  board.replaceChildren(...squares);
  if (focus) squares.find(button => button.dataset.square === focus && !button.disabled)?.focus();
}

function render() {
  const { wallet, network, position, busy, chess } = state;
  const { draft, blocked } = pendingAction();
  const account = wallet?.account;
  const verified = Boolean(network && wallet?.verified);
  const canSend = Boolean(verified && account && !busy && !blocked);
  const active = Boolean(verified && position && position.game.result === 0n
    && same(position.gameId, network.activeGameId));
  const ownsGame = same(account, position?.game.player) && Boolean(account);
  const expired = active && BigInt(network.block.timestamp) > position.game.turnDeadline;
  const botTurn = active && position.game.blackToMove;
  const canPlay = canSend && active && ownsGame && !botTurn && !expired;

  $('connect').disabled = !verified || busy;
  $('connect').textContent = account ? shorten(account) : 'Connect wallet';
  $('enter').disabled = !canSend || !network.engineReady || network.paused
    || network.activeGameId !== ZeroHash || network.pendingEngineRelease !== ZeroHash
    || network.freePool < TOTAL_PRIZE || state.balance < ENTRY_FEE;
  $('load-button').disabled = !verified || busy;
  $('refresh').disabled = !wallet || busy;
  $('credit').textContent = account ? `${amount(state.credit)} GH0ST claimable`
    : 'Connect your wallet to view your balance.';
  $('claim').disabled = !canSend || state.credit === 0n;

  $('game-actions').hidden = !active;
  $('draw').disabled = !canPlay || (position.game.halfmoveClock < 100n && !chess.isThreefoldRepetition());
  $('resign').disabled = !canSend || !ownsGame || !active;
  $('timeout').disabled = !canSend || !expired;
  $('turn').textContent = position
    ? outcomes[Number(position.game.result)] || (botTurn ? 'Stockfish to move' : 'White to move')
    : 'No game selected';
  const deadline = $('deadline');
  deadline.textContent = '';
  deadline.removeAttribute('datetime');
  if (active) {
    const date = new Date(Number(position.game.turnDeadline) * 1000);
    deadline.dateTime = date.toISOString();
    deadline.textContent = expired ? 'Deadline passed' : `Until ${date.toLocaleString()}`;
  }
  renderBoard(canPlay);

  const phase = Number(position?.search.phase ?? 0);
  const { progress } = state;
  $('engine-state').textContent = progress
    ? progress.pending
      ? `Step ${progress.step} · ${progress.observedNodes.toLocaleString()} nodes searched`
      : `${progress.move} · ${progress.actualNodes.toLocaleString()} nodes · depth ${progress.depth}`
    : ['No search in progress.', `Search step ${position?.search.step ?? 0n}`, 'Stockfish move ready.'][phase];
  $('progress').disabled = !verified || busy || !network.engineReady || phase === 0;
  const engineAction = $('engine-action');
  engineAction.hidden = !botTurn || !searchActions[phase];
  engineAction.disabled = !canSend || !network.engineReady || expired;
  engineAction.textContent = searchActions[phase]?.[0] ?? '';
  const release = $('release');
  release.hidden = !verified || network.pendingEngineRelease === ZeroHash;
  release.disabled = !canSend || !network.engineReady;

  $('recovery').hidden = !blocked;
  $('resolve').hidden = !draft;
  $('receipt-text').textContent = draft?.hash
    ? 'Verify the saved receipt before sending another transaction.'
    : draft ? 'Paste the hash from your wallet to verify the saved transaction.'
      : 'Allow this site to store your pending transaction before using the wallet.';
  if (draft?.hash) $('transaction-hash').value = draft.hash;
  $('transaction-hash').readOnly = Boolean(draft?.hash);
  $('resolve-button').disabled = !draft || busy;
  $('moves').replaceChildren(...(position?.moves || []).map(move => {
    const item = document.createElement('li');
    item.textContent = move.san;
    return item;
  }));
}

async function refresh(network = null) {
  const { wallet } = state;
  state.network = network ?? await wallet.verify();
  const at = state.network.block.number;
  const account = wallet.account;
  const defaultGame = [state.network.activeGameId, state.network.pendingEngineRelease].find(id => id !== ZeroHash);
  if (defaultGame && !state.gameId) selectGame(defaultGame);
  const [position, balance, credit] = await Promise.all([
    state.gameId ? wallet.game(state.gameId, at) : null,
    account ? wallet.provider.getBalance(account, at) : 0n,
    account ? wallet.contract.claimable(account, { blockTag: at }) : 0n,
  ]);
  state.account = same(account, wallet.account) ? account : null;
  state.balance = state.account ? balance : 0n;
  state.credit = state.account ? credit : 0n;
  setPosition(position);
}

function networkNotice() {
  const { network, position, gameId, wallet } = state;
  if (gameId && !position) return 'No verified game was found for that ID.';
  if (position) return `Verified at GL3 block #${position.blockNumber.toLocaleString()}. Player ${shorten(position.game.player)}.`;
  if (!network.engineReady) return 'Paid entry opens when GL3 confirms the Stockfish engine.';
  if (network.paused) return 'Paid entry is currently paused.';
  if (network.pendingEngineRelease !== ZeroHash) return 'A finished game is still releasing its Stockfish search slot.';
  if (network.freePool < TOTAL_PRIZE) return 'Paid entry opens when 1,000,000 GH0ST is available for the prize.';
  if (wallet.account && state.balance < ENTRY_FEE) return 'Entry requires 25,000 GH0ST plus network gas.';
  return 'The next game is open. One game runs at a time.';
}

async function run(work, { quiet = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const status = await work();
    if (status && !quiet) notice(status);
  } catch (error) {
    if (!state.wallet?.verified) state.network = null;
    if (!quiet || !state.network) notice(readableError(error));
  } finally {
    state.busy = false;
    render();
  }
}

async function showReceipt(result) {
  if (!result) return 'There is no saved transaction to reconcile.';
  if (result.position) {
    selectGame(result.position.gameId);
    setPosition(result.position);
  }
  $('explorer').href = `${GL3_EXPLORER}#q=${result.receipt.hash}`;
  $('last-transaction').hidden = false;
  const message = result.payout ? `${amount(result.payout.amount)} GH0ST paid.`
    : result.settlement ? outcomes[Number(result.settlement.result)] : 'Transaction confirmed on GL3.';
  try {
    await refresh();
  } catch {
    state.network = null;
    return `${message} Use Refresh to reload the current game.`;
  }
  return message;
}

function transact(method, ...args) {
  return run(async () => {
    notice('Waiting for your wallet and GL3 confirmation…');
    return showReceipt(await state.wallet[method](...args));
  });
}

function choosePromotion() {
  const dialog = $('promotion');
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
}

$('board').addEventListener('click', async event => {
  const button = event.target.closest('button[data-square]');
  if (!button || button.disabled || state.busy || !state.chess) return;
  const { square } = button.dataset;
  const { position, selection } = state;
  const legal = state.chess.moves({ verbose: true });
  const moves = legal.filter(move => move.from === selection && move.to === square);
  if (!moves.length) {
    state.selection = selection === square ? '' : square;
    render();
    return;
  }
  const promotion = moves.length > 1 ? await choosePromotion() : moves[0].promotion;
  const chosen = moves.find(move => move.promotion === promotion);
  if (chosen && state.position?.game.ply === position.game.ply && same(state.gameId, position.gameId)) {
    await transact('humanMove', position.gameId, chosen.from + chosen.to + (chosen.promotion || ''));
  }
});

$('connect').addEventListener('click', () => run(async () => {
  const connected = await state.wallet.connect();
  await refresh(connected);
  return networkNotice();
}));
$('load').addEventListener('submit', event => {
  event.preventDefault();
  if ($('load-button').disabled) return;
  run(async () => {
    const id = $('game-id').value.trim();
    if (!/^0x[0-9a-f]{64}$/i.test(id) || same(id, ZeroHash)) throw new Error('Enter a valid game ID.');
    selectGame(id);
    setPosition(null);
    await refresh();
    return networkNotice();
  });
});
$('refresh').addEventListener('click', () => run(async () => {
  await refresh();
  return networkNotice();
}));
$('progress').addEventListener('click', () => run(async () => {
  await refresh();
  state.progress = await state.wallet.engineProgress(state.gameId);
  return state.progress ? 'Stockfish progress verified on GL3.' : networkNotice();
}));
$('resolve').addEventListener('submit', event => {
  event.preventDefault();
  if ($('resolve-button').disabled) return;
  run(async () => showReceipt(await state.wallet.resolve($('transaction-hash').value.trim())));
});
for (const [id, method] of [
  ['enter', 'enter'],
  ['draw', 'claimDraw'],
  ['resign', 'resign'],
  ['timeout', 'claimTimeout'],
  ['claim', 'claimPayout'],
]) {
  $(id).addEventListener('click', () => {
    if (id === 'resign' && !window.confirm('Resign this game and forfeit the entry fee?')) return;
    if (id === 'enter' || id === 'claim') transact(method);
    else transact(method, state.gameId);
  });
}
$('engine-action').addEventListener('click', () => {
  const method = searchActions[Number(state.position?.search.phase)]?.[1];
  if (method) transact(method, state.gameId);
});
$('release').addEventListener('click', () => transact('releaseEndedGame', state.network.pendingEngineRelease));

async function releaseFile(name) {
  const response = await fetch(`./${name}`, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The verified GL3 chess release is unavailable.');
  }
  return response.json();
}

await run(async () => {
  const [release, artifact] = await Promise.all([releaseFile('public-config.json'), releaseFile('game-artifact.json')]);
  let storage;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  state.wallet = new GL3ChessWallet(release, artifact, { storage });
  const remembered = savedGame();
  if (/^0x[0-9a-f]{64}$/i.test(remembered) && !same(remembered, ZeroHash)) selectGame(remembered);
  await refresh();
  return networkNotice();
});

function walletChanged() {
  state.selection = '';
  state.balance = 0n;
  state.credit = 0n;
  render();
}
window.ethereum?.on?.('accountsChanged', walletChanged);
window.ethereum?.on?.('chainChanged', walletChanged);
window.addEventListener('storage', () => render());

const timer = window.setInterval(() => {
  if (!state.wallet || document.hidden || state.busy || $('promotion').open) return;
  if (!state.position || state.position.game.result !== 0n) return;
  run(async () => {
    await refresh();
    return networkNotice();
  }, { quiet: true });
}, 15_000);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  window.clearInterval(timer);
  state.wallet?.dispose();
  window.ethereum?.removeListener?.('accountsChanged', walletChanged);
  window.ethereum?.removeListener?.('chainChanged', walletChanged);
});
