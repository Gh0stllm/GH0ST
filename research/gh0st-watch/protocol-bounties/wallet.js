import { Interface, MaxUint256, ZeroAddress, formatUnits, getAddress, id, keccak256, parseUnits } from 'ethers';

export const CHAIN_ID = 4663;
export const TOKEN_ADDRESS = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const CHAIN_HEX = '0x1237';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const DECIMALS = 18;
const ESCROW_RUNTIME_HASH = '0x2ae2187e81ac174b72fbb8536a658b9342855e8468552026751564cbacef7bff';
const token = new Interface([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender,uint256 amount) returns (bool)',
]);
const escrow = new Interface([
  'function token() view returns (address)',
  'function fund(bytes32 bountyKey,uint256 amount)',
  'function approve(bytes32 bountyKey,uint64 submissionId,address recipient)',
  'function cancel(bytes32 bountyKey)',
  'function getReward(address creator,bytes32 bountyKey) view returns (uint8 status,uint256 amount,uint64 submissionId,address recipient)',
]);
const txHashPattern = /^0x[0-9a-fA-F]{64}$/;
export class WalletError extends Error {}

export function walletAddress(value) {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid address format.');
    const address = getAddress(value);
    if (address !== ZeroAddress) return address;
  } catch {
    // Only checksummed or unambiguous EVM addresses can be used.
  }
  throw new WalletError('Choose a valid Robinhood wallet address.');
}
function assertEmptyAccountCode(code) {
  if (code !== '0x') {
    throw new WalletError('Use a direct EVM account for sponsorship. Smart and delegated accounts are unavailable for reward transactions.');
  }
}
async function readRobinhood(method, params) {
  try {
    const response = await fetch(RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    const reply = await response.json();
    if (response.ok && reply.jsonrpc === '2.0' && reply.id === 1 && !reply.error && typeof reply.result === 'string') {
      return reply.result;
    }
  } catch {
    // The board cannot bind an address when the chain check is unavailable.
  }
  throw new WalletError('Could not verify the sponsor address on Robinhood Chain. Try again.');
}
export async function verifySponsorAddress(value) {
  const address = walletAddress(value);
  if (await readRobinhood('eth_chainId', []) !== CHAIN_HEX) {
    throw new WalletError('The public RPC did not identify Robinhood Chain.');
  }
  assertEmptyAccountCode(await readRobinhood('eth_getCode', [address, 'latest']));
  return address;
}
export function amountInBaseUnits(text) {
  if (!/^\d{1,78}(?:\.\d{1,18})?$/.test(text)) {
    throw new WalletError('Enter a GH0ST amount with at most 18 decimal places.');
  }
  const amount = parseUnits(text, DECIMALS);
  if (amount <= 0n || amount > MaxUint256) throw new WalletError('Enter a positive GH0ST amount within the token limit.');
  return amount.toString();
}
export function displayAmount(amount) {
  return formatUnits(amount, DECIMALS).replace(/\.0$/, '');
}
export function transactionHash(text) {
  if (!txHashPattern.test(text)) throw new WalletError('Enter the full Robinhood transaction hash.');
  return text.toLowerCase();
}
export const transactionLink = hash => `${EXPLORER}/tx/${transactionHash(hash)}`;
export const addressLink = address => `${EXPLORER}/address/${walletAddress(address)}`;
export const boardKey = (canister, bountyId) => id(`GH0ST_BOUNTIES_V1:${canister}:${bountyId}`);

function safeConfig(config) {
  if (!config || BigInt(config.chain_id) !== BigInt(CHAIN_ID) ||
      walletAddress(config.token_address) !== TOKEN_ADDRESS) {
    throw new WalletError('The reward configuration did not match Robinhood GH0ST.');
  }
  const contract = walletAddress(config.escrow_address);
  if (contract === TOKEN_ADDRESS) throw new WalletError('The reward escrow address is invalid.');
  return contract;
}
export function supportsRewards(config) {
  try {
    safeConfig(config);
    return true;
  } catch {
    return false;
  }
}

export function createRewardWallet({
  canister,
  provider = () => globalThis.ethereum,
  store = () => globalThis.localStorage,
  locks = () => globalThis.navigator?.locks,
  expectedRuntimeHash = ESCROW_RUNTIME_HASH,
}) {
  function rpc(method, params = []) {
    const wallet = provider();
    if (!wallet?.request) throw new WalletError('Open this page in a browser with a Robinhood-compatible EVM wallet.');
    return wallet.request({ method, params });
  }
  async function selected(prompt = false) {
    const accounts = await rpc(prompt ? 'eth_requestAccounts' : 'eth_accounts');
    if (!accounts?.length) throw new WalletError('Connect your Robinhood wallet first.');
    let chain = BigInt(await rpc('eth_chainId'));
    if (chain !== BigInt(CHAIN_ID) && prompt) {
      try {
        await rpc('wallet_switchEthereumChain', [{ chainId: CHAIN_HEX }]);
      } catch (error) {
        if (Number(error?.code) !== 4902) throw error;
        await rpc('wallet_addEthereumChain', [{
          chainId: CHAIN_HEX, chainName: 'Robinhood Chain',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [RPC], blockExplorerUrls: [EXPLORER],
        }]);
      }
      chain = BigInt(await rpc('eth_chainId'));
    }
    if (chain !== BigInt(CHAIN_ID)) throw new WalletError('Switch your wallet to Robinhood Chain (4663), then retry.');
    const current = await rpc('eth_accounts');
    if (!current?.length) throw new WalletError('Connect your Robinhood wallet first.');
    return walletAddress(current[0]);
  }
  async function assertDirectAccount(address, block) {
    assertEmptyAccountCode(await rpc('eth_getCode', [address, block]));
  }
  async function directSponsor(prompt = false) {
    const address = await selected(prompt);
    await assertDirectAccount(address, await rpc('eth_blockNumber'));
    if (await selected() !== address) throw new WalletError('The sponsor wallet changed. Connect the intended account again.');
    return address;
  }
  async function read(contract, abi, method, args, block) {
    const data = abi.encodeFunctionData(method, args);
    return abi.decodeFunctionResult(method, await rpc('eth_call', [{ to: contract, data }, block]));
  }
  function keys(contract, creator, bountyId) {
    const scope = `gh0st-reward:v1:${canister}:${CHAIN_ID}:${contract}:${creator}`;
    return { pending: `${scope}:pending`, last: `${scope}:${bountyId}:last` };
  }
  function record(key, value) {
    const storage = store();
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  }
  function saved(key) {
    const value = store().getItem(key);
    return value ? JSON.parse(value) : null;
  }
  async function current(config, bounty) {
    const contract = safeConfig(config);
    const offer = bounty.reward[0];
    const creator = walletAddress(offer.creator_wallet);
    if (await selected() !== creator) throw new WalletError(`Select the sponsor wallet ${creator} on Robinhood Chain.`);
    const expected = BigInt(offer.amount_wei);
    if (expected <= 0n || expected > MaxUint256) throw new WalletError('The prepared reward amount is invalid.');
    const key = boardKey(canister, bounty.id);
    if (offer.bounty_key.toLowerCase() !== key) throw new WalletError('The board returned a different escrow key for this bounty.');
    const block = await rpc('eth_blockNumber');
    await assertDirectAccount(creator, block);
    const [code, [asset], [decimals], [status, amount, submissionId, recipient], [allowance], [balance]] = await Promise.all([
      rpc('eth_getCode', [contract, block]),
      read(contract, escrow, 'token', [], block),
      read(TOKEN_ADDRESS, token, 'decimals', [], block),
      read(contract, escrow, 'getReward', [creator, key], block),
      read(TOKEN_ADDRESS, token, 'allowance', [creator, contract], block),
      read(TOKEN_ADDRESS, token, 'balanceOf', [creator], block),
    ]);
    if (keccak256(code) !== expectedRuntimeHash) {
      throw new WalletError('The deployed escrow bytecode does not match the reviewed contract.');
    }
    if (asset !== TOKEN_ADDRESS || decimals !== BigInt(DECIMALS)) throw new WalletError('The wallet’s escrow or token does not match the reward configuration.');
    if (status > 3n) throw new WalletError('The escrow returned an unsupported state.');
    return { creator, contract, key, expected, status, amount, submissionId, recipient, allowance, balance };
  }
  function getLastHash(config, bounty) {
    try {
      const record = saved(keys(safeConfig(config), walletAddress(bounty.reward[0].creator_wallet), bounty.id).last);
      return record?.hash ? transactionHash(record.hash) : undefined;
    } catch {
      return undefined;
    }
  }
  function matches(entry, transaction) {
    return transaction && transaction.from?.toLowerCase() === entry.from.toLowerCase() &&
      transaction.to?.toLowerCase() === entry.to.toLowerCase() &&
      transaction.input?.toLowerCase() === entry.data.toLowerCase() && BigInt(transaction.value) === 0n;
  }
  async function clearMinedPending(key, hashOverride) {
    const pending = saved(key);
    if (!pending) return;
    const hash = hashOverride ? transactionHash(hashOverride) : pending.hash;
    if (!hash) throw new WalletError('A previous wallet request has no saved hash. Find the transaction in wallet activity and use “Check pending transaction”.');
    const [receipt, transaction] = await Promise.all([
      rpc('eth_getTransactionReceipt', [hash]),
      rpc('eth_getTransactionByHash', [hash]),
    ]);
    if (!matches(pending, transaction)) {
      throw new WalletError('The previous wallet request is unresolved. Check the exact transaction in your wallet activity.');
    }
    if (!receipt || receipt.blockHash?.toLowerCase() !== transaction.blockHash?.toLowerCase() ||
        receipt.transactionHash?.toLowerCase() !== hash || !['0x0', '0x1'].includes(receipt.status)) {
      throw new WalletError('The earlier wallet transaction is still pending. Check it in wallet activity before retrying.');
    }
    if (pending.kind !== 'allowance' && pending.kind !== 'reset' && receipt.status === '0x1') {
      record(pending.last, { hash });
    }
    record(key, null);
  }
  function withLock(key, operation) {
    const lock = locks();
    if (!lock) throw new WalletError('Use a browser that can coordinate pending wallet transactions across tabs.');
    return lock.request(key, { ifAvailable: true }, granted => {
      if (!granted) throw new WalletError('A wallet operation is in progress in another tab.');
      return operation();
    });
  }
  async function recoverPending(config, bounty, hash) {
    const contract = safeConfig(config);
    const creator = walletAddress(bounty.reward[0].creator_wallet);
    const key = keys(contract, creator, bounty.id).pending;
    if (await selected() !== creator) throw new WalletError('Select the sponsor wallet for this reward.');
    await withLock(key, () => clearMinedPending(key, hash));
    return 'Pending wallet transaction checked.';
  }
  async function send(config, bounty, kind, submission, stillCurrent = () => true) {
    const contract = safeConfig(config);
    const creator = walletAddress(bounty.reward[0].creator_wallet);
    const storage = keys(contract, creator, bounty.id);
    return withLock(storage.pending, async () => {
      if (await selected() !== creator) throw new WalletError('Select the sponsor wallet for this reward.');
      await clearMinedPending(storage.pending);
      const state = await current(config, bounty);
      const boardStatus = bounty.reward[0].status;
      const empty = state.status === 0n;
      const funded = state.status === 1n;
      const awaitingFunding = boardStatus === 'awaiting_funding';
      if (bounty.status !== 'open' || (!awaitingFunding && boardStatus !== 'funded')) {
        throw new WalletError('The reward is no longer open.');
      }
      if (kind !== 'cancel' && (funded || state.status === 2n) && state.amount !== state.expected) {
        throw new WalletError('The on-chain amount differs from the prepared reward. Use cancellation to refund it before proceeding.');
      }
      if ((kind === 'allowance' || kind === 'reset' || kind === 'fund') && (!awaitingFunding || !empty)) {
        throw new WalletError('This reward already changed on Robinhood Chain. Verify the prior transaction first.');
      }
      if ((kind === 'allowance' || kind === 'fund') && bounty.deadline[0] <= BigInt(Date.now())) {
        throw new WalletError('This bounty’s submission deadline has passed. You can cancel the prepared reward.');
      }

      let to = state.contract;
      let data;
      if (kind === 'reset' || kind === 'allowance') {
        const desired = kind === 'reset' ? 0n : state.expected;
        if (state.allowance === desired) return { already: true };
        if (kind === 'allowance' && state.allowance !== 0n) {
          throw new WalletError('Clear the existing allowance first. Then approve the exact reward amount.');
        }
        to = TOKEN_ADDRESS;
        data = token.encodeFunctionData('approve', [state.contract, desired]);
      } else if (kind === 'fund') {
        if (state.allowance !== state.expected) throw new WalletError('Approve exactly the reward amount before funding.');
        if (state.balance < state.expected) throw new WalletError('The sponsor wallet does not have enough GH0ST.');
        data = escrow.encodeFunctionData('fund', [state.key, state.expected]);
      } else if (kind === 'pay') {
        if (!funded || boardStatus !== 'funded') throw new WalletError('Verify a funded reward before approving payment.');
        if (!submission || submission.status !== 'pending') throw new WalletError('This submission is no longer pending.');
        const payout = walletAddress(submission.payout_wallet[0]);
        data = escrow.encodeFunctionData('approve', [state.key, submission.id, payout]);
      } else if (kind === 'cancel') {
        if (!(empty && awaitingFunding) && !funded) {
          throw new WalletError('The escrow changed on Robinhood Chain. Verify its earlier transaction first.');
        }
        data = escrow.encodeFunctionData('cancel', [state.key]);
      } else {
        throw new WalletError('Unsupported wallet action.');
      }

      const tx = { from: creator, to, data, value: '0x0', chainId: CHAIN_HEX };
      await rpc('eth_estimateGas', [tx]);
      if (await selected() !== creator || !stillCurrent()) throw new WalletError('Your wallet or sign-in changed. Check the board before trying again.');
      const entry = { kind, from: creator, to, data, last: storage.last };
      record(storage.pending, entry);
      let hash;
      try {
        hash = transactionHash(await rpc('eth_sendTransaction', [tx]));
      } catch (error) {
        if (Number(error?.code) === 4001) {
          record(storage.pending, null);
          throw new WalletError('You declined the transaction in your wallet.');
        }
        throw new WalletError('The wallet did not return a transaction hash. Check wallet activity before sending again.');
      }
      try {
        record(storage.pending, { ...entry, hash });
        if (kind !== 'allowance' && kind !== 'reset') record(storage.last, { hash });
      } catch {
        // The hash is still returned so the sponsor can copy it before leaving.
      }
      return { hash };
    });
  }
  return { selected, directSponsor, getLastHash, recoverPending, send };
}
