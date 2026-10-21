import { AbiCoder, Interface, concat, formatUnits, getAddress, keccak256, toQuantity } from './vendor/ethers.js';

export const GENESIS = Object.freeze({
  chainId: 4663, maxSupply: 495, maxPerWallet: 3, burnAmount: '200000000000000000000000',
  burnToken: '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',
  weightIndex: '0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0',
  tokenCodeHash: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
  indexCodeHash: '0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307',
  root: '0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2',
  metadata: 'ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/',
  collection: 'ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq',
  modelHash: '0x9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9',
  modelBytes: 48626528, payloadBytes: 98303, royaltyBps: 350
});
const BURN = BigInt(GENESIS.burnAmount);
const CHAIN_HEX = toQuantity(GENESIS.chainId);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO = /^0x0{40}$/i;
const coder = AbiCoder.defaultAbiCoder();

export const NFT_ABI = [
  'function MAX_SUPPLY() view returns(uint256)',
  'function MAX_PER_WALLET() view returns(uint256)',
  'function BURN_AMOUNT() view returns(uint256)',
  'function gh0stToken() view returns(address)',
  'function weightIndex() view returns(address)',
  'function tokenCodeHash() view returns(bytes32)',
  'function indexCodeHash() view returns(bytes32)',
  'function shardMerkleRoot() view returns(bytes32)',
  'function METADATA_BASE_URI() view returns(string)',
  'function contractURI() view returns(string)',
  'function MODEL_SHA256() view returns(bytes32)',
  'function MODEL_BYTES() view returns(uint256)',
  'function SHARD_PAYLOAD_BYTES() view returns(uint256)',
  'function supportsInterface(bytes4) view returns(bool)',
  'function ROYALTY_BPS() view returns(uint256)',
  'function royaltyRecipient() view returns(address)',
  'function royaltyInfo(uint256,uint256) view returns(address receiver,uint256 royaltyAmount)',
  'function totalMinted() view returns(uint256)',
  'function totalBurned() view returns(uint256)',
  'function mintedBy(address) view returns(uint256)',
  'function ownerOf(uint256) view returns(address)',
  'function shardInfo(uint256) view returns(address,bytes32,uint256,uint256)',
  'function mint(uint256,bytes32[])',
  'event GenesisMinted(address indexed wallet,uint256 indexed tokenId,uint256 tokensBurned,address shard,bytes32 shardCodeHash)',
  'error ERC721NonexistentToken(uint256 tokenId)',
  'error AlreadyMinted()', 'error WalletMintLimit()', 'error InvalidProof()',
  'error InvalidToken()', 'error InvalidIndex()', 'error InvalidShard()', 'error BurnInvariantFailed()'
];
export const TOKEN_ABI = [
  'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)'
];
const nft = new Interface(NFT_ABI);
const token = new Interface(TOKEN_ABI);
const lower = value => String(value).toLowerCase();

export function validTokenId(value) {
  if (!['number', 'string'].includes(typeof value)) throw Error('Choose a Genesis ID from 1 to 495.');
  if (typeof value === 'string' && !/^[0-9]{1,3}$/.test(value)) throw Error('Choose a Genesis ID from 1 to 495.');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > GENESIS.maxSupply) throw Error('Choose a Genesis ID from 1 to 495.');
  return id;
}

export function shardLeaf(record) {
  return keccak256(keccak256(coder.encode(
    ['uint256', 'address', 'bytes32', 'uint256', 'uint256'],
    [validTokenId(record.tokenId), record.shardAddress, record.runtimeCodeHash, record.offset, record.length]
  )));
}

export function verifyShardProof(record, root = GENESIS.root) {
  try {
    const id = validTokenId(record.tokenId);
    if (!Array.isArray(record.proof) || record.proof.length !== 9) return false;
    if (BigInt(record.offset) !== BigInt(id - 1) * BigInt(GENESIS.payloadBytes)) return false;
    const length = Math.min(GENESIS.payloadBytes, GENESIS.modelBytes - Number(record.offset));
    if (BigInt(record.length) !== BigInt(length)) return false;
    let hash = shardLeaf(record);
    if (record.leaf && lower(record.leaf) !== lower(hash)) return false;
    for (const sibling of record.proof) {
      if (!HASH.test(sibling)) return false;
      hash = keccak256(concat(BigInt(hash) < BigInt(sibling) ? [hash, sibling] : [sibling, hash]));
    }
    return lower(hash) === lower(root);
  } catch { return false; }
}

// Uniform shuffled IDs; the first available entry is a random remaining original.
export function randomTokenOrder(entropy = globalThis.crypto) {
  if (!entropy?.getRandomValues) throw Error('Secure browser randomness is unavailable.');
  const ids = Array.from({length: GENESIS.maxSupply}, (_, i) => i + 1);
  const draw = max => { const limit = Math.floor(4294967296 / max) * max; const value = new Uint32Array(1); do { entropy.getRandomValues(value); } while (value[0] >= limit); return value[0] % max; };
  for (let i = ids.length - 1; i > 0; i--) { const j = draw(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids;
}

export function formatGH0ST(value, maximumFractionDigits = 2) {
  if (value === null || value === undefined) return '—';
  const full = formatUnits(BigInt(value), 18);
  const [whole, fraction = ''] = full.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = fraction.slice(0, Math.max(0, maximumFractionDigits)).replace(/0+$/, '');
  return grouped + (tail ? '.' + tail : '');
}

function normalizeConfig(config) {
  const checks = {
    chainId: GENESIS.chainId, burnToken: GENESIS.burnToken, weightIndex: GENESIS.weightIndex,
    expectedTokenCodeHash: GENESIS.tokenCodeHash, expectedIndexCodeHash: GENESIS.indexCodeHash,
    shardMerkleRoot: GENESIS.root, burnAmount: GENESIS.burnAmount, maxSupply: GENESIS.maxSupply,
    maxLifetimeMintsPerWallet: GENESIS.maxPerWallet, metadataBaseURI: GENESIS.metadata,
    collectionURI: GENESIS.collection, protocolShareOfMintTokens: '0',
    burnTokensPerNFT: 200000, burnTokenDecimals: 18, royaltyBps: GENESIS.royaltyBps
  };
  for (const [key, expected] of Object.entries(checks)) {
    const insensitive = /Address|CodeHash/.test(key) || ['burnToken', 'weightIndex', 'shardMerkleRoot'].includes(key);
    const actual = config[key];
    if ((insensitive ? lower(actual) : String(actual)) !== (insensitive ? lower(expected) : String(expected))) {
      throw Error('Genesis configuration does not match the published collection: ' + key);
    }
  }
  const raw = config.nftAddress ?? config.deployedNFTAddress;
  const address = raw ? getAddress(raw) : null;
  if (address && ZERO.test(address)) throw Error('The NFT contract address has not been configured.');
  const expectedHash = config.expectedNFTCodeHash;
  if (expectedHash && (!HASH.test(expectedHash) || /^0x0{64}$/i.test(expectedHash))) {
    throw Error('Invalid deployed NFT runtime hash.');
  }
  const recipient = config.royaltyRecipient ? getAddress(config.royaltyRecipient) : null;
  if (recipient && ZERO.test(recipient)) throw Error('The royalty payout wallet cannot be the zero address.');
  if (address && expectedHash && !recipient) {
    throw Error('Configure the explicit nonzero royalty payout wallet before activating Genesis.');
  }
  return Object.freeze({ ...config, nftAddress: address, expectedNFTCodeHash: expectedHash || null,
    royaltyRecipient: recipient });
}

function errorData(error) {
  const candidates = [error?.data, error?.error?.data, error?.info?.error?.data,
    error?.data?.data, error?.error?.data?.data, error?.info?.error?.data?.data];
  return candidates.find(value => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value));
}

export function describeWalletError(error) {
  if ([4001, 'ACTION_REJECTED'].includes(error?.code) || [4001].includes(error?.info?.error?.code)) return 'Transaction canceled in your wallet.';
  const data = errorData(error);
  if (data) {
    try {
      const parsed = nft.parseError(data);
      const text = {
        AlreadyMinted: 'This artwork has already been minted. Choose another Genesis ID.',
        WalletMintLimit: 'This wallet has used all three lifetime mints.',
        InvalidProof: 'The selected shard proof could not be verified.',
        InvalidToken: 'GH0ST token verification failed. Minting stopped.',
        InvalidIndex: 'Genesis index verification failed. Minting stopped.',
        InvalidShard: 'The selected live shard could not be verified.',
        BurnInvariantFailed: 'The token balance or burn check failed.'
      }[parsed?.name];
      if (text) return text;
    } catch {}
  }
  if (error?.code === -32002) return 'A request is already open in your wallet.';
  const text = error?.shortMessage || error?.message || 'The wallet request could not be completed.';
  return String(text).replace(/https?:\/\/\S+/g, '[RPC]').slice(0, 260);
}

/**
 * State token amounts are raw decimal strings; counts are numbers or null.
 * Null collection totals mean no verified deployment/read is available.
 * No method asks for signatures while nftAddress or expectedNFTCodeHash is absent.
 * Optional provider/storage/poll settings make the same production code testable.
 */
export function createMintController({
  config, proofs, onState = () => {}, provider = globalThis.window?.ethereum,
  storage = null, pollIntervalMs = 1800, receiptTimeoutMs = 180000,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const cfg = normalizeConfig(config);
  const records = new Map((proofs?.records || []).map(record => [Number(record.tokenId), record]));
  if (lower(proofs?.root) !== lower(GENESIS.root)) throw Error('The Genesis proof manifest root does not match.');
  const configured = Boolean(cfg.nftAddress && cfg.expectedNFTCodeHash && cfg.royaltyRecipient);
  const storageKey = cfg.nftAddress ? 'gh0st-genesis-pending-4663-' + lower(cfg.nftAddress) : null;
  let safeStorage = storage;
  if (!safeStorage) { try { safeStorage = globalThis.window?.localStorage; } catch {} }
  let pending = null;
  try {
    const saved = storageKey && JSON.parse(safeStorage?.getItem(storageKey) || 'null');
    if (saved && (HASH.test(saved.hash) || saved.uncertain === true && saved.hash === null) && ['approve', 'mint'].includes(saved.kind) &&
        getAddress(saved.account) && saved.chainId === GENESIS.chainId) {
      if (saved.kind !== 'mint' || validTokenId(saved.tokenId)) pending = saved;
    }
  } catch {}
  let revision = 0, destroyed = false, locked = false, reconciliation = null;
  let state = {
    account: null, chainId: null, connected: false, configured, verified: false, busy: false,
    phase: pending ? pending.uncertain ? 'uncertain' : 'pending' : configured ? 'disconnected' : 'awaiting-deployment',
    error: null, message: pending ? pending.uncertain ?
      'A wallet request is unresolved. Check its activity and update the transaction hash.' :
      'A submitted transaction is awaiting confirmation.' :
      configured ? 'Connect your wallet to view your mint allowance.' : 'Minting awaits verified contract deployment.',
    balance: null, allowance: null, mintedBy: null, remaining: null,
    totalMinted: null, totalBurned: null, txHash: pending?.hash || null,
    txKind: pending?.kind || null, lastMintedId: null
  };

  function emit(patch = {}) {
    if (destroyed) return;
    state = { ...state, ...patch };
    try { onState({ ...state }); } catch (error) { console.error('Mint interface update failed.', error); }
  }
  function requireProvider() {
    if (!provider?.request) throw Error('Open this page in a wallet browser or enable an Ethereum-compatible wallet extension.');
    return provider;
  }
  function requireDeployment() {
    if (!configured) throw Error('Minting is not active yet. The verified NFT contract is awaiting deployment.');
  }
  function invalidate() {
    revision++;
    emit({
      account: null, connected: false, verified: false, balance: null, allowance: null,
      mintedBy: null, remaining: null, totalMinted: null, totalBurned: null,
      phase: pending ? pending.uncertain ? 'uncertain' : 'pending' : configured ? 'disconnected' : 'awaiting-deployment',
      message: pending ? pending.uncertain ? 'Check your wallet activity and update the transaction hash before trying again.' :
        'Transaction submitted. Reconnect on Robinhood Chain to check confirmation.' :
        'Your wallet account or network changed. Connect again to continue.'
    });
  }
  function networkChanged(value) {
    invalidate();
    let next = null;
    try { if (value !== undefined) next = Number(BigInt(value)); } catch {}
    emit({ chainId: next });
  }
  function providerDisconnected() { invalidate(); emit({ chainId: null }); }
  provider?.on?.('accountsChanged', invalidate);
  provider?.on?.('chainChanged', networkChanged);
  provider?.on?.('disconnect', providerDisconnected);
  async function request(method, params) {
    if (destroyed) throw Error('The wallet controller has been closed.');
    return requireProvider().request({ method, ...(params === undefined ? {} : { params }) });
  }
  async function chain() {
    const current = Number(BigInt(await request('eth_chainId')));
    emit({ chainId: current });
    if (current !== GENESIS.chainId) {
      emit({ verified: false, phase: 'wrong-network', balance: null, allowance: null,
        mintedBy: null, remaining: null, totalMinted: null, totalBurned: null });
      throw Error('Switch your wallet to Robinhood Chain (4663).');
    }
  }
  async function session(snapshot) {
    await chain();
    const accounts = await request('eth_accounts');
    if (revision !== snapshot.revision || !state.account || lower(accounts?.[0]) !== lower(snapshot.account)) {
      invalidate();
      throw Error('Your wallet changed. Connect again before requesting a transaction.');
    }
  }
  async function call(address, iface, method, args = [], from, blockTag = 'latest') {
    const data = iface.encodeFunctionData(method, args);
    const result = await request('eth_call', [{ to: address, data, ...(from ? { from } : {}) }, blockTag]);
    return iface.decodeFunctionResult(method, result);
  }
  let codeReadPromise = null, codeReadAt = 0;
  async function verifyCode(fresh = true) {
    if (!fresh && codeReadPromise && Date.now() - codeReadAt < 15000) return codeReadPromise;
    const check = verifyCodeNow();
    codeReadPromise = check; codeReadAt = Date.now();
    try { return await check; } catch (error) { if (codeReadPromise === check) { codeReadPromise = null; codeReadAt = 0; } throw error; }
  }
  async function verifyCodeNow() {
    requireDeployment();
    const [tokenCode, indexCode, nftCode] = await Promise.all([
      request('eth_getCode', [cfg.burnToken, 'latest']),
      request('eth_getCode', [cfg.weightIndex, 'latest']),
      request('eth_getCode', [cfg.nftAddress, 'latest'])
    ]);
    if (keccak256(tokenCode) !== GENESIS.tokenCodeHash || keccak256(indexCode) !== GENESIS.indexCodeHash ||
        lower(keccak256(nftCode)) !== lower(cfg.expectedNFTCodeHash) || nftCode === '0x') {
      emit({ verified: false });
      throw Error('Live contract code differs from the verified Genesis deployment. Minting stopped.');
    }
  }
  async function verifyContracts() {
    requireDeployment();
    const atRevision = revision;
    await chain();
    await verifyCode();
    const checks = [
      ['MAX_SUPPLY', BigInt(GENESIS.maxSupply)], ['MAX_PER_WALLET', BigInt(GENESIS.maxPerWallet)],
      ['BURN_AMOUNT', BURN], ['gh0stToken', GENESIS.burnToken], ['weightIndex', GENESIS.weightIndex],
      ['tokenCodeHash', GENESIS.tokenCodeHash], ['indexCodeHash', GENESIS.indexCodeHash],
      ['shardMerkleRoot', GENESIS.root], ['METADATA_BASE_URI', GENESIS.metadata],
      ['contractURI', GENESIS.collection], ['MODEL_SHA256', GENESIS.modelHash],
      ['MODEL_BYTES', BigInt(GENESIS.modelBytes)], ['SHARD_PAYLOAD_BYTES', BigInt(GENESIS.payloadBytes)],
      ['ROYALTY_BPS', BigInt(GENESIS.royaltyBps)], ['royaltyRecipient', cfg.royaltyRecipient]
    ];
    const values = await Promise.all(checks.map(([method]) => call(cfg.nftAddress, nft, method)));
    for (let i = 0; i < checks.length; i++) {
      const [method, expected] = checks[i], actual = values[i][0];
      const exact = ['METADATA_BASE_URI', 'contractURI'].includes(method);
      if (typeof expected === 'bigint' ? actual !== expected :
          exact ? actual !== expected : lower(actual) !== lower(expected)) {
        emit({ verified: false });
        throw Error('Deployed Genesis settings do not match: ' + method + '. Minting stopped.');
      }
    }
    const [[supports], [supportsRoyalties], [decimals]] = await Promise.all([
      call(cfg.nftAddress, nft, 'supportsInterface', ['0x80ac58cd']),
      call(cfg.nftAddress, nft, 'supportsInterface', ['0x2a55205a']),
      call(cfg.burnToken, token, 'decimals')
    ]);
    if (!supports || !supportsRoyalties || decimals !== 18n) {
      emit({ verified: false });
      throw Error('The deployed token or ERC-2981 royalty interfaces do not match Genesis.');
    }
    // Exact integer floor division, including the largest ERC-2981 sale price.
    // The latter also checks the deployed contract's full-width mulDiv path.
    const prices = [10000n, (1n << 256n) - 1n];
    const royalties = await Promise.all(prices.map(price => call(cfg.nftAddress, nft, 'royaltyInfo', [1, price])));
    for (let i = 0; i < prices.length; i++) {
      if (lower(royalties[i][0]) !== lower(cfg.royaltyRecipient) ||
          royalties[i][1] !== prices[i] * BigInt(GENESIS.royaltyBps) / 10000n) {
        emit({ verified: false });
        throw Error('Deployed secondary-sale royalties do not match the fixed 3.5% payout settings.');
      }
    }
    await chain();
    if (revision !== atRevision) throw Error('Wallet changed while verifying Genesis. Reconnect to refresh.');
    emit({ verified: true });
  }
  async function readState() {
    const account = state.account, atRevision = revision;
    const block = await request('eth_blockNumber');
    const reads = [
      call(cfg.nftAddress, nft, 'totalMinted', [], undefined, block),
      call(cfg.nftAddress, nft, 'totalBurned', [], undefined, block)
    ];
    if (account) reads.push(
      call(cfg.burnToken, token, 'balanceOf', [account], undefined, block),
      call(cfg.burnToken, token, 'allowance', [account, cfg.nftAddress], undefined, block),
      call(cfg.nftAddress, nft, 'mintedBy', [account], undefined, block)
    );
    const values = await Promise.all(reads);
    if (atRevision !== revision) throw Error('Wallet changed while reading mint status. Reconnect to refresh.');
    const count = Number(values[0][0]), burned = values[1][0];
    if (count < 0 || count > GENESIS.maxSupply || burned !== BigInt(count) * BURN) throw Error('Genesis accounting could not be verified.');
    const patch = { totalMinted: count, totalBurned: burned.toString() };
    if (account) {
      const minted = Number(values[4][0]);
      if (minted < 0 || minted > GENESIS.maxPerWallet) throw Error('Wallet mint accounting could not be verified.');
      Object.assign(patch, { balance: values[2][0].toString(), allowance: values[3][0].toString(),
        mintedBy: minted, remaining: GENESIS.maxPerWallet - minted });
    }
    emit(patch);
    return { ...state };
  }
  function rememberPending(value) {
    pending = value;
    try { if (value) safeStorage?.setItem(storageKey, JSON.stringify(value)); else safeStorage?.removeItem(storageKey); } catch {}
  }
  async function reconcilePending() {
    if (reconciliation) return reconciliation;
    const current = pending;
    if (!current) return false;
    const task = reconcileReceipt(current);
    reconciliation = task;
    try { return await task; } finally { if (reconciliation === task) reconciliation = null; }
  }
  async function reconcileReceipt(current) {
    if (current.uncertain) throw Error('The wallet broadcast status is unknown. Inspect its activity and use Update transaction hash before submitting another transaction.');
    const atRevision = revision;
    await chain();
    const receipt = await request('eth_getTransactionReceipt', [current.hash]);
    if (pending !== current) return false;
    if (!receipt) return false;
    await chain();
    if (revision !== atRevision) throw Error('The wallet network changed while checking the receipt. Reconnect to check it again.');
    if (lower(receipt.transactionHash) !== lower(current.hash)) throw Error('Transaction receipt identity did not match.');
    if (lower(receipt.from) !== lower(current.account) ||
        lower(receipt.to) !== lower(current.kind === 'approve' ? cfg.burnToken : cfg.nftAddress)) {
      throw Error('Transaction receipt sender or destination did not match.');
    }
    const completed = current;
    if (BigInt(receipt.status) !== 1n) {
      rememberPending(null);
      emit({ phase: 'reverted', txHash: completed.hash, txKind: completed.kind,
        error: 'The transaction reverted. No successful mint was recorded.', message: 'Transaction reverted. Refresh before retrying.' });
      return true;
    }
    const eventInterface = completed.kind === 'mint' ? nft : token;
    const eventAddress = completed.kind === 'mint' ? cfg.nftAddress : cfg.burnToken;
    const matchingEvent = (receipt.logs || []).some(log => {
      if (lower(log.address) !== lower(eventAddress)) return false;
      try {
        const decoded = eventInterface.parseLog(log);
        if (completed.kind === 'approve') return decoded?.name === 'Approval' &&
          lower(decoded.args.owner) === lower(completed.account) &&
          lower(decoded.args.spender) === lower(cfg.nftAddress) && decoded.args.value === BURN;
        const record = records.get(completed.tokenId);
        return decoded?.name === 'GenesisMinted' && lower(decoded.args.wallet) === lower(completed.account) &&
          decoded.args.tokenId === BigInt(completed.tokenId) && decoded.args.tokensBurned === BURN &&
          lower(decoded.args.shard) === lower(record?.shardAddress) &&
          lower(decoded.args.shardCodeHash) === lower(record?.runtimeCodeHash);
      } catch { return false; }
    });
    if (!matchingEvent) throw Error('The expected Genesis transaction event was not present. Inspect the receipt before continuing.');
    rememberPending(null);
    emit({
      phase: 'confirmed', error: null, txHash: completed.hash, txKind: completed.kind,
      lastMintedId: completed.kind === 'mint' ? completed.tokenId : state.lastMintedId,
      message: completed.kind === 'mint' ?
        'Genesis #' + String(completed.tokenId).padStart(3, '0') + ' mint confirmed. 200,000 GH0ST burned.' :
        '200,000 GH0ST approval confirmed. You can now mint one artwork.'
    });
    return true;
  }
  async function refreshInternal() {
    await chain();
    if (!configured) {
      if (state.account) {
        const snapshot = { account: state.account, revision };
        const [code, [balance]] = await Promise.all([
          request('eth_getCode', [cfg.burnToken, 'latest']),
          call(cfg.burnToken, token, 'balanceOf', [snapshot.account])
        ]);
        if (keccak256(code) !== GENESIS.tokenCodeHash) throw Error('GH0ST token verification failed.');
        await session(snapshot);
        emit({ balance: balance.toString() });
      }
      emit({ verified: false, totalMinted: null, totalBurned: null, phase: 'awaiting-deployment',
        message: 'Minting awaits verified contract deployment. You can explore all 495 artworks now.' });
      return { ...state };
    }
    await verifyContracts();
    await reconcilePending();
    await readState();
    if (!pending && !['confirmed', 'reverted'].includes(state.phase)) {
      emit({ phase: state.account ? 'ready' : 'disconnected',
        message: state.account ? 'Verified Genesis deployment. Choose an artwork to mint.' : 'Connect your wallet to mint.' });
    }
    return { ...state };
  }
  async function readAction(fn) {
    try { emit({ error: null }); return await fn(); }
    catch (error) { emit({ error: describeWalletError(error) }); throw error; }
  }
  async function writeAction(kind, fn) {
    requireDeployment();
    if (locked) throw Error('A wallet request is already in progress.');
    if (pending) throw Error('A transaction is already awaiting confirmation. Check it before requesting another.');
    if (!state.account || !state.connected) throw Error('Connect your wallet first.');
    locked = true;
    const snapshot = { account: state.account, revision };
    emit({ busy: true, error: null, phase: 'checking', message: 'Checking the current wallet, contracts and mint allowance…' });
    try {
      await session(snapshot);
      await verifyContracts();
      await readState();
      await session(snapshot);
      if (state.remaining <= 0) throw Error('This wallet has used all three lifetime mints.');
      if (state.totalMinted >= GENESIS.maxSupply) throw Error('All 495 Genesis artworks have been minted.');
      if (BigInt(state.balance) < BURN) throw Error('This wallet needs at least 200,000 GH0ST for one mint.');
      return await fn(snapshot);
    } catch (error) {
      emit({
        error: describeWalletError(error), phase: pending ? pending.uncertain ? 'uncertain' : 'pending' :
          ['reverted', 'wrong-network'].includes(state.phase) ? state.phase : state.connected ? 'ready' : 'disconnected',
        message: pending ? pending.uncertain ? 'The wallet response is unresolved. Check its activity before trying again.' :
          'Transaction submitted. Check its confirmation before trying again.' : 'No new mint was confirmed.'
      });
      throw error;
    } finally { locked = false; emit({ busy: false }); }
  }
  async function send(kind, data, snapshot, tokenId = null) {
    const nonce = await request('eth_getTransactionCount', [snapshot.account, 'pending']);
    const tx = {
      from: snapshot.account, to: kind === 'approve' ? cfg.burnToken : cfg.nftAddress,
      data, value: '0x0', chainId: CHAIN_HEX, nonce
    };
    // Simulate first; any failure stops before the wallet's transaction prompt.
    const simulation = await request('eth_call', [tx, 'latest']);
    if (kind === 'approve' && token.decodeFunctionResult('approve', simulation)[0] !== true) {
      throw Error('The GH0ST token did not accept the requested approval.');
    }
    await verifyCode();
    await session(snapshot);
    emit({ phase: 'awaiting-signature', txHash: null, txKind: kind, message: kind === 'approve' ?
      'Review the exact 200,000 GH0ST approval in your wallet.' :
      'Review your mint. It burns 200,000 GH0ST and uses one lifetime mint.' });
    const candidate = {
      hash: null, uncertain: true, kind, tokenId, account: snapshot.account,
      chainId: GENESIS.chainId, request: tx
    };
    // The wallet may broadcast before its RPC response arrives. Persist first,
    // including while the confirmation window is open or the page reloads.
    rememberPending(candidate);
    let hash;
    try { hash = await request('eth_sendTransaction', [tx]); }
    catch (error) {
      if ([4001, 'ACTION_REJECTED'].includes(error?.code) || error?.info?.error?.code === 4001) {
        rememberPending(null);
      }
      throw error;
    }
    if (!HASH.test(hash)) {
      // A malformed wallet reply may still mean a broadcast; block duplicate sends.
      emit({ phase: 'uncertain', txHash: null, txKind: kind });
      throw Error('The wallet did not return a valid transaction hash. Inspect its activity before continuing.');
    }
    rememberPending({ ...candidate, hash, uncertain: false });
    emit({ txHash: hash, txKind: kind, phase: 'pending', message: 'Transaction submitted. Waiting for confirmation…' });
    const started = Date.now();
    do {
      if (await reconcilePending()) {
        await verifyContracts();
        await readState();
        if (state.phase === 'reverted') throw Error('The transaction reverted. Inspect its receipt before retrying.');
        return { ...state };
      }
      if (Date.now() - started >= receiptTimeoutMs) break;
      await wait(pollIntervalMs);
    } while (!destroyed);
    throw Error('Confirmation is still pending. Check the transaction; it will not be sent again automatically.');
  }
  async function tokenStatus(tokenId) {
    const id = validTokenId(tokenId);
    if (!configured) return { tokenId: id, status: 'awaiting-deployment', owner: null };
    await chain();
    await verifyCode(false);
    try {
      const [owner] = await call(cfg.nftAddress, nft, 'ownerOf', [id]);
      return { tokenId: id, status: 'minted', owner: getAddress(owner) };
    } catch (error) {
      const data = errorData(error);
      if (data) {
        let parsed;
        try { parsed = nft.parseError(data); } catch {}
        if (parsed?.name === 'ERC721NonexistentToken' && parsed.args[0] === BigInt(id)) {
          return { tokenId: id, status: 'available', owner: null };
        }
        // A contradictory or different explicit revert must never mean available.
        if (parsed) throw Error('This artwork’s availability could not be checked. Please try again.');
      }
      // Some wallet RPCs omit custom-error data. Read the verified ERC-721 owners
      // mapping directly instead: compiler storageLayout pins _owners to slot 2.
      // A failed/malformed storage read remains unknown, never available.
      try {
        const slot = keccak256(coder.encode(['uint256','uint256'], [id, 2]));
        const word = await request('eth_getStorageAt', [cfg.nftAddress, slot, 'latest']);
        if (!HASH.test(word) || BigInt(word) >> 160n !== 0n) throw Error('Invalid ownership word');
        const owner = BigInt(word) === 0n ? null : getAddress('0x' + word.slice(-40));
        return { tokenId: id, status: owner ? 'minted' : 'available', owner };
      } catch {}
      throw Error('This artwork’s availability could not be checked. Please refresh.');
    }
  }
  async function connect() {
    if (locked) throw Error('Wait for the current wallet request to finish.');
    locked = true;
    emit({ busy: true });
    try { return await readAction(async () => {
      const accounts = await request('eth_requestAccounts');
      const atRevision = revision;
      await chain();
      const current = await request('eth_accounts');
      if (revision !== atRevision || !accounts?.[0] || lower(accounts[0]) !== lower(current?.[0])) {
        invalidate();
        throw Error('Your wallet changed while connecting. Connect again.');
      }
      emit({ account: getAddress(accounts[0]), connected: true, error: null });
      const result = await refreshInternal();
      await session({ account: getAddress(accounts[0]), revision: atRevision });
      return result;
    }); } finally { locked = false; emit({ busy: false }); }
  }
  async function approve() {
    return writeAction('approve', async snapshot => {
      if (BigInt(state.allowance) >= BURN) {
        emit({ phase: 'ready', message: 'This wallet already has enough approval for one mint.' });
        return { ...state };
      }
      return send('approve', token.encodeFunctionData('approve', [cfg.nftAddress, BURN]), snapshot);
    });
  }
  async function mintCandidate(id, snapshot) {
    const record = records.get(id);
    if (!record || !verifyShardProof(record, GENESIS.root)) throw Error('The assigned artwork’s shard proof could not be verified.');
    const observed = await call(cfg.nftAddress, nft, 'shardInfo', [id]);
    if (lower(observed[0]) !== lower(record.shardAddress) || lower(observed[1]) !== lower(record.runtimeCodeHash) ||
        observed[2] !== BigInt(record.offset) || observed[3] !== BigInt(record.length)) {
      throw Error('The live shard does not match this artwork’s proof. Minting stopped.');
    }
    return send('mint', nft.encodeFunctionData('mint', [id, record.proof]), snapshot, id);
  }
  async function mint(tokenId) {
    const id = validTokenId(tokenId);
    const record = records.get(id);
    if (!record || !verifyShardProof(record, GENESIS.root)) throw Error('The assigned artwork’s shard proof could not be verified.');
    return writeAction('mint', async snapshot => {
      if (BigInt(state.allowance) < BURN) throw Error('Approve exactly 200,000 GH0ST before minting.');
      if ((await tokenStatus(id)).status !== 'available') throw Error('This artwork has already been minted.');
      return mintCandidate(id, snapshot);
    });
  }
  async function mintRandom() {
    return writeAction('mint', async snapshot => {
      if (BigInt(state.allowance) < BURN) throw Error('Approve exactly 200,000 GH0ST before minting.');
      emit({ message: 'Randomly assigning an available Genesis original…' });
      for (const id of randomTokenOrder()) {
        const result = await tokenStatus(id);
        if (result.status === 'minted') continue;
        if (result.status !== 'available') throw Error('Ownership could not be verified. No mint request sent.');
        await session(snapshot);
        emit({ message: 'Genesis #' + String(id).padStart(3,'0') + ' assigned. Review the burn-to-mint transaction in your wallet.' });
        return mintCandidate(id, snapshot);
      }
      throw Error('All 495 Genesis artworks have been minted.');
    });
  }
  async function switchNetwork() {
    if (locked) throw Error('Wait for the current wallet request to finish.');
    return readAction(async () => {
      try { await request('wallet_switchEthereumChain', [{ chainId: CHAIN_HEX }]); }
      catch (error) {
        if (error?.code === 4902) throw Error('Add Robinhood Chain (4663) to your wallet using its official connection guide, then reconnect.');
        throw error;
      }
      invalidate();
      return connect();
    });
  }
  async function resolveTransaction(hash) {
    requireDeployment();
    if (locked) throw Error('Wait for the current wallet request to finish.');
    if (!pending) throw Error('There is no pending Genesis request to update.');
    if (!HASH.test(hash)) throw Error('Enter the full transaction hash from your wallet activity.');
    const current = pending;
    const atRevision = revision;
    return readAction(async () => {
      await chain();
      const tx = await request('eth_getTransactionByHash', [hash]);
      if (!tx || lower(tx.hash) !== lower(hash) || lower(tx.from) !== lower(current.account)) {
        throw Error('The transaction does not match the original wallet.');
      }
      const original = current.request;
      let transactionChain = null;
      if (tx.chainId !== undefined) transactionChain = BigInt(tx.chainId);
      else if (tx.v !== undefined && BigInt(tx.v) >= 35n) transactionChain = (BigInt(tx.v) - 35n) / 2n;
      if (!original || BigInt(tx.nonce) !== BigInt(original.nonce) ||
          transactionChain !== BigInt(CHAIN_HEX)) {
        throw Error('The replacement transaction does not match the original network and nonce.');
      }
      const sameIntent = lower(tx.to) === lower(original.to) &&
        lower(tx.input ?? tx.data) === lower(original.data) &&
        BigInt(tx.value) === BigInt(original.value);
      if (sameIntent) {
        await chain();
        if (revision !== atRevision) throw Error('The wallet network changed while checking the replacement. Reconnect to check it again.');
        if (pending !== current) throw Error('The pending transaction changed. Refresh before updating it.');
        rememberPending({ ...current, hash, uncertain: false });
        emit({ txHash: hash, phase: 'pending', error: null,
          message: 'Updated transaction hash verified. Checking its confirmation…' });
        return refreshInternal();
      }
      // A cancellation/different replacement can release the old request only
      // once a receipt proves that the same sender's exact nonce was consumed.
      const receipt = await request('eth_getTransactionReceipt', [hash]);
      if (!receipt) throw Error('That replacement is still pending. Check it again after confirmation.');
      if (lower(receipt.transactionHash) !== lower(hash) || lower(receipt.from) !== lower(current.account) ||
          lower(receipt.to) !== lower(tx.to) || !['0x0', '0x1'].includes(receipt.status)) {
        throw Error('The replacement receipt could not be verified.');
      }
      await chain();
      if (revision !== atRevision) throw Error('The wallet network changed while checking the replacement. Reconnect to check it again.');
      if (pending !== current) throw Error('The pending transaction changed. Refresh before updating it.');
      rememberPending(null);
      await verifyContracts();
      await readState();
      emit({ txHash: hash, txKind: 'replacement', phase: 'replaced', error: null,
        message: 'The original wallet request was replaced. Current balances and mint allowance have been refreshed.' });
      return { ...state };
    });
  }
  emit();
  return Object.freeze({
    connect, refresh: () => readAction(refreshInternal), approve, mint, mintRandom, tokenStatus, switchNetwork, resolveTransaction,
    disconnect() { if (locked) throw Error('Wait for the current wallet request to finish.'); invalidate(); },
    getState: () => ({ ...state }),
    destroy() {
      destroyed = true;
      provider?.removeListener?.('accountsChanged', invalidate);
      provider?.removeListener?.('chainChanged', networkChanged);
      provider?.removeListener?.('disconnect', providerDisconnected);
    }
  });
}
