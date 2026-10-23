/* Public, wallet-signed full-range liquidity for the single reviewed GH0ST hook pool. */
(function (root) {
  'use strict';
  const POSITION_MANAGER = '0x58daec3116aae6d93017baaea7749052e8a04fa7';
  const POSITION_HASH = '0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2';
  const SOURCE_POOL = '0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01';
  const lower = value => String(value).toLowerCase();
  const ensure = (ok, message) => { if (!ok) throw Error(message); };
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  function createClient(options = {}) {
    const ethers = options.ethers || root.ethers, swap = options.swapLibrary || root.GH0STSwap;
    const math = options.math || root.GH0STLiquidity;
    ensure(ethers?.Interface && swap?.CONSTANTS && math?.liquidityForAmounts, 'The liquidity libraries must load first.');
    const C = swap.CONSTANTS, KEY = swap.POOL_KEY, KEY_TYPE = swap.KEY_TYPE;
    const ethereum = options.ethereum || root.ethereum;
    const readProvider = options.readProvider || new ethers.JsonRpcProvider(C.rpc, C.chainId, { staticNetwork: true, batchMaxCount: 1 });
    const storage = options.storage || root.localStorage, now = options.now || Date.now, notify = options.onStatus || (() => {});
    const abi = {
      position: new ethers.Interface(math.POSITION_MANAGER_ABI), token: new ethers.Interface(swap.ABI.token),
      permit: new ethers.Interface(swap.ABI.permit2), state: new ethers.Interface(swap.ABI.state),
      hook: new ethers.Interface(swap.ABI.hook), model: new ethers.Interface(swap.ABI.model),
    };
    const coder = ethers.AbiCoder.defaultAbiCoder(), issued = new WeakSet(), consumed = new Set();
    let walletProvider = options.walletProvider || null, signer = options.signer || null, account = null, busy = false, counter = 0;
    const recordKey = who => `gh0st:h00k:liquidity:${C.chainId}:${lower(who)}`;
    function record(who = account) { const raw = storage?.getItem(recordKey(who)); try { return raw ? JSON.parse(raw) : null; } catch (_) { throw Error('Review the saved liquidity transaction before continuing.'); } }
    const save = (who, value) => value ? storage.setItem(recordKey(who), JSON.stringify(value)) : storage.removeItem(recordKey(who));
    const recordIdentity = value => value ? JSON.stringify([value.kind, value.account, value.quoteId, value.liquidity,
      value.to, value.data, value.value, value.hash, value.submittedAt]) : null;
    function replaceRecord(who, previous, next) {
      ensure(recordIdentity(record(who)) === recordIdentity(previous), 'The pending liquidity transaction changed in another tab. Refresh before continuing.');
      save(who, next);
    }
    async function read(work) { try { return await work(readProvider); } catch (e) { if (!walletProvider) throw e; return work(walletProvider); } }
    async function call(provider, to, name, method, args, blockTag) {
      return abi[name].decodeFunctionResult(method, await provider.call({ to, data: abi[name].encodeFunctionData(method, args || []), blockTag }));
    }
    async function identity() {
      ensure(walletProvider && signer && account, 'Connect your wallet first.');
      ensure(BigInt(await walletProvider.send('eth_chainId', [])) === BigInt(C.chainId), 'Switch your wallet to Robinhood Chain.');
      const accounts = await walletProvider.send('eth_accounts', []);
      ensure(accounts.length && lower(accounts[0]) === lower(account) && lower(await signer.getAddress()) === lower(account), 'Your wallet changed. Reconnect and request a new liquidity quote.');
    }
    async function snapshot(who = account) {
      return read(async provider => {
        ensure(BigInt(await provider.send('eth_chainId', [])) === BigInt(C.chainId), 'The read provider is on the wrong chain.');
        const block = await provider.getBlock('latest');
        ensure(block && Math.abs(now() / 1000 - block.timestamp) <= 120, 'The network returned an old block. Refresh the quote.');
        const b = block.number;
        const pins = [C.poolManager, C.stateView, C.token, C.permit2, C.model, C.hook].map(address => [address, swap.PINS[address]]);
        pins.push([POSITION_MANAGER, POSITION_HASH]);
        await Promise.all(pins.map(async ([address, hash]) => {
          const code = await provider.getCode(address, b);
          ensure(hash && code !== '0x' && lower(ethers.keccak256(code)) === lower(hash), `Contract verification failed: ${address}`);
        }));
        const [target, source, sourceLiquidity, pm, p2, decimals, hookModel, hash, hookManager] = await Promise.all([
          call(provider, C.stateView, 'state', 'getSlot0', [C.poolId], b), call(provider, C.stateView, 'state', 'getSlot0', [SOURCE_POOL], b),
          call(provider, C.stateView, 'state', 'getLiquidity', [SOURCE_POOL], b), call(provider, POSITION_MANAGER, 'position', 'poolManager', [], b),
          call(provider, POSITION_MANAGER, 'position', 'permit2', [], b), call(provider, C.token, 'token', 'decimals', [], b),
          call(provider, C.hook, 'hook', 'model', [], b), call(provider, C.hook, 'hook', 'modelHash', [], b), call(provider, C.hook, 'hook', 'poolManager', [], b),
        ]);
        ensure(lower(pm[0]) === lower(C.poolManager) && lower(hookManager[0]) === lower(C.poolManager) && lower(p2[0]) === lower(C.permit2), 'The liquidity contract dependencies do not match.');
        ensure(lower(hookModel[0]) === lower(C.model) && lower(hash[0]) === lower(C.modelHash) && Number(decimals[0]) === 18, 'The GH0ST model or token does not match.');
        const initialized = target[0] > 0n, price = initialized ? target[0] : source[0];
        ensure(price > 0n && (initialized || sourceLiquidity[0] > 0n), 'A liquid reference price is unavailable.');
        let balances = null;
        if (who) {
          const [native, token, approval, permit] = await Promise.all([provider.getBalance(who, b), call(provider, C.token, 'token', 'balanceOf', [who], b),
            call(provider, C.token, 'token', 'allowance', [who, C.permit2], b), call(provider, C.permit2, 'permit', 'allowance', [who, C.token, POSITION_MANAGER], b)]);
          balances = { native, token: token[0], allowance: approval[0], permitAmount: permit[0], permitExpiry: permit[1] };
        }
        return { provider, block, initialized, price, source: initialized ? 'target' : 'reference', balances };
      });
    }
    async function status() {
      const s = await snapshot();
      const result = freeze({ account, chainId: C.chainId, initialized: s.initialized, source: s.source, poolId: C.poolId,
        sqrtPriceX96: s.price.toString(), blockNumber: s.block.number,
        balances: s.balances ? { eth: ethers.formatUnits(s.balances.native, 18), ghost: ethers.formatUnits(s.balances.token, 18) } : null });
      notify(result); return result;
    }
    async function connect() {
      ensure(ethereum?.request || walletProvider, 'Open the page in a wallet browser or install an Ethereum wallet.');
      if (!walletProvider) walletProvider = new ethers.BrowserProvider(ethereum, 'any');
      if (ethereum) {
        await ethereum.request({ method: 'eth_requestAccounts' });
        if (BigInt(await ethereum.request({ method: 'eth_chainId' })) !== BigInt(C.chainId)) {
          try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: C.chainHex }] }); }
          catch (e) {
            if (Number(e.code) !== 4902) throw e;
            await ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: C.chainHex, chainName: C.name,
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [C.rpc], blockExplorerUrls: [C.explorer] }] });
          }
        }
      }
      signer = signer || await walletProvider.getSigner(); account = ethers.getAddress(await signer.getAddress());
      await identity(); return status();
    }
    async function quote({ amountEth, slippageBps = 50 }) {
      ensure(slippageBps === 50, 'Liquidity uses a fixed 0.5% price tolerance.');
      const max0 = swap.parseAmount(amountEth, ethers), s = await snapshot();
      const max1 = max0 * s.price * s.price / (1n << 192n);
      ensure(max1 > 0n && max1 <= (1n << 128n) - 1n, 'This amount is outside the liquidity limits.');
      const bounds = math.priceBounds(s.price), tickLower = -887220, tickUpper = 887220;
      const a = math.sqrtRatioAtTick(tickLower), b = math.sqrtRatioAtTick(tickUpper);
      ensure(bounds.lower > a && bounds.upper < b, 'The current price is outside the full-range position.');
      const l0 = math.liquidityForAmounts(bounds.lower, a, b, max0, max1), l1 = math.liquidityForAmounts(bounds.upper, a, b, max0, max1);
      const liquidity = l0 < l1 ? l0 : l1;
      ensure(liquidity > 0n, 'This amount is too small to provide liquidity.');
      const expected = math.amountsForLiquidity(s.price, a, b, liquidity);
      const q = freeze({ id: `${now()}:${++counter}`, account, initialized: s.initialized, source: s.source, poolId: C.poolId,
        quoteSqrtPriceX96: s.price.toString(), lowerSqrtPriceX96: bounds.lower.toString(), upperSqrtPriceX96: bounds.upper.toString(),
        amount0Max: max0.toString(), amount1Max: max1.toString(), liquidity: liquidity.toString(), tickLower, tickUpper, slippageBps,
        amountEthMax: ethers.formatUnits(max0, 18), amountGhostMax: ethers.formatUnits(max1, 18),
        expectedEth: ethers.formatUnits(expected.amount0, 18), expectedGhost: ethers.formatUnits(expected.amount1, 18),
        unusedEth: ethers.formatUnits(max0 - expected.amount0, 18), unusedGhost: ethers.formatUnits(max1 - expected.amount1, 18),
        deadline: s.block.timestamp + 900, createdAt: now(), blockNumber: s.block.number });
      issued.add(q); return q;
    }
    async function checkedQuote(q) {
      ensure(q && issued.has(q) && !consumed.has(q.id), 'Review a fresh liquidity quote.'); await identity();
      ensure(q.account && lower(q.account) === lower(account), 'Review a fresh liquidity quote for this wallet.');
      ensure(now() - q.createdAt <= 120000, 'The liquidity quote expired. Review a new quote.');
      const s = await snapshot(account);
      ensure(s.initialized === q.initialized, 'Pool initialization changed. Review a new quote.');
      ensure(s.price >= BigInt(q.lowerSqrtPriceX96) && s.price <= BigInt(q.upperSqrtPriceX96), 'Pool price moved by more than 0.5%. Review a new quote.');
      ensure(s.block.timestamp < q.deadline, 'The liquidity deadline expired.');
      return s;
    }
    function mintTransaction(q) {
      const params = [coder.encode([KEY_TYPE, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
        [KEY, q.tickLower, q.tickUpper, q.liquidity, q.amount0Max, q.amount1Max, account, '0x']),
      coder.encode(['address', 'address'], [C.native, C.token]), coder.encode(['address', 'address'], [C.native, account])];
      const unlock = coder.encode(['bytes', 'bytes[]'], ['0x020d14', params]);
      const mint = abi.position.encodeFunctionData('modifyLiquidities', [unlock, q.deadline]);
      return freeze({ chainId: C.chainId, from: account, to: POSITION_MANAGER, value: BigInt(q.amount0Max),
        data: q.initialized ? mint : abi.position.encodeFunctionData('multicall', [
          [abi.position.encodeFunctionData('initializePool', [KEY, q.quoteSqrtPriceX96]), mint]]) });
    }
    async function nextAction(q) {
      await identity(); const pending = record();
      if (pending) return { kind: 'pending', label: pending.hash ? 'Check liquidity transaction' : 'Recover liquidity transaction', hash: pending.hash || null };
      const s = await checkedQuote(q), max0 = BigInt(q.amount0Max), max1 = BigInt(q.amount1Max);
      ensure(s.balances.native >= max0 && s.balances.token >= max1, 'Your wallet needs both ETH and GH0ST for this position.');
      if (s.balances.allowance !== max1) {
        const reset = s.balances.allowance > 0n;
        return { kind: reset ? 'reset_approval' : 'approve_token', label: reset ? 'Reset GH0ST allowance' : 'Approve GH0ST amount',
          transaction: { chainId: C.chainId, from: account, to: C.token, value: 0n, data: abi.token.encodeFunctionData('approve', [C.permit2, reset ? 0n : max1]) } };
      }
      if (s.balances.permitAmount !== max1 || s.balances.permitExpiry < BigInt(q.deadline)) {
        return { kind: 'approve_permit2', label: 'Approve this liquidity position', transaction: { chainId: C.chainId, from: account, to: C.permit2,
          value: 0n, data: abi.permit.encodeFunctionData('approve', [C.token, POSITION_MANAGER, max1, q.deadline]) } };
      }
      return { kind: 'mint', label: q.initialized ? 'Add liquidity' : 'Create pool & add liquidity', transaction: mintTransaction(q) };
    }
    async function settle(pending) {
      ensure(pending?.hash, 'Submission status is unknown. Recover it using the transaction hash from your wallet.');
      const receipt = await read(provider => provider.getTransactionReceipt(pending.hash));
      if (!receipt) return { pending: true, hash: pending.hash };
      if (Number(receipt.status) !== 1) { replaceRecord(pending.account, pending, null); throw Error('The liquidity transaction reverted.'); }
      const tx = await read(provider => provider.getTransaction(pending.hash));
      ensure(tx && lower(tx.from) === lower(pending.account) && lower(tx.to) === lower(pending.to) && lower(tx.data) === lower(pending.data)
        && BigInt(tx.value) === BigInt(pending.value), 'The receipt differs from the reviewed liquidity action.');
      let minted = null;
      if (pending.kind === 'mint') {
        const transfers = receipt.logs.filter(log => lower(log.address) === lower(POSITION_MANAGER)).flatMap(log => {
          try { const p = abi.position.parseLog(log); return p?.name === 'Transfer' && lower(p.args.from) === lower(C.native) && lower(p.args.to) === lower(pending.account) ? [p] : []; }
          catch (_) { return []; }
        });
        ensure(transfers.length === 1, 'The position NFT transfer could not be verified.');
        const id = transfers[0].args.tokenId;
        const [owner, amount, position, slot] = await read(provider => Promise.all([
          call(provider, POSITION_MANAGER, 'position', 'ownerOf', [id], receipt.blockNumber),
          call(provider, POSITION_MANAGER, 'position', 'getPositionLiquidity', [id], receipt.blockNumber),
          call(provider, POSITION_MANAGER, 'position', 'getPoolAndPositionInfo', [id], receipt.blockNumber),
          call(provider, C.stateView, 'state', 'getSlot0', [C.poolId], receipt.blockNumber),
        ]));
        const info = BigInt(position[1]), lowerTick = Number(BigInt.asIntN(24, info >> 8n)), upperTick = Number(BigInt.asIntN(24, info >> 32n));
        ensure(lower(owner[0]) === lower(pending.account) && amount[0] === BigInt(pending.liquidity) && lowerTick === -887220 && upperTick === 887220,
          'The minted position owner, range, or liquidity did not match.');
        ensure(ethers.keccak256(coder.encode([KEY_TYPE], [position[0]])) === C.poolId && slot[0] > 0n, 'The position belongs to a different pool.');
        minted = { tokenId: id.toString(), liquidity: amount[0].toString(), owner: owner[0], poolId: C.poolId };
        consumed.add(pending.quoteId);
      }
      replaceRecord(pending.account, pending, null); return { pending: false, hash: pending.hash, kind: pending.kind, receipt, minted };
    }
    async function sendOne(q) {
      ensure(!busy, 'Wait for the current wallet action.'); busy = true;
      try {
        const action = await nextAction(q); if (action.kind === 'pending') return settle(record());
        const estimate = await signer.estimateGas(action.transaction), gasLimit = (estimate * 150n + 99n) / 100n;
        const fees = await walletProvider.getFeeData(), fee = fees.maxFeePerGas || fees.gasPrice;
        ensure(fee !== null && fee !== undefined, 'The network fee is unavailable.');
        ensure(await walletProvider.getBalance(account) >= BigInt(action.transaction.value) + gasLimit * fee, 'Leave enough ETH for the network fee.');
        await checkedQuote(q); ensure(storage?.setItem && storage?.removeItem, 'Enable browser storage to track pending liquidity safely.');
        const pending = { kind: action.kind, account, quoteId: q.id, liquidity: q.liquidity, to: action.transaction.to, data: action.transaction.data,
          value: action.transaction.value.toString(), hash: null, submittedAt: now() };
        replaceRecord(pending.account, null, pending);
        let tx;
        try { tx = await signer.sendTransaction({ ...action.transaction, gasLimit }); }
        catch (e) { if (e.code === 'ACTION_REJECTED' || Number(e.code) === 4001) replaceRecord(pending.account, pending, null); throw e; }
        let current = { ...pending, hash: tx.hash }; replaceRecord(pending.account, pending, current);
        notify({ phase: 'submitted', kind: pending.kind, hash: tx.hash });
        try { await tx.wait(1); }
        catch (e) {
          if (e.code === 'TRANSACTION_REPLACED' && e.replacement?.hash) {
            const replacement = { ...current, hash: e.replacement.hash }; replaceRecord(pending.account, current, replacement); current = replacement;
          }
          else if (!e.receipt) return { pending: true, hash: current.hash };
        }
        return settle(current);
      } finally { busy = false; }
    }
    async function exclusive(work) {
      const key = `gh0st:h00k:sign:${C.chainId}`;
      if (options.withLock) return options.withLock(key, work);
      ensure(root.navigator?.locks?.request, 'Use a current browser with safe transaction locking.');
      return root.navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
        ensure(lock, 'Another tab is using your wallet. Wait for it to finish.'); return work();
      });
    }
    async function executeNext(q) { return exclusive(() => sendOne(q)); }
    async function recoverPending(hash) {
      return exclusive(async () => {
        ensure(!busy, 'Wait for the current wallet action.'); busy = true;
        try {
          await identity(); ensure(/^0x[0-9a-f]{64}$/i.test(hash), 'Enter the transaction hash from your wallet.');
          const pending = record(); ensure(pending, 'No liquidity transaction is waiting to be recovered.');
          const tx = await read(provider => provider.getTransaction(hash));
          ensure(tx && lower(tx.from) === lower(pending.account) && lower(tx.to) === lower(pending.to) && lower(tx.data) === lower(pending.data)
            && BigInt(tx.value) === BigInt(pending.value), 'This hash does not match the pending liquidity action.');
          const recovered = { ...pending, hash }; replaceRecord(pending.account, pending, recovered); return await settle(recovered);
        } finally { busy = false; }
      });
    }
    if (ethereum?.on) {
      ethereum.on('accountsChanged', () => { account = null; signer = null; notify({ phase: 'disconnected' }); });
      ethereum.on('chainChanged', () => { account = null; signer = null; notify({ phase: 'disconnected' }); });
    }
    return Object.freeze({ status, connect, quote, nextAction, executeNext, recoverPending,
      get account() { return account; }, get busy() { return busy; } });
  }
  root.GH0STLiquidityUIEngine = Object.freeze({ POSITION_MANAGER, POSITION_HASH, SOURCE_POOL, createClient });
})(typeof globalThis === 'undefined' ? this : globalThis);
