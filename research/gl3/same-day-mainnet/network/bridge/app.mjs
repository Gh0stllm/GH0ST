import { BrowserProvider, JsonRpcProvider, Contract, Interface, parseUnits, formatUnits } from '/mint/vendor/ethers.js';
import { deriveBridgeState } from './bridge-state.mjs';
import { validatePublicConfig, validateFinalSetupReadback, requireAmount, withdrawalBudget, confirmedMaxQuote, withdrawalArgs, ZERO_HASH, lower } from './core.mjs';
const $ = id => document.getElementById(id);
const TOKEN_ABI = ['function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)'];
const ROLLUP_ABI = ['function anyTrustFastConfirmer() view returns(address)', 'function bridge() view returns(address)', 'function inbox() view returns(address)', 'function outbox() view returns(address)'];
const BRIDGE_ABI = ['function nativeToken() view returns(address)', 'function nativeTokenDecimals() view returns(uint8)'];
const ARBSYS_ABI = ['function withdrawEth(address) payable returns(uint256)', 'function sendMerkleTreeState() view returns(uint256 size,bytes32 root,bytes32[] partials)', 'event L2ToL1Tx(address caller,address indexed destination,uint256 indexed hash,uint256 indexed position,uint256 arbBlockNum,uint256 ethBlockNum,uint256 timestamp,uint256 callvalue,bytes data)'];
const NODE_ABI = ['function constructOutboxProof(uint64 size,uint64 leaf) view returns(bytes32 send,bytes32 root,bytes32[] proof)'];
const OUTBOX_ABI = ['function roots(bytes32) view returns(bytes32)', 'function isSpent(uint256) view returns(bool)', 'function executeTransaction(bytes32[],uint256,address,address,uint256,uint256,uint256,uint256,bytes)', 'event SendRootUpdated(bytes32 indexed outputRoot,bytes32 indexed l2BlockHash)'];
const OWNER_PUBLIC_ABI = ['function getAllChainOwners() view returns(address[])', 'function getAllNativeTokenOwners() view returns(address[])', 'function getNetworkFeeAccount() view returns(address)', 'function getInfraFeeAccount() view returns(address)'];
const GAS_INFO_ABI = ['function getMinimumGasPrice() view returns(uint256)', 'function getL1RewardRecipient() view returns(address)'];
let config, parent, child, account, injected, direction = 'deposit', busy = false, observation, claimArgs;
const arbAddress = '0x0000000000000000000000000000000000000064';
const nodeAddress = '0x00000000000000000000000000000000000000c8';
function status(text, error = false) { $('network-status').textContent = text; $('network-status').classList.toggle('error', error); }
function receipt(label, tx, childChain) {
  const li = document.createElement('li'), a = document.createElement('a');
  a.textContent = `${label}: ${tx.slice(0, 10)}…${tx.slice(-6)}`;
  a.href = `${childChain ? config.childExplorerUrl : config.parentExplorerUrl}/tx/${tx}`;
  a.target = '_blank'; a.rel = 'noopener'; li.append(a); $('receipts').prepend(li);
}
function controls() {
  const ready = config?.enabled && observation && account && !busy;
  $('action').disabled = !ready; $('check-withdrawal').disabled = !observation || busy;
  $('max').disabled = !ready;
  $('claim').disabled = !(ready && claimArgs);
  $('action').textContent = !config?.enabled ? 'Bridge not enabled' : !account ? 'Connect wallet to continue' : busy ? 'Waiting for your transaction…' : direction === 'deposit' ? 'Deposit GH0ST' : 'Withdraw to Robinhood';
}
async function guard() {
  observation = null;
  validatePublicConfig(config);
  const rollup = new Contract(config.rollupAddress, ROLLUP_ABI, parent), bridge = new Contract(config.nativeBackingBridge, BRIDGE_ABI, parent);
  const [pId, cId, genesis, role, bridgeAddr, inboxAddr, outboxAddr, token, decimals, head] = await Promise.all([
    parent.send('eth_chainId', []), child.send('eth_chainId', []), child.send('eth_getBlockByNumber', ['0x0', false]),
    rollup.anyTrustFastConfirmer(), rollup.bridge(), rollup.inbox(), rollup.outbox(), bridge.nativeToken(), bridge.nativeTokenDecimals(), child.getBlockNumber()
  ]);
  if (BigInt(pId) !== 4663n || BigInt(cId) !== 4663001n || lower(bridgeAddr) !== lower(config.nativeBackingBridge) || lower(inboxAddr) !== lower(config.inboxAddress) || lower(outboxAddr) !== lower(config.outboxAddress) || lower(token) !== lower(config.parentBackingToken) || Number(decimals) !== 18) throw Error('Live network or native backing binding changed');
  const owner = new Contract('0x000000000000000000000000000000000000006b', OWNER_PUBLIC_ABI, child);
  const gas = new Contract('0x000000000000000000000000000000000000006c', GAS_INFO_ABI, child);
  const [owners, minters, networkFeeAccount, infraFeeAccount, minimumGasPrice, l1RewardRecipient, latest] = await Promise.all([
    owner.getAllChainOwners(), owner.getAllNativeTokenOwners(), owner.getNetworkFeeAccount(), owner.getInfraFeeAccount(), gas.getMinimumGasPrice(), gas.getL1RewardRecipient(), child.send('eth_getBlockByNumber', ['latest', false])
  ]);
  validateFinalSetupReadback(config, { owners: Array.from(owners), minters: Array.from(minters), networkFeeAccount, infraFeeAccount, minimumGasPrice, l1RewardRecipient, baseFee: latest.baseFeePerGas });
  const observed = { parentChainId: Number(BigInt(pId)), childChainId: Number(BigInt(cId)), childGenesisHash: genesis?.hash, rollupAddress: config.rollupAddress,
    anyTrustFastConfirmer: role, nativeBackingVerified: true, nodeHealthy: head >= 0, batchPosterHealthy: Boolean(config.evidence.batchPosterHealth) };
  // Batch-poster liveness is supplied as launch evidence; this RPC check is not a continuous monitor.
  const state = deriveBridgeState(config, observed);
  if (state.status === 'unavailable') throw Error(state.reason);
  observation = observed; return observed;
}
async function wallet(chainId) {
  if (!injected) throw Error('Connect an Ethereum wallet first.');
  const hex = '0x' + chainId.toString(16);
  try { await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); }
  catch (e) {
    if (Number(e.code) !== 4902 || chainId !== 4663001) throw e;
    await injected.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: 'GH0ST GL3', nativeCurrency: { name: 'GH0ST', symbol: 'GH0ST', decimals: 18 }, rpcUrls: [config.childRpcUrl], blockExplorerUrls: [config.childExplorerUrl] }] });
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  }
  if (BigInt(await injected.request({ method: 'eth_chainId' })) !== BigInt(chainId)) throw Error('Wallet is on the wrong network');
  const p = new BrowserProvider(injected), s = await p.getSigner();
  if (lower(await s.getAddress()) !== lower(account)) throw Error('Wallet account changed. Connect again.');
  return s;
}
async function balances() {
  if (!account || !parent || !child) return;
  const value = direction === 'deposit' ? await new Contract(config.parentBackingToken, TOKEN_ABI, parent).balanceOf(account) : await child.getBalance(account);
  $('balance').textContent = `${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 5 })} GH0ST`;
}
async function liveWithdrawalBudget(value = 1n) {
  const data = new Interface(ARBSYS_ABI).encodeFunctionData('withdrawEth', [account]);
  const [balance, estimate, fees] = await Promise.all([
    child.getBalance(account), child.estimateGas({ from: account, to: arbAddress, data, value }), child.getFeeData()
  ]);
  const priceCap = fees.maxFeePerGas ?? fees.gasPrice;
  const b = withdrawalBudget(balance, estimate, priceCap);
  return { ...b, overrides: fees.maxFeePerGas != null ? { gasLimit: b.gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n } : { gasLimit: b.gasLimit, gasPrice: fees.gasPrice } };
}
async function maxAmount() {
  busy = true; controls();
  try {
    await guard();
    if (direction === 'deposit') $('amount').value = formatUnits(await new Contract(config.parentBackingToken, TOKEN_ABI, parent).balanceOf(account), 18);
    else {
      const quote = await confirmedMaxQuote(liveWithdrawalBudget); $('amount').value = formatUnits(quote.amount, 18);
      $('action-note').textContent = `Max reserves ${formatUnits(quote.reserve, 18)} GH0ST using the live gas estimate, a 20% gas-limit margin and current fee cap. The wallet shows the final fee.`;
    }
  } catch (e) { status(e.shortMessage || e.message, true); }
  finally { busy = false; controls(); }
}
async function transfer() {
  busy = true; controls();
  try {
    await guard(); const value = parseUnits(requireAmount($('amount').value), 18);
    if (direction === 'deposit') {
      const s = await wallet(4663);
      if (await parent.getCode(account) !== '0x') throw Error('This direct-deposit interface supports externally owned wallets. Contract wallets use address aliasing.');
      const token = new Contract(config.parentBackingToken, TOKEN_ABI, s);
      if (await token.allowance(account, config.inboxAddress) < value) {
        status('Review the exact GH0ST allowance in your wallet.'); const approval = await token.approve(config.inboxAddress, value);
        const r = await approval.wait(); if (r.status !== 1) throw Error('Approval did not succeed'); receipt('Allowance approved', approval.hash, false);
      }
      await guard(); status('Review your Robinhood deposit in your wallet.');
      const tx = await new Contract(config.inboxAddress, ['function depositERC20(uint256) returns(uint256)'], s).depositERC20(value);
      receipt('Deposit submitted', tx.hash, false); const r = await tx.wait(); if (r.status !== 1) throw Error('Deposit did not succeed');
      status('Deposit confirmed on Robinhood. GL3 credit follows when its inbox processes this deposit; check your GL3 balance.');
    } else {
      const s = await wallet(4663001); status('Review your GL3 withdrawal in your wallet. Leave GH0ST for transaction gas.');
      const quote = await liveWithdrawalBudget(value);
      if (value > quote.amount) throw Error('Leave enough GH0ST for the current withdrawal gas. Use Max to refresh the amount.');
      const tx = await new Contract(arbAddress, ARBSYS_ABI, s).withdrawEth(account, { value, ...quote.overrides });
      receipt('Withdrawal submitted', tx.hash, true); const r = await tx.wait(); if (r.status !== 1) throw Error('Withdrawal did not succeed');
      $('withdrawal-hash').value = tx.hash; localStorage.setItem('gh0st-gl3-last-withdrawal', tx.hash);
      status('Withdrawal recorded on GL3. GH0ST must confirm its root on Robinhood before you claim.');
      await checkWithdrawal();
    }
    await balances();
  } catch (e) { status(e.shortMessage || e.message || 'Transaction stopped', true); }
  finally { busy = false; controls(); }
}
async function checkWithdrawal() {
  claimArgs = null; $('claim').disabled = true;
  try {
    await guard(); const hash = $('withdrawal-hash').value.trim(); if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('Enter a valid GL3 withdrawal transaction hash.');
    const r = await child.getTransactionReceipt(hash); if (!r || r.status !== 1) throw Error('Successful GL3 receipt not found yet.');
    const iface = new Interface(ARBSYS_ABI);
    const events = r.logs.filter(l => lower(l.address) === lower(arbAddress)).map(l => { try { return iface.parseLog(l); } catch { return null; } }).filter(l => l?.name === 'L2ToL1Tx' && l.args.data === '0x' && l.args.callvalue > 0n);
    if (events.length !== 1) throw Error('Expected exactly one simple GH0ST withdrawal in this transaction.');
    const e = events[0], outbox = new Contract(config.outboxAddress, OUTBOX_ABI, parent);
    if (await outbox.isSpent(e.args.position)) { $('withdrawal-status').textContent = `Already claimed on Robinhood to ${e.args.destination}.`; return; }
    const arb = new Contract(arbAddress, ARBSYS_ABI, child), ni = new Contract(nodeAddress, NODE_ABI, child);
    let tree = await arb.sendMerkleTreeState();
    let registered = await outbox.roots(tree.root);
    if (lower(registered) === ZERO_HASH) {
      // Recover older confirmed roots even if later withdrawals changed the latest tree.
      const head = await parent.getBlockNumber();
      const logs = await outbox.queryFilter(outbox.filters.SendRootUpdated(), Math.max(config.parentDeploymentBlock || 0, head - 2000), head);
      for (const log of logs.reverse()) {
        const header = await child.send('eth_getBlockByHash', [log.args.l2BlockHash, false]);
        if (!header || Number(BigInt(header.number)) < r.blockNumber) continue;
        const candidate = await arb.sendMerkleTreeState({ blockTag: header.number });
        if (candidate.size > e.args.position && lower(candidate.root) === lower(log.args.outputRoot)) { tree = candidate; registered = log.args.l2BlockHash; break; }
      }
    }
    if (lower(registered) === ZERO_HASH || tree.size <= e.args.position) {
      $('withdrawal-status').textContent = 'Waiting for GH0ST to confirm this withdrawal root on Robinhood. Processing time varies. Check again shortly.'; return;
    }
    const proof = await ni.constructOutboxProof(tree.size, e.args.position);
    if (lower(proof.root) !== lower(tree.root)) throw Error('Withdrawal proof does not match the confirmed root');
    const args = withdrawalArgs(e, proof.proof); await outbox.executeTransaction.staticCall(...args);
    claimArgs = args; $('claim').disabled = !account;
    $('withdrawal-status').textContent = `${formatUnits(e.args.callvalue, 18)} GH0ST is claimable on Robinhood to ${e.args.destination}. Robinhood processing fees apply.`;
  } catch (e) { $('withdrawal-status').textContent = e.shortMessage || e.message; }
  finally { controls(); }
}
async function claim() {
  busy = true; $('claim').disabled = true; controls();
  try {
    await guard(); if (!claimArgs) throw Error('Check the withdrawal again first.');
    const s = await wallet(4663), outbox = new Contract(config.outboxAddress, OUTBOX_ABI, s);
    await outbox.executeTransaction.staticCall(...claimArgs);
    const tx = await outbox.executeTransaction(...claimArgs); receipt('Claim submitted', tx.hash, false);
    const r = await tx.wait(); if (r.status !== 1 || !await outbox.isSpent(claimArgs[1])) throw Error('Claim has not completed');
    status('Withdrawal claimed on Robinhood.'); await checkWithdrawal(); await balances();
  } catch (e) { status(e.shortMessage || e.message, true); }
  finally { busy = false; controls(); }
}
$('connect').onclick = async () => {
  try {
    injected = window.ethereum; if (!injected) throw Error('Open this page in a browser with an Ethereum wallet.');
    const accounts = await injected.request({ method: 'eth_requestAccounts' }); account = accounts[0];
    $('wallet-name').textContent = account.slice(0, 6) + '…' + account.slice(-4); $('connect').textContent = $('wallet-name').textContent;
    injected.on?.('accountsChanged', () => location.reload()); await balances(); controls(); if (claimArgs) $('claim').disabled = false;
  } catch (e) { status(e.message, true); }
};
for (const d of ['deposit', 'withdraw']) $(d + '-tab').onclick = async () => {
  direction = d; $('deposit-tab').setAttribute('aria-selected', d === 'deposit'); $('withdraw-tab').setAttribute('aria-selected', d === 'withdraw');
  $('from-chain').textContent = d === 'deposit' ? 'Robinhood' : 'GL3'; $('to-chain').textContent = d === 'deposit' ? 'GL3' : 'Robinhood';
  $('amount-help').textContent = d === 'deposit' ? 'Deposits go to the same connected EOA wallet on GL3.' : 'Withdraw to the same wallet on Robinhood. Leave GH0ST for GL3 gas.';
  controls(); try { await balances(); } catch { /* status is checked again before a transaction */ }
};
$('action').onclick = transfer; $('max').onclick = maxAmount; $('check-withdrawal').onclick = checkWithdrawal; $('claim').onclick = claim;
try {
  const r = await fetch('./public-config.json', { cache: 'no-store' }); config = await r.json();
  if (config.childExplorerUrl) $('explorer-link').href = config.childExplorerUrl;
  for (const [k, v] of Object.entries({ 'Parent chain': 'Robinhood / 4663', 'GL3 chain': '4663001', 'Token on Robinhood': config.parentBackingToken, 'Rollup': config.rollupAddress, 'Inbox': config.inboxAddress, 'Native escrow bridge': config.nativeBackingBridge, 'Outbox': config.outboxAddress, 'GH0ST confirmer': config.expectedAnyTrustFastConfirmer, 'Genesis hash': config.childGenesisHash })) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v || 'Awaiting verified deployment'; $('contract-details').append(dt, dd);
  }
  validatePublicConfig(config); parent = new JsonRpcProvider(config.parentRpcUrl); child = new JsonRpcProvider(config.childRpcUrl);
  await guard(); status('Bridge bindings verified. Connect your wallet to continue.');
  const last = localStorage.getItem('gh0st-gl3-last-withdrawal'); if (/^0x[0-9a-f]{64}$/i.test(last || '')) $('withdrawal-hash').value = last;
} catch (e) { observation = null; status(e.message, true); }
controls();
