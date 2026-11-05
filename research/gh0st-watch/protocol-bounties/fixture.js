import { Principal } from '@icp-sdk/core/principal';
import { Interface, ZeroAddress, keccak256 } from 'ethers';
import { boardKey, TOKEN_ADDRESS } from './wallet.js';

// Local in-memory board and wallet. The production bundle excludes both.
export function createFixture() {
  const owner = Principal.selfAuthenticating(Uint8Array.of(1));
  const other = Principal.selfAuthenticating(Uint8Array.of(2));
  const sponsor = '0x0000000000000000000000000000000000000011';
  const contributor = '0x0000000000000000000000000000000000000022';
  const contract = '0x0000000000000000000000000000000000000033';
  const fixtureCode = '0x6000';
  const config = { chain_id: 4663n, token_address: TOKEN_ADDRESS, escrow_address: contract };
  const abi = new Interface([
    'function token() view returns (address)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address owner) view returns (uint256)',
    'function allowance(address owner,address spender) view returns (uint256)',
    'function approve(address spender,uint256 amount) returns (bool)',
    'function fund(bytes32 bountyKey,uint256 amount)',
    'function approve(bytes32 bountyKey,uint64 submissionId,address recipient)',
    'function cancel(bytes32 bountyKey)',
    'function getReward(address creator,bytes32 bountyKey) view returns (uint8 status,uint256 amount,uint64 submissionId,address recipient)',
  ]);
  const created = BigInt(Date.now() - 86_400_000);
  const chain = new Map();
  const transactions = new Map();
  const storage = new Map();
  let allowance = 0n;
  let txCount = 0n;
  let principal;
  let onChange = () => {};
  const amount = 2500000000000000000n;
  const stateKey = (wallet, key) => `${wallet.toLowerCase()}:${key}`;
  function prepared(id, wallet, amountWei, status = 'awaiting_funding') {
    const bounty_key = boardKey(BOUNTIES_CANISTER_ID, id);
    if (status === 'funded') chain.set(stateKey(wallet, bounty_key), [1n, BigInt(amountWei), 0n, ZeroAddress]);
    return { creator_wallet: wallet, amount_wei: amountWei.toString(), bounty_key, status, tx_hash: [] };
  }
  function task(id, author, title, description, category, extra = {}) {
    return {
      id, owner: author, title, description, category, deadline: [], status: 'open',
      created_at: created, updated_at: created, submissions: [], reward: [], ...extra,
    };
  }
  function proof(id, submitter, payout_wallet = []) {
    return {
      id, submitter, proof_url: 'https://github.com/Gh0stllm/GH0ST',
      note: 'Example evidence link for the local fixture.', status: 'pending',
      created_at: created, reviewed_at: [], payout_wallet,
    };
  }
  const records = [
    task(5n, owner, 'Document a Watcher finding',
      'Pick a Robinhood Chain contract and write up one Watcher finding. Include the contract address and evidence link.',
      'research', { submissions: [proof(1n, other)] }),
    task(4n, other, 'Build a Spawn walkthrough',
      'Record the steps to configure a GH0ST with AgentKit. Include a public demo and the settings you used.',
      'content', { deadline: [created + 604_800_000n] }),
    task(3n, other, 'Map the roadmap links',
      'Check the links and milestone descriptions on the GH0ST roadmap.',
      'other', { status: 'completed' }),
    task(2n, owner, 'Explain an escrow payout',
      'A funded sponsor bounty used to exercise a wallet payout in this localhost fixture.',
      'research', { reward: [prepared(2n, sponsor, amount, 'funded')], submissions: [proof(2n, other, [contributor])] }),
    task(1n, other, 'Design a proof-of-work card',
      'A funded contributor bounty used to exercise immutable payout addresses in this localhost fixture.',
      'build', { reward: [prepared(1n, contributor, amount, 'funded')] }),
  ];
  const get = id => records.find(bounty => bounty.id === id);
  function summary({ description, submissions, ...fields }) {
    return { ...fields, submission_count: submissions.length };
  }
  function touch(bounty) {
    bounty.updated_at = BigInt(Date.now());
    return bounty;
  }
  function addSubmission(id, proof_url, note, payout_wallet) {
    const bounty = get(id);
    bounty.submissions.push({
      ...proof(BigInt(bounty.submissions.length + 1), owner, payout_wallet),
      proof_url, note, created_at: BigInt(Date.now()),
    });
    return touch(bounty);
  }
  const service = {
    onSessionChange(callback) { onChange = callback; },
    async restore() { return principal; },
    async signIn() { principal = owner.toText(); onChange(principal); return principal; },
    async signOut() { principal = undefined; onChange(principal); },
    async list(cursor) {
      const page = records.filter(item => cursor === null || item.id < cursor).slice(0, 2);
      const last = page.at(-1)?.id;
      return { items: page.map(summary), next: records.some(item => item.id < last) ? last : null };
    },
    async get(id) { return get(id); },
    async create(input) {
      const bounty = touch(task(records[0].id + 1n, owner, input.title, input.description, input.category, { deadline: input.deadline }));
      records.unshift(bounty);
      return bounty;
    },
    async submit(id, url, note) { return addSubmission(id, url, note, []); },
    async submitReward(id, url, note, payout) { return addSubmission(id, url, note, [payout]); },
    async rewardConfig() { return config; },
    async prepareReward(id, wallet, amountWei) {
      const bounty = get(id);
      bounty.reward = [prepared(id, wallet, amountWei)];
      return touch(bounty);
    },
    async syncReward(id, hash) {
      const bounty = get(id);
      const reward = bounty.reward[0];
      const tx = transactions.get(hash);
      const parsed = tx && abi.parseTransaction({ data: tx.input });
      if (tx?.to !== contract || tx.from !== reward.creator_wallet || parsed?.args[0] !== reward.bounty_key) {
        throw new Error('Fixture transaction did not match the escrow key.');
      }
      const [status, value, submissionId, recipient] = chain.get(stateKey(tx.from, reward.bounty_key));
      if (status === 1n && value.toString() === reward.amount_wei) reward.status = 'funded';
      else if (status === 2n) {
        reward.status = 'paid';
        bounty.status = 'completed';
        const submission = bounty.submissions.find(item => item.id === submissionId && item.payout_wallet[0] === recipient);
        submission.status = 'approved';
      } else if (status === 3n) {
        reward.status = 'cancelled';
        bounty.status = 'cancelled';
      } else throw new Error('Fixture reward state did not match.');
      reward.tx_hash = [hash];
      return touch(bounty);
    },
    async review(id, submissionId, approve) {
      const bounty = get(id);
      const submission = bounty.submissions.find(item => item.id === submissionId);
      submission.status = approve ? 'approved' : 'rejected';
      submission.reviewed_at = [BigInt(Date.now())];
      if (approve) bounty.status = 'completed';
      return touch(bounty);
    },
    async cancel(id) {
      const bounty = get(id);
      bounty.status = 'cancelled';
      return touch(bounty);
    },
  };
  function parse(data) {
    const call = abi.parseTransaction({ data });
    if (!call) throw new Error('Unsupported fixture calldata.');
    return call;
  }
  const provider = {
    async request({ method, params }) {
      if (method === 'eth_chainId') return '0x1237';
      if (method === 'eth_blockNumber') return '0x20';
      if (method === 'eth_getCode' && params[0] === contract && params[1] === '0x20') return fixtureCode;
      if (method === 'eth_getCode' && params[0] === sponsor && params[1] === '0x20') return '0x';
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [sponsor];
      if (method === 'eth_estimateGas') return '0x10000';
      if (method === 'eth_getTransactionByHash') return transactions.get(params[0]) ?? null;
      if (method === 'eth_getTransactionReceipt') {
        const tx = transactions.get(params[0]);
        return tx ? { transactionHash: params[0], blockHash: tx.blockHash, status: '0x1' } : null;
      }
      const tx = params[0];
      const call = parse(tx.data);
      const [first, second, third] = call.args;
      if (method === 'eth_call') {
        const result = call.name === 'getReward' ? chain.get(stateKey(first, second)) ?? [0n, 0n, 0n, ZeroAddress] : {
          token: [TOKEN_ADDRESS], decimals: [18n], balanceOf: [1000n * amount], allowance: [allowance],
        }[call.name];
        return abi.encodeFunctionResult(call.fragment, result);
      }
      if (method !== 'eth_sendTransaction' || tx.from !== sponsor || tx.chainId !== '0x1237' || tx.value !== '0x0') {
        throw new Error('Invalid fixture wallet request.');
      }
      const key = stateKey(tx.from, first);
      if (call.signature === 'approve(address,uint256)' && tx.to === TOKEN_ADDRESS && first === contract) allowance = second;
      else if (tx.to !== contract) throw new Error('Unexpected fixture transaction target.');
      else if (call.name === 'fund' && second === allowance) {
        chain.set(key, [1n, second, 0n, ZeroAddress]);
        allowance = 0n;
      } else if (call.name === 'approve') chain.set(key, [2n, chain.get(key)[1], second, third]);
      else if (call.name === 'cancel') chain.set(key, [3n, chain.get(key)?.[1] ?? 0n, 0n, ZeroAddress]);
      else throw new Error('Unsupported fixture wallet transaction.');
      const hash = `0x${(++txCount).toString(16).padStart(64, '0')}`;
      transactions.set(hash, { ...tx, input: tx.data, blockHash: `0x${'a'.repeat(64)}` });
      return hash;
    },
  };
  return {
    service,
    wallet: {
      provider: () => provider,
      expectedRuntimeHash: keccak256(fixtureCode),
      store: () => ({
        getItem: key => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      }),
    },
  };
}
