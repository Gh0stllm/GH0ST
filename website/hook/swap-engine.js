/* GH0ST / H00K: wallet-only single-pool v4 swaps. No keys and no automatic transactions.
 * Protocol references: https://developers.uniswap.org/docs/protocols/v4/deployments
 * https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Router.sol
 * https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Commands.sol
 */
(function (root) {
  'use strict';
  const C = Object.freeze({
    chainId: 4663, chainHex: '0x1237', name: 'Robinhood Chain',
    rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com',
    token: '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559',
    native: '0x0000000000000000000000000000000000000000',
    poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
    quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    router: '0x204FAca1764B154221e35c0d20aBb3c525710498',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    hook: '0x25E6366C490225358625d941C7B147360b155040',
    model: '0xb45b782c3a8057b32B44D4c4415B2686A7AB4fD5',
    modelHash: '0x03047f3adb84443ebbd6f1ba45d948fe4872f51ce0f6326e3f35a434c5b02f62',
    poolId: '0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7',
    fee: 3000, tickSpacing: 60, hookData: '0x53504b31', decimals: 18,
    quoteSeconds: 120, deadlineSeconds: 900, maximumSlippageBps: 500,
  });
  const PINS = Object.freeze({
    [C.poolManager]: '0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626',
    [C.permit2]: '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca',
    [C.token]: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
    [C.hook]: '0x63a9eb26487da6deedde8561779d46cbd35218155159a7225087f523a6bf723f',
    [C.model]: '0x36b6be48df51752b8245c8809a407a30dfeeb9ac33be7ec2347aa02a74cac4a9',
    [C.router]: '0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296',
    [C.quoter]: '0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6',
    [C.stateView]: '0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6',
  });
  const KEY_TYPE = 'tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
  const KEY = Object.freeze({ currency0: C.native, currency1: C.token, fee: C.fee, tickSpacing: C.tickSpacing, hooks: C.hook });
  const ABI = Object.freeze({
    token: ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)',
      'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'],
    permit2: ['function approve(address token,address spender,uint160 amount,uint48 expiration)',
      'function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)'],
    state: ['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
      'function getLiquidity(bytes32 poolId) view returns (uint128)', 'function poolManager() view returns (address)'],
    hook: ['function poolManager() view returns (address)', 'function model() view returns (address)', 'function modelHash() view returns (bytes32)',
      'event SentenceSpoken(bytes32 indexed poolId,uint64 indexed sequence,bytes32 indexed modelHash,string text,uint8 words,bool endedNaturally,bytes32 inputHash,bytes32 stateHash)',
      'event SentenceSkipped(bytes32 indexed poolId,uint64 indexed sequence,uint8 reason,bytes32 inputHash)'],
    model: ['function modelHash() view returns (bytes32)'],
    quoter: [`function quoteExactInputSingle(tuple(${KEY_TYPE} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
      'function poolManager() view returns (address)'],
    router: ['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable',
      'function poolManager() view returns (address)'],
  });
  const lower = value => String(value).toLowerCase();
  const ensure = (ok, message) => { if (!ok) throw new Error(message); };
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  function uint(value, name) { let n; try { n = BigInt(value); } catch (_) { throw Error(`${name} must be an integer`); } ensure(n >= 0n, `${name} cannot be negative`); return n; }
  function parseAmount(value, ethers) {
    ensure(typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value), 'Enter an amount with at most 18 decimal places.');
    const n = ethers.parseUnits(value, C.decimals);
    ensure(n > 0n && n <= (1n << 128n) - 1n, 'Enter a positive amount within the swap limit.'); return n;
  }
  function minimumOutput(quotedAmount, slippageBps) {
    ensure(Number.isInteger(slippageBps) && slippageBps >= 1 && slippageBps <= C.maximumSlippageBps, 'Slippage must be between 0.01% and 5%.');
    const min = uint(quotedAmount, 'Output') * BigInt(10000 - slippageBps) / 10000n;
    ensure(min > 0n, 'The quoted output is too small.'); return min;
  }
  function buildSwap({ account, zeroForOne, amountIn, amountOutMinimum, deadline }, ethers) {
    ensure(typeof zeroForOne === 'boolean', 'Choose a swap direction.');
    account = ethers.getAddress(account); amountIn = uint(amountIn, 'Input'); amountOutMinimum = uint(amountOutMinimum, 'Minimum output');
    ensure(amountIn > 0n && amountIn <= (1n << 128n) - 1n && amountOutMinimum > 0n && amountOutMinimum <= (1n << 128n) - 1n, 'Swap amounts exceed the router limits.');
    const coder = ethers.AbiCoder.defaultAbiCoder();
    // Universal Router 2.1.2 uses minHopPriceX36. The absolute output bound protects this single hop.
    const swap = coder.encode([`tuple(${KEY_TYPE} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)`],
      [[KEY, zeroForOne, amountIn, amountOutMinimum, 0n, C.hookData]]);
    const input = zeroForOne ? C.native : C.token, output = zeroForOne ? C.token : C.native;
    const v4 = coder.encode(['bytes', 'bytes[]'], ['0x060c0f', [swap,
      coder.encode(['address', 'uint256'], [input, amountIn]), coder.encode(['address', 'uint256'], [output, amountOutMinimum])]]);
    // Final sweep returns any unspent native input to this wallet, without wrapping ETH.
    const sweep = coder.encode(['address', 'address', 'uint256'], [C.native, account, 0n]);
    return freeze({ chainId: C.chainId, from: account, to: C.router,
      data: new ethers.Interface(ABI.router).encodeFunctionData('execute', ['0x1004', [v4, sweep], uint(deadline, 'Deadline')]),
      value: zeroForOne ? amountIn : 0n });
  }
  function decodeMessage(log, ethers) {
    if (!log || log.removed || lower(log.address) !== lower(C.hook)) return null;
    let parsed; try { parsed = new ethers.Interface(ABI.hook).parseLog(log); } catch (_) { return null; }
    if (parsed?.name !== 'SentenceSpoken' || lower(parsed.args.poolId) !== C.poolId || lower(parsed.args.modelHash) !== C.modelHash) return null;
    const a = parsed.args;
    return freeze({ text: a.text, words: Number(a.words), endedNaturally: a.endedNaturally,
      sequence: a.sequence.toString(), modelHash: a.modelHash, inputHash: a.inputHash, stateHash: a.stateHash,
      transactionHash: log.transactionHash || null, blockNumber: log.blockNumber ?? null, logIndex: log.index ?? log.logIndex ?? 0 });
  }
  function createClient(options = {}) {
    const ethers = options.ethers || root.ethers;
    ensure(ethers?.Interface && ethers?.BrowserProvider, 'The bundled ethers library must load first.');
    const ethereum = options.ethereum || root.ethereum;
    const readProvider = options.readProvider || new ethers.JsonRpcProvider(C.rpc, C.chainId, { staticNetwork: true, batchMaxCount: 1 });
    const store = options.storage || root.localStorage;
    const now = options.now || Date.now, notify = options.onStatus || (() => {});
    const interfaces = Object.fromEntries(Object.entries(ABI).map(([key, abi]) => [key, new ethers.Interface(abi)]));
    let walletProvider = options.walletProvider || null, signer = options.signer || null, account = null, busy = false;
    const issued = new WeakSet(), consumed = new Set(); let latest = null, quoteCounter = 0;
    const recordKey = who => `gh0st:h00k:pending:${C.chainId}:${lower(who)}`;
    const pending = who => { const raw = store?.getItem(recordKey(who)); try { return raw ? JSON.parse(raw) : null; } catch (_) { throw Error('The saved transaction record needs review before another swap.'); } };
    const save = (who, record) => { if (record) store?.setItem(recordKey(who), JSON.stringify(record)); else store?.removeItem(recordKey(who)); };
    const recordIdentity = record => record ? JSON.stringify([record.kind, record.account, record.quoteId, record.to,
      record.data, record.value, record.hash, record.submittedAt]) : null;
    function replaceRecord(who, previous, next) {
      ensure(recordIdentity(pending(who)) === recordIdentity(previous), 'The pending transaction changed in another tab. Refresh before continuing.');
      save(who, next);
    }
    async function read(work) {
      try { return await work(readProvider); } catch (error) {
        if (!walletProvider) throw error;
        return work(walletProvider);
      }
    }
    async function call(provider, target, name, method, args = [], blockTag, extra = {}) {
      const data = await provider.call({ to: target, data: interfaces[name].encodeFunctionData(method, args), blockTag, ...extra });
      return interfaces[name].decodeFunctionResult(method, data);
    }
    async function snapshot(who = account) {
      return read(async provider => {
        ensure(BigInt(await provider.send('eth_chainId', [])) === BigInt(C.chainId), 'The read provider is on the wrong chain.');
        const block = await provider.getBlock('latest');
        ensure(block && Math.abs(now() / 1000 - block.timestamp) <= C.quoteSeconds, 'The RPC is returning an old block. Try again.');
        const b = block.number;
        await Promise.all(Object.entries(PINS).map(async ([address, hash]) => {
          const code = await provider.getCode(address, b);
          ensure(code !== '0x' && lower(ethers.keccak256(code)) === lower(hash), `Contract verification failed: ${address}`);
        }));
        // A missing pin is a release error and must not silently permit unverified contract calls.
        for (const address of [C.quoter, C.router, C.stateView]) ensure(PINS[address], 'Swap contract verification is not configured.');
        const [slot, liq, decimals, hookManager, model, hash, modelHash, quoteManager, routerManager, stateManager] = await Promise.all([
          call(provider, C.stateView, 'state', 'getSlot0', [C.poolId], b), call(provider, C.stateView, 'state', 'getLiquidity', [C.poolId], b),
          call(provider, C.token, 'token', 'decimals', [], b), call(provider, C.hook, 'hook', 'poolManager', [], b),
          call(provider, C.hook, 'hook', 'model', [], b), call(provider, C.hook, 'hook', 'modelHash', [], b),
          call(provider, C.model, 'model', 'modelHash', [], b), call(provider, C.quoter, 'quoter', 'poolManager', [], b),
          call(provider, C.router, 'router', 'poolManager', [], b),
          call(provider, C.stateView, 'state', 'poolManager', [], b),
        ]);
        ensure(Number(decimals[0]) === C.decimals, 'GH0ST decimals differ from the reviewed token.');
        ensure([hookManager, quoteManager, routerManager, stateManager].every(x => lower(x[0]) === C.poolManager), 'A contract points to another pool manager.');
        ensure(lower(model[0]) === lower(C.model) && lower(hash[0]) === C.modelHash && lower(modelHash[0]) === C.modelHash, 'The speech model does not match this release.');
        let balances = null;
        if (who) {
          const [native, token, allowance, permit] = await Promise.all([provider.getBalance(who, b),
            call(provider, C.token, 'token', 'balanceOf', [who], b), call(provider, C.token, 'token', 'allowance', [who, C.permit2], b),
            call(provider, C.permit2, 'permit2', 'allowance', [who, C.token, C.router], b)]);
          balances = { eth: native, ghost: token[0], allowance: allowance[0], permitAmount: permit[0], permitExpiration: permit[1] };
        }
        return { provider, block, sqrtPriceX96: slot[0], tick: Number(slot[1]), liquidity: liq[0], lpFee: Number(slot[3]),
          initialized: slot[0] > 0n, ready: slot[0] > 0n && liq[0] > 0n, balances };
      });
    }
    async function status() {
      const s = await snapshot();
      latest = freeze({ chainId: C.chainId, poolId: C.poolId, account, blockNumber: s.block.number, initialized: s.initialized, ready: s.ready,
        liquidity: s.liquidity.toString(), sqrtPriceX96: s.sqrtPriceX96.toString(), fee: s.lpFee,
        balances: s.balances ? { eth: ethers.formatUnits(s.balances.eth, 18), ghost: ethers.formatUnits(s.balances.ghost, 18) } : null,
        message: s.ready ? 'Pool ready. Every swap requests a sentence.' : s.initialized ? 'Waiting for liquidity.' : 'Pool setup is awaiting initialization and liquidity.' });
      notify(latest); return latest;
    }
    async function connect() {
      ensure(ethereum?.request || walletProvider, 'Open this page in a wallet browser, or install an Ethereum wallet.');
      if (!walletProvider) walletProvider = new ethers.BrowserProvider(ethereum, 'any');
      if (ethereum) {
        await ethereum.request({ method: 'eth_requestAccounts' });
        const chain = BigInt(await ethereum.request({ method: 'eth_chainId' }));
        if (chain !== BigInt(C.chainId)) {
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
    async function identity() {
      ensure(walletProvider && signer && account, 'Connect your wallet first.');
      ensure(BigInt(await walletProvider.send('eth_chainId', [])) === BigInt(C.chainId), 'Switch your wallet to Robinhood Chain.');
      const accounts = await walletProvider.send('eth_accounts', []);
      ensure(accounts.length && lower(accounts[0]) === lower(account) && lower(await signer.getAddress()) === lower(account), 'Your wallet account changed. Reconnect and request a new quote.');
    }
    async function quote({ amount, direction = 'ETH_TO_GH0ST', slippageBps = 50 }) {
      ensure(direction === 'ETH_TO_GH0ST' || direction === 'GH0ST_TO_ETH', 'Choose ETH or GH0ST as the input.');
      const amountIn = parseAmount(amount, ethers), zeroForOne = direction === 'ETH_TO_GH0ST';
      minimumOutput(100000n, slippageBps);
      const s = await snapshot(); ensure(s.ready, 'This GH0ST hook pool needs liquidity before swaps can start.');
      const [amountOut, gas] = await call(s.provider, C.quoter, 'quoter', 'quoteExactInputSingle', [[KEY, zeroForOne, amountIn, C.hookData]], s.block.number, { gasLimit: 30000000n });
      const min = minimumOutput(amountOut, slippageBps), square = s.sqrtPriceX96 * s.sqrtPriceX96, q192 = 1n << 192n;
      const spot = zeroForOne ? amountIn * square / q192 : amountIn * q192 / square;
      const impact = spot > amountOut && spot > 0n ? Number((spot - amountOut) * 10000n / spot) : 0;
      const q = freeze({ id: `${now()}:${++quoteCounter}`, account, direction, zeroForOne, amountIn: amountIn.toString(), amountOut: amountOut.toString(), minimumOutput: min.toString(),
        amountInFormatted: ethers.formatUnits(amountIn, 18), amountOutFormatted: ethers.formatUnits(amountOut, 18),
        minimumOutputFormatted: ethers.formatUnits(min, 18), inputSymbol: zeroForOne ? 'ETH' : 'GH0ST', outputSymbol: zeroForOne ? 'GH0ST' : 'ETH',
        slippageBps, priceImpactBps: impact, gasEstimate: gas.toString(), blockNumber: s.block.number, createdAt: now(),
        deadline: s.block.timestamp + C.deadlineSeconds, poolId: C.poolId, hookData: C.hookData });
      issued.add(q); return q;
    }
    async function checkedQuote(q) {
      ensure(q && issued.has(q) && !consumed.has(q.id), 'Request a fresh quote from this page.'); await identity();
      ensure(q.account && lower(q.account) === lower(account), 'Reconnect and request a new quote for this wallet.');
      ensure(now() - q.createdAt <= C.quoteSeconds * 1000, 'This quote expired. Refresh it before signing.');
      const s = await snapshot(account); ensure(s.ready, 'The hook pool has no active liquidity.');
      ensure(s.block.timestamp < q.deadline, 'The swap deadline expired. Refresh your quote.'); return s;
    }
    async function nextAction(q) {
      await identity();
      const record = pending(account);
      if (record) return freeze({ kind: 'pending', label: record.hash ? 'Check pending transaction' : 'Submission needs review', hash: record.hash || null });
      const s = await checkedQuote(q), amount = BigInt(q.amountIn);
      ensure((q.zeroForOne ? s.balances.eth : s.balances.ghost) >= amount, `Insufficient ${q.inputSymbol} balance.`);
      if (!q.zeroForOne && s.balances.allowance !== amount) {
        const reset = s.balances.allowance > 0n;
        return freeze({ kind: reset ? 'reset_approval' : 'approve_token', label: reset ? 'Reset GH0ST allowance' : 'Approve GH0ST amount',
          transaction: { chainId: C.chainId, from: account, to: C.token, value: 0n,
            data: interfaces.token.encodeFunctionData('approve', [C.permit2, reset ? 0n : amount]) } });
      }
      if (!q.zeroForOne && (s.balances.permitAmount !== amount || s.balances.permitExpiration < BigInt(q.deadline))) {
        return freeze({ kind: 'approve_permit2', label: 'Approve this swap', transaction: { chainId: C.chainId, from: account, to: C.permit2, value: 0n,
          data: interfaces.permit2.encodeFunctionData('approve', [C.token, C.router, amount, q.deadline]) } });
      }
      return freeze({ kind: 'swap', label: `Swap ${q.inputSymbol} for ${q.outputSymbol}`, transaction: buildSwap({ account, zeroForOne: q.zeroForOne,
        amountIn: amount, amountOutMinimum: q.minimumOutput, deadline: q.deadline }, ethers) });
    }
    async function settle(record) {
      ensure(record?.hash, 'Submission status is unknown. Check your wallet activity before doing anything else.');
      const owner = record.account || account;
      const receipt = await read(provider => provider.getTransactionReceipt(record.hash));
      if (!receipt) return { pending: true, hash: record.hash };
      if (Number(receipt.status) !== 1) { replaceRecord(owner, record, null); throw Error('The transaction reverted. No swap was completed.'); }
      const transaction = await read(provider => provider.getTransaction(record.hash));
      ensure(transaction && lower(transaction.from) === lower(owner) && lower(transaction.to) === lower(record.to)
        && lower(transaction.data) === lower(record.data) && BigInt(transaction.value) === BigInt(record.value),
      'The confirmed transaction differs from the reviewed action. Inspect it before continuing.');
      const messages = (receipt.logs || []).map(log => decodeMessage(log, ethers)).filter(Boolean);
      ensure(record.kind !== 'swap' || messages.length > 0, 'The receipt is confirmed but its speech event could not be verified. Inspect the transaction before another swap.');
      if (record.kind === 'swap') consumed.add(record.quoteId);
      replaceRecord(owner, record, null);
      return { pending: false, kind: record.kind, hash: record.hash, receipt, messages, message: messages.at(-1) || null };
    }
    async function sendOne(q) {
      ensure(!busy, 'Wait for the current wallet action.'); busy = true;
      try {
        const action = await nextAction(q);
        if (action.kind === 'pending') return settle(pending(account));
        const estimate = await signer.estimateGas(action.transaction);
        const gasLimit = (estimate * 150n + 99n) / 100n;
        const fees = await walletProvider.getFeeData();
        const fee = fees.maxFeePerGas || fees.gasPrice;
        ensure(fee !== null && fee !== undefined, 'The wallet could not estimate the network fee.');
        const balance = await walletProvider.getBalance(account);
        ensure(balance >= BigInt(action.transaction.value) + gasLimit * fee, 'Leave enough ETH in your wallet for the network fee.');
        await identity(); await checkedQuote(q);
        ensure(store?.setItem && store?.removeItem, 'Enable browser storage to safely track pending wallet transactions.');
        const owner = account;
        const expected = { kind: action.kind, account: owner, quoteId: q.id, to: action.transaction.to, data: action.transaction.data,
          value: action.transaction.value.toString(), hash: null, submittedAt: now() };
        replaceRecord(owner, null, expected);
        let sent;
        try { sent = await signer.sendTransaction({ ...action.transaction, gasLimit }); }
        catch (e) {
          if (e.code === 'ACTION_REJECTED' || Number(e.code) === 4001) replaceRecord(owner, expected, null);
          throw e;
        }
        let record = { ...expected, hash: sent.hash }; replaceRecord(owner, expected, record);
        notify({ phase: 'submitted', hash: sent.hash, kind: action.kind });
        try { await sent.wait(1); } catch (e) {
          if (e.code === 'TRANSACTION_REPLACED' && e.replacement?.hash) {
            const replacement = { ...record, hash: e.replacement.hash }; replaceRecord(owner, record, replacement); record = replacement;
          }
          else if (e.receipt) return settle(record);
          else return { pending: true, hash: sent.hash };
        }
        return settle(record);
      } finally { busy = false; }
    }
    async function exclusive(work) {
      const key = `gh0st:h00k:sign:${C.chainId}`;
      if (options.withLock) return options.withLock(key, work);
      ensure(root.navigator?.locks?.request, 'Open this page in a current browser with safe transaction locking.');
      return root.navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
        ensure(lock, 'Another tab is using the wallet. Wait for that action to finish.');
        return work();
      });
    }
    async function executeNext(q) { return exclusive(() => sendOne(q)); }
    async function messages({ fromBlock, toBlock, limit = 20 } = {}) {
      ensure(Number.isInteger(limit) && limit > 0 && limit <= 100, 'Invalid message limit.');
      return read(async provider => {
        const latestBlock = toBlock ?? await provider.getBlockNumber();
        const first = fromBlock ?? Math.max(0, latestBlock - 4999);
        ensure(Number.isInteger(first) && Number.isInteger(latestBlock) && first >= 0 && latestBlock >= first && latestBlock - first < 10000, 'Read at most 10,000 blocks at a time.');
        const topic = interfaces.hook.getEvent('SentenceSpoken').topicHash, found = [];
        for (let end = latestBlock; end >= first && found.length < limit; end -= 1000) {
          const logs = await provider.getLogs({ address: C.hook, topics: [topic, C.poolId, null, C.modelHash], fromBlock: Math.max(first, end - 999), toBlock: end });
          found.push(...logs.map(log => decodeMessage(log, ethers)).filter(Boolean));
        }
        return found.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex).slice(0, limit);
      });
    }
    async function receipt(hash) {
      ensure(/^0x[0-9a-f]{64}$/i.test(hash), 'Enter a valid transaction hash.');
      const r = await read(provider => provider.getTransactionReceipt(hash));
      return r ? { receipt: r, messages: (r.logs || []).map(log => decodeMessage(log, ethers)).filter(Boolean) } : null;
    }
    async function recoverPending(hash) {
      return exclusive(async () => {
        ensure(!busy, 'Wait for the current wallet action.'); busy = true;
        try {
          await identity();
          ensure(/^0x[0-9a-f]{64}$/i.test(hash), 'Enter the transaction hash shown in your wallet.');
          const owner = account, record = pending(owner);
          ensure(record, 'There is no pending action to recover.');
          const transaction = await read(provider => provider.getTransaction(hash));
          ensure(transaction && lower(transaction.from) === lower(owner) && lower(transaction.to) === lower(record.to)
            && lower(transaction.data) === lower(record.data) && BigInt(transaction.value) === BigInt(record.value),
          'This hash does not match the pending wallet action.');
          const recovered = { ...record, hash }; replaceRecord(owner, record, recovered); return await settle(recovered);
        } finally { busy = false; }
      });
    }
    if (ethereum?.on) {
      ethereum.on('accountsChanged', () => { account = null; signer = null; notify({ phase: 'disconnected' }); });
      ethereum.on('chainChanged', () => { account = null; signer = null; notify({ phase: 'disconnected' }); });
    }
    return Object.freeze({ status, connect, quote, nextAction, executeNext, messages, receipt, recoverPending,
      get account() { return account; }, get busy() { return busy; }, get latest() { return latest; } });
  }
  root.GH0STSwap = Object.freeze({ CONSTANTS: C, PINS, ABI, POOL_KEY: KEY, KEY_TYPE, parseAmount, minimumOutput, buildSwap, decodeMessage, createClient });
})(typeof globalThis === 'undefined' ? this : globalThis);
