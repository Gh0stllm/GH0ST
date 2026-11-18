import {
  AbiCoder, BrowserProvider, Contract, ContractFactory, JsonRpcProvider,
  ZeroAddress, ZeroHash, getAddress, id, keccak256,
} from 'ethers';
import { Chess } from 'chess.js';
import {
  ENTRY_FEE, TOTAL_PRIZE, boardFen, decodeMove, encodeMove, hex,
  matchRuntime, randomBytes, same,
} from '../../../../chess/frontend/core.mjs';

export const GL3_CHAIN_ID = 4_663_001n;
export const GL3_RPC = 'https://rpc.gh0st.fyi/';
export const GL3_EXPLORER = 'https://scan.gh0st.fyi/';
export const GL3_GENESIS = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
const CHAIN_HEX = '0x' + GL3_CHAIN_ID.toString(16);
const HISTORY_START = id('GH0ST_CHESS_INITIAL_V1');
const abi = AbiCoder.defaultAbiCoder();

function exactHash(value) {
  return /^0x[0-9a-f]{64}$/i.test(value ?? '') && !same(value, ZeroHash);
}

export function validateGL3ChessRelease(release) {
  if (release?.schemaVersion !== 1 || release.status !== 'live'
      || release.chainId !== Number(GL3_CHAIN_ID)
      || release.publicRpc !== GL3_RPC || !same(release.genesisHash, GL3_GENESIS)) {
    throw new Error('A verified GL3 chess release is required.');
  }
  for (const key of ['coordinatorRuntimeHash', 'deploymentTransaction', 'engineModuleHash', 'engineSeedRoot']) {
    if (!exactHash(release[key])) throw new Error(`Missing verified ${key}.`);
  }
  const coordinator = getAddress(release.coordinator);
  const poolOwner = getAddress(release.poolOwner);
  if (coordinator === ZeroAddress || poolOwner === ZeroAddress || coordinator === poolOwner) {
    throw new Error('The release has an invalid coordinator or pool owner.');
  }
  return Object.freeze({ ...release, coordinator, poolOwner });
}

export class GL3ChessWallet {
  constructor(release, artifact, { ethereum = globalThis.ethereum, storage = globalThis.localStorage } = {}) {
    this.release = validateGL3ChessRelease(release);
    if (artifact?.contractName !== 'GL3StockfishChess' || !Array.isArray(artifact.abi)) {
      throw new Error('Use the reviewed GL3StockfishChess compiler artifact.');
    }
    this.artifact = artifact;
    this.ethereum = ethereum;
    this.storage = storage;
    this.key = `gh0st-gl3-chess-intent-v1:${this.release.coordinator.toLowerCase()}`;
    this.provider = new JsonRpcProvider(GL3_RPC, undefined, { cacheTimeout: -1 });
    this.contract = new Contract(this.release.coordinator, artifact.abi, this.provider);
    this.clearWallet = () => { this.account = null; this.signer = null; this.browser = null; };
    this.clearWallet();
    this.busy = false;
    ethereum?.on?.('accountsChanged', this.clearWallet);
    ethereum?.on?.('chainChanged', this.clearWallet);
  }

  dispose() {
    this.ethereum?.removeListener?.('accountsChanged', this.clearWallet);
    this.ethereum?.removeListener?.('chainChanged', this.clearWallet);
    this.clearWallet();
    this.provider.destroy();
  }

  async verify() {
    this.verified = false;
    const c = this.release;
    const [network, genesis, block, deployment, receipt] = await Promise.all([
      this.provider.getNetwork(), this.provider.getBlock(0), this.provider.getBlock('latest'),
      this.provider.getTransaction(c.deploymentTransaction),
      this.provider.getTransactionReceipt(c.deploymentTransaction),
    ]);
    if (network.chainId !== GL3_CHAIN_ID || !same(genesis?.hash, GL3_GENESIS) || !block) {
      throw new Error('The RPC did not confirm canonical GL3.');
    }
    if (!deployment || !receipt || receipt.status !== 1 || deployment.to !== null
        || !same(receipt.contractAddress, c.coordinator)) {
      throw new Error('The coordinator deployment receipt differs from the release.');
    }
    const deploy = await new ContractFactory(this.artifact.abi, this.artifact.bytecode)
      .getDeployTransaction(c.poolOwner, c.engineSeedRoot);
    if (!same(deployment.data, deploy.data)) throw new Error('The original constructor differs from the release.');

    const at = { blockTag: block.number };
    const g = this.contract;
    const [code, owner, seed, module, chain, entry, prize, paused, activeGameId,
      pendingEngineRelease, freePool, totalReserved, totalClaimable, engineReady] = await Promise.all([
      this.provider.getCode(c.coordinator, block.number), g.owner(at), g.expectedSeedRoot(at),
      g.ENGINE_MODULE_SHA(at), g.CHAIN_ID(at), g.ENTRY_FEE(at), g.TOTAL_PRIZE(at),
      g.paused(at), g.activeGameId(at), g.pendingEngineRelease(at), g.freePool(at),
      g.totalReserved(at), g.totalClaimable(at), g.engineReady(at).catch(() => false),
    ]);
    if (!same(matchRuntime(code, this.artifact), c.coordinatorRuntimeHash)
        || !same(owner, c.poolOwner) || !same(seed, c.engineSeedRoot)
        || !same(module, c.engineModuleHash) || chain !== GL3_CHAIN_ID
        || entry !== ENTRY_FEE || prize !== TOTAL_PRIZE) {
      throw new Error('The coordinator code, engine identity or payout terms differ from the verified release.');
    }
    this.verified = true;
    return { block, paused, activeGameId, pendingEngineRelease, freePool,
      totalReserved, totalClaimable, engineReady };
  }

  async connect() {
    if (!this.ethereum) throw new Error('Open the game in a compatible EVM wallet.');
    await this.ethereum.request({ method: 'eth_requestAccounts' });
    if (BigInt(await this.ethereum.request({ method: 'eth_chainId' })) !== GL3_CHAIN_ID) {
      try {
        await this.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
      } catch (error) {
        if (Number(error.code) !== 4902) throw error;
        await this.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: CHAIN_HEX, chainName: 'GH0ST L3',
          nativeCurrency: { name: 'GH0ST', symbol: 'GH0ST', decimals: 18 },
          rpcUrls: [GL3_RPC], blockExplorerUrls: [GL3_EXPLORER],
        }] });
      }
    }
    const accounts = await this.ethereum.request({ method: 'eth_accounts' });
    if (!accounts[0] || BigInt(await this.ethereum.request({ method: 'eth_chainId' })) !== GL3_CHAIN_ID) {
      throw new Error('Select an account on GL3.');
    }
    const browser = new BrowserProvider(this.ethereum, undefined, { cacheTimeout: -1 });
    if (!same((await browser.getBlock(0))?.hash, GL3_GENESIS)) {
      throw new Error('The wallet RPC did not confirm canonical GL3.');
    }
    const account = getAddress(accounts[0]);
    const signer = await browser.getSigner(account);
    const state = await this.verify();
    this.browser = browser;
    this.account = account;
    this.signer = signer;
    await this.assertWallet();
    return { ...state, account, balance: await this.provider.getBalance(account, state.block.number) };
  }

  async assertWallet() {
    if (!this.account || !this.signer || !this.browser) throw new Error('Connect a GL3 wallet first.');
    const [accounts, chain] = await Promise.all([
      this.ethereum.request({ method: 'eth_accounts' }), this.ethereum.request({ method: 'eth_chainId' }),
    ]);
    if (!same(accounts[0], this.account) || BigInt(chain) !== GL3_CHAIN_ID) {
      this.clearWallet();
      throw new Error('The wallet account or network changed.');
    }
  }

  async game(gameId, blockTag) {
    if (!exactHash(gameId)) throw new Error('Enter a valid game ID.');
    if (!this.verified) await this.verify();
    const block = await this.provider.getBlock(blockTag ?? 'latest');
    if (!block) throw new Error('The game snapshot block is unavailable.');
    const at = { blockTag: block.number };
    const [g, encoded, search] = await Promise.all([
      this.contract.getGame(gameId, at), this.contract.getMoves(gameId, at), this.contract.getSearch(gameId, at),
    ]);
    if (g.player === ZeroAddress) return null;
    const replay = new Chess();
    let transcript = HISTORY_START;
    const moves = encoded.map((value, index) => {
      const uci = decodeMove(value);
      const result = replay.move(uci);
      if (!result) throw new Error('The on-chain move history failed independent replay.');
      transcript = keccak256(abi.encode(['bytes32', 'uint16'], [transcript, value]));
      return { uci, san: result.san, ply: index + 1 };
    });
    const position = keccak256(abi.encode(['uint256', 'uint8', 'uint8', 'bool'],
      [g.board, g.castling, g.enPassant, g.blackToMove]));
    const legal = replay.fen().split(' ');
    const stored = boardFen(g).split(' ');
    const last = replay.history({ verbose: true }).at(-1);
    const ep = last?.piece === 'p' && Math.abs(Number(last.from[1]) - Number(last.to[1])) === 2
      ? last.from.charCodeAt(0) - 97 + (Number(last.from[1]) + Number(last.to[1]) - 2) / 2 * 8 : 64;
    if (BigInt(moves.length) !== g.ply || !same(position, g.positionHash)
        || !same(transcript, g.transcriptHash) || ep !== Number(g.enPassant)
        || [0, 1, 2, 4, 5].some(i => legal[i] !== stored[i])) {
      throw new Error('The move history differs from the on-chain board and commitments.');
    }
    return { gameId, game: g, search, moves, fen: replay.fen(), blockNumber: block.number, blockHash: block.hash };
  }

  async engineProgress(gameId) {
    const state = await this.verify();
    if (!state.engineReady) throw new Error('The pinned Stockfish engine is unavailable.');
    const position = await this.game(gameId, state.block.number);
    if (!position || position.search.phase === 0n) return null;
    return this.contract.engineProgress(gameId, { blockTag: state.block.number });
  }

  async credit(account = this.account) {
    if (!account) throw new Error('Select an account to read its claimable GH0ST.');
    const state = await this.verify();
    return this.contract.claimable(getAddress(account), { blockTag: state.block.number });
  }

  enter() {
    return this.action('enterGame', null, async (state, account) => {
      if (!state.engineReady || state.paused || state.activeGameId !== ZeroHash
          || state.pendingEngineRelease !== ZeroHash || state.freePool < TOTAL_PRIZE) {
        throw new Error('Entry is closed. It requires a ready engine and 1,000,000 unreserved GH0ST.');
      }
      if (await this.provider.getBalance(account, state.block.number) < ENTRY_FEE) {
        throw new Error('Your wallet needs 25,000 GH0ST plus network gas.');
      }
      const nonce = BigInt(hex(randomBytes()));
      const gameId = keccak256(abi.encode(['uint256', 'address', 'address', 'uint256'],
        [GL3_CHAIN_ID, this.release.coordinator, account, nonce]));
      return { args: [nonce, { value: ENTRY_FEE }], gameId, nonce: nonce.toString() };
    });
  }

  humanMove(gameId, uci) {
    return this.action('playHumanMove', gameId, (state, account, position) => {
      this.requireGame(state, position);
      if (!same(position.game.player, account) || position.game.blackToMove) {
        throw new Error('Only the White player can play this turn.');
      }
      const board = new Chess(position.fen);
      if (!board.moves({ verbose: true }).some(m => m.from + m.to + (m.promotion || '') === uci)) {
        throw new Error('That move is illegal in the confirmed position.');
      }
      const move = encodeMove(uci);
      return { args: [gameId, move, position.game.ply], move, ply: String(position.game.ply + 1n) };
    });
  }

  beginBotSearch(gameId) { return this.engineAction('beginBotSearch', gameId, 0n); }
  advanceBotSearch(gameId) { return this.engineAction('advanceBotSearch', gameId, 1n); }
  applyBotMove(gameId) { return this.engineAction('applyBotMove', gameId, 2n); }

  engineAction(method, gameId, phase) {
    return this.action(method, gameId, async (state, _, position) => {
      this.requireGame(state, position);
      const { game, search } = position;
      if (!state.engineReady || !game.blackToMove || search.phase !== phase) {
        throw new Error('The confirmed board and engine state are not ready for this action.');
      }
      const args = phase === 0n ? [gameId, game.ply, game.positionHash] : [gameId, search.generation, search.step];
      if (phase !== 2n) return { args };
      const result = await this.contract.engineProgress(gameId, { blockTag: state.block.number });
      if (result.pending || !same(result.root, search.root) || result.step !== search.step) {
        throw new Error('The committed engine result differs from the game’s search.');
      }
      args.push(search.root);
      return { args, move: encodeMove(result.move), ply: String(game.ply + 1n) };
    });
  }

  claimDraw(gameId) { return this.gameAction('claimDraw', gameId, true); }
  resign(gameId) { return this.gameAction('resign', gameId, true); }
  claimTimeout(gameId) { return this.gameAction('claimTimeout', gameId, false); }

  gameAction(method, gameId, requiresPlayer) {
    return this.action(method, gameId, (state, account, position) => {
      this.requireGame(state, position);
      if (requiresPlayer && !same(position.game.player, account)) {
        throw new Error('Only the game’s player can take this action.');
      }
      return { args: [gameId] };
    });
  }

  releaseEndedGame(gameId) {
    return this.action('releaseEndedGame', gameId, (state, _, position) => {
      if (!position || position.game.result === 0n || !same(state.pendingEngineRelease, gameId)) {
        throw new Error('This game does not have an engine reservation to release.');
      }
      return { args: [gameId] };
    });
  }

  claimPayout(receiveAt) {
    return this.action('claimPayout', null, async (state, account) => {
      const recipient = getAddress(receiveAt ?? account);
      if (recipient === ZeroAddress || same(recipient, this.release.coordinator)) {
        throw new Error('Choose a wallet address to receive the GH0ST.');
      }
      if (await this.contract.claimable(account, { blockTag: state.block.number }) === 0n) {
        throw new Error('This wallet has no claimable payout.');
      }
      return { args: [recipient], recipient };
    });
  }

  // Serialize wallet prompts between tabs when the browser supports Web Locks.
  // An unresolved transaction survives reload and always blocks a new send.
  async locked(work) {
    if (this.busy) throw new Error('A GL3 wallet action is already running.');
    this.busy = true;
    try {
      const locks = globalThis.navigator?.locks;
      return await (locks ? locks.request(this.key, work) : work());
    } finally {
      this.busy = false;
    }
  }

  requireGame(state, position) {
    if (!position || position.game.result !== 0n || !same(state.activeGameId, position.gameId)) {
      throw new Error('The requested game is no longer active.');
    }
  }

  pending() {
    if (!this.storage) throw new Error('Enable browser storage to reconcile wallet actions.');
    const draft = this.storage.getItem(this.key);
    return draft === null ? null : JSON.parse(draft);
  }

  save(value) {
    if (value) this.storage.setItem(this.key, JSON.stringify(value));
    else this.storage.removeItem(this.key);
  }

  action(method, gameId, prepare) {
    return this.locked(async () => {
      if (this.pending()) throw new Error('Reconcile the previous wallet transaction first.');
      await this.assertWallet();
      const account = this.account;
      const state = await this.verify();
      const position = gameId ? await this.game(gameId, state.block.number) : null;
      const { args, ...expected } = await prepare(state, account, position);
      const tx = await this.contract[method].populateTransaction(...args);
      const gas = await this.provider.estimateGas({ ...tx, from: account });
      await this.assertWallet();
      if (!same(this.account, account)) throw new Error('The wallet changed before signing.');
      const browser = this.browser;
      const signer = this.signer;
      const nonce = await browser.getTransactionCount(account, 'pending');
      await this.assertWallet();
      if (this.signer !== signer) throw new Error('The wallet connection changed before signing.');
      const draft = {
        method, gameId, expected, account, nonce, data: tx.data,
        value: String(tx.value ?? 0n), hash: null,
      };
      this.save(draft);
      let sent;
      try {
        sent = await signer.sendTransaction({ ...tx, chainId: GL3_CHAIN_ID, nonce, gasLimit: gas });
      } catch (error) {
        if (error?.code === 'ACTION_REJECTED' || error?.code === 4001) this.save(null);
        throw error;
      }
      this.save({ ...draft, hash: sent.hash });
      return this.accept(await sent.wait(1, 90_000));
    });
  }

  resolve(explicitHash) {
    return this.locked(async () => {
      const draft = this.pending();
      if (!draft) return null;
      const hash = draft.hash ?? explicitHash;
      if (!exactHash(hash)) throw new Error('Paste the exact wallet transaction hash to reconcile its result.');
      await this.verify();
      return this.accept(await this.provider.getTransactionReceipt(hash));
    });
  }

  async accept(receipt) {
    const draft = this.pending();
    if (!draft || !receipt || (draft.hash && !same(receipt.hash, draft.hash))) {
      throw new Error('A matching confirmed receipt is required before another transaction can be sent.');
    }
    const tx = await this.provider.getTransaction(receipt.hash);
    const block = await this.provider.getBlock(receipt.blockNumber);
    if (!tx || tx.chainId !== GL3_CHAIN_ID || tx.nonce !== draft.nonce
        || !same(tx.from, draft.account) || !same(tx.to, this.release.coordinator)
        || !same(tx.data, draft.data) || tx.value !== BigInt(draft.value)
        || !same(receipt.from, draft.account) || !same(receipt.to, this.release.coordinator)
        || !same(block?.hash, receipt.blockHash)) {
      throw new Error('The canonical receipt differs from the saved wallet action.');
    }
    if (receipt.status === 0) {
      this.save(null);
      throw new Error('The confirmed transaction reverted. Network gas may have been spent.');
    }
    if (receipt.status !== 1) throw new Error('The receipt has no confirmed execution result.');
    const gameId = draft.expected.gameId ?? draft.gameId;
    const position = gameId ? await this.game(gameId, receipt.blockNumber) : null;
    const events = receipt.logs.filter(log => same(log.address, this.release.coordinator)).flatMap(log => {
      try {
        const event = this.contract.interface.parseLog(log);
        return event ? [event] : [];
      } catch {
        return [];
      }
    });
    const matching = (name, match) => events.filter(event => event.name === name && match(event.args));
    if (draft.method === 'enterGame') {
      const entered = matching('GameEntered', row => same(row.gameId, gameId) && same(row.player, draft.account)
        && row.nonce === BigInt(draft.expected.nonce) && same(row.engineConfigHash, this.release.engineModuleHash));
      if (entered.length !== 1 || !position || !same(position.game.player, draft.account)
          || position.game.nonce !== BigInt(draft.expected.nonce)) {
        throw new Error('The confirmed entry differs from the player, nonce or exact engine policy.');
      }
    }
    if (draft.expected.move !== undefined && matching('MovePlayed', row => same(row.gameId, gameId)
        && row.encodedMove === BigInt(draft.expected.move)
        && row.ply === BigInt(draft.expected.ply)).length !== 1) {
      throw new Error('The confirmed move differs from the saved action.');
    }
    if (draft.method === 'releaseEndedGame'
        && matching('EngineReleased', row => same(row.gameId, gameId)).length !== 1) {
      throw new Error('The receipt did not release the expected game’s engine reservation.');
    }
    const payouts = matching('PayoutClaimed', row => same(row.player, draft.account)
      && same(row.recipient, draft.expected.recipient) && row.amount > 0n);
    if (draft.method === 'claimPayout' && payouts.length !== 1) {
      throw new Error('The confirmed payout differs from the wallet and recipient.');
    }
    const settlements = matching('GameSettled', row => same(row.gameId, gameId));
    if (['claimDraw', 'resign', 'claimTimeout'].includes(draft.method) && settlements.length !== 1) {
      throw new Error('The receipt did not settle the expected game.');
    }
    for (const { args } of settlements) {
      const credit = args.result === 1n ? TOTAL_PRIZE
        : args.result === 6n || args.result === 7n ? ENTRY_FEE : 0n;
      if (!position || !same(args.player, position.game.player) || args.result !== position.game.result
          || args.credited !== credit || !same(args.finalPositionHash, position.game.positionHash)
          || !same(args.transcriptHash, position.game.transcriptHash)) {
        throw new Error('The confirmed settlement differs from the final board or fixed credit.');
      }
    }
    this.save(null);
    return { receipt, position, settlement: settlements[0]?.args, payout: payouts[0]?.args };
  }
}
