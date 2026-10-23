// User-click-only liquidity signing. No keys, automatic wallet connection, or public RPC writes.
(function (root) {
  'use strict';
  const PINS = Object.freeze({
    sourcePool: '0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01',
    targetPool: '0x90fbab7e58f154bff561fb7ee00f2aaa59ba66b77b0c4e1535f1b1c26a00f7d7',
    positionManagerHash: '0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2',
    permit2Hash: '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca',
    tokenHash: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
    ethUsdUrl: 'https://api.coinbase.com/v2/prices/ETH-USD/spot',
    quoteMaxAgeMs: 300000,
  });
  const lower = x => String(x).toLowerCase();
  const check = (ok, message) => { if (!ok) throw Error(message); };
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function createController({ ethersLib: ethers, planner, getContext, storage, fetchFn, now = Date.now, onChange = () => {}, withLock }) {
    const C = planner.CONSTANTS;
    const token = new ethers.Interface(planner.ERC20_ABI);
    const permits = new ethers.Interface(planner.PERMIT2_ABI);
    const positions = new ethers.Interface(planner.POSITION_MANAGER_ABI);
    const pools = new ethers.Interface(['function extsload(bytes32 slot) view returns (bytes32)']);
    const key = `gh0st-liquidity:${C.chainId}:${PINS.targetPool}:${lower(C.wallet)}`;
    let quote = null, busy = false;
    function readRecord() {
      const record = JSON.parse(storage.getItem(key) || '{"transactions":[]}');
      check(Array.isArray(record.transactions), 'Saved liquidity records are invalid. Inspect them before continuing.');
      return record;
    }
    function save(record) { storage.setItem(key, JSON.stringify(record)); }
    async function exclusive(work) {
      if (withLock) return withLock(key, work);
      check(root.navigator?.locks?.request, 'Safe signing needs browser Web Locks. Open this HTTPS page in a current Chrome, Edge, Firefox, or Safari browser. Quotes still work here.');
      return root.navigator.locks.request(key, { mode: 'exclusive', ifAvailable: true }, lock => {
        check(lock, 'Another tab is processing this liquidity wallet. Wait for it to finish and check the receipt before retrying.');
        return work();
      });
    }
    function state() { return { quote, busy, record: readRecord() }; }
    function invalidate() { quote = null; onChange(state()); }
    async function run(fn) {
      check(!busy && !getContext().busy, 'Wait for the current wallet action.');
      busy = true; onChange(state());
      try { return await fn(); } finally { busy = false; onChange(state()); }
    }
    async function call(provider, to, iface, method, args, blockTag) {
      const data = await provider.call({ to, data: iface.encodeFunctionData(method, args), blockTag });
      return iface.decodeFunctionResult(method, data);
    }
    async function identity() {
      const ctx = getContext();
      check(ctx.plan && ctx.provider && ctx.signer, 'Load the reviewed plan and connect the confirmed wallet first.');
      check(ctx.allDeployed, 'Complete and verify all 59 deployments first.');
      check(BigInt(await ctx.provider.send('eth_chainId', [])) === BigInt(C.chainId), 'Switch the wallet to Robinhood Chain mainnet (4663).');
      const accounts = await ctx.provider.send('eth_accounts', []);
      check(accounts.length && lower(accounts[0]) === lower(C.wallet) && lower(await ctx.signer.getAddress()) === lower(C.wallet), 'Select the confirmed liquidity wallet.');
      check(ctx.plan.transactions.length === 59 && lower(ctx.plan.hook_address) === lower(C.hook), 'The reviewed deployment plan is required.');
      return ctx;
    }
    async function snapshot() {
      const ctx = await identity(), { provider, plan } = ctx;
      const block = await provider.getBlock('latest');
      check(block && Number.isSafeInteger(block.number) && Number.isSafeInteger(block.timestamp), 'Unable to read a fresh chain block.');
      check(Math.abs(now() - block.timestamp * 1000) <= PINS.quoteMaxAgeMs, 'The chain block is stale. Try a fresh quote.');
      const blockTag = block.number;
      const codePins = [...plan.transactions.map(row => [row.predicted_address, row.runtime_code_hash]),
        [C.poolManager, plan.dependencies.pool_manager_code_hash],
        [C.positionManager, PINS.positionManagerHash], [C.permit2, PINS.permit2Hash], [C.currency1, PINS.tokenHash]];
      await Promise.all(codePins.map(async ([address, hash]) => {
        const code = await provider.getCode(address, blockTag);
        check(code !== '0x' && lower(ethers.keccak256(code)) === lower(hash), `Contract verification failed at ${address}. Complete the reviewed deployment before adding liquidity.`);
      }));
      const slot = pool => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [pool, 6]));
      const [source, target, decimals, allowance, permitAllowance, balance, nativeBalance, pm, p2] = await Promise.all([
        call(provider, C.poolManager, pools, 'extsload', [slot(PINS.sourcePool)], blockTag),
        call(provider, C.poolManager, pools, 'extsload', [slot(PINS.targetPool)], blockTag),
        call(provider, C.currency1, token, 'decimals', [], blockTag),
        call(provider, C.currency1, token, 'allowance', [C.wallet, C.permit2], blockTag),
        call(provider, C.permit2, permits, 'allowance', [C.wallet, C.currency1, C.positionManager], blockTag),
        call(provider, C.currency1, token, 'balanceOf', [C.wallet], blockTag),
        provider.getBalance(C.wallet, blockTag),
        call(provider, C.positionManager, positions, 'poolManager', [], blockTag),
        call(provider, C.positionManager, positions, 'permit2', [], blockTag),
      ]);
      check(Number(decimals[0]) === 18, 'GH0ST token decimals changed. Stop and inspect.');
      check(lower(pm[0]) === lower(C.poolManager) && lower(p2[0]) === lower(C.permit2), 'Position manager dependencies do not match.');
      const sourceSqrt = BigInt(source[0]) & ((1n << 160n) - 1n);
      check(sourceSqrt > 0n, 'The source price pool is not initialized.');
      return { ...ctx, block, sourceSqrt, targetRaw: target[0], targetSqrt: BigInt(target[0]) & ((1n << 160n) - 1n),
        allowance: allowance[0], permitAllowance, tokenBalance: balance[0], nativeBalance };
    }
    async function verifyNft(ctx, receipt, savedPlan) {
      const transfers = (receipt.logs || []).filter(log => lower(log.address) === lower(C.positionManager)).map(log => {
        try { return positions.parseLog(log); } catch (_) { return null; }
      }).filter(event => event?.name === 'Transfer' && lower(event.args.from) === lower(C.currency0) && lower(event.args.to) === lower(C.wallet));
      check(transfers.length === 1, 'Receipt does not contain exactly one position NFT for the confirmed wallet. Stop and inspect.');
      const id = transfers[0].args.tokenId;
      const [owner, details, liquidity] = await Promise.all([
        call(ctx.provider, C.positionManager, positions, 'ownerOf', [id], 'latest'),
        call(ctx.provider, C.positionManager, positions, 'getPoolAndPositionInfo', [id], 'latest'),
        call(ctx.provider, C.positionManager, positions, 'getPositionLiquidity', [id], 'latest'),
      ]);
      const pool = details[0], expected = savedPlan.pool_key;
      check(lower(owner[0]) === lower(C.wallet), 'The position NFT owner is not the confirmed wallet.');
      check(lower(pool.currency0) === lower(expected.currency0) && lower(pool.currency1) === lower(expected.currency1)
        && Number(pool.fee) === Number(expected.fee) && Number(pool.tickSpacing) === Number(expected.tickSpacing)
        && lower(pool.hooks) === lower(expected.hooks), 'The position NFT belongs to a different pool.');
      const signed24 = n => Number(n >= 0x800000n ? n - 0x1000000n : n);
      const info = BigInt(details[1]);
      check(signed24((info >> 8n) & 0xffffffn) === C.tickLower && signed24((info >> 32n) & 0xffffffn) === C.tickUpper,
        'The position NFT has an unexpected price range.');
      check(BigInt(liquidity[0]) === BigInt(savedPlan.liquidity.units), 'The position NFT has unexpected liquidity.');
      return id.toString();
    }
    async function settle(ctx, row, record, suppliedReceipt) {
      check(row.hash, 'The last wallet submission has an unknown result. Inspect the wallet activity before retrying; this page will not risk a duplicate mint.');
      const receipt = suppliedReceipt || await ctx.provider.getTransactionReceipt(row.hash);
      check(receipt, `Transaction ${row.hash} is still pending. Check its receipt before continuing.`);
      if (Number(receipt.status) === 0) { row.status = 'failed'; save(record); throw Error(`Transaction ${row.hash} failed. Get a fresh quote before retrying.`); }
      const tx = await ctx.provider.getTransaction(row.hash);
      check(tx && lower(tx.from) === lower(C.wallet) && lower(tx.to) === lower(row.request.to)
        && lower(tx.data) === lower(row.request.data) && BigInt(tx.value) === BigInt(row.request.value)
        && BigInt(tx.chainId) === BigInt(C.chainId), 'Receipt transaction does not match the reviewed request. Stop and inspect.');
      if (row.isMint) {
        const tokenId = await verifyNft(ctx, receipt, row.plan);
        record.mint = { hash: row.hash, tokenId, verified: true };
      }
      row.status = 'confirmed'; save(record); return receipt;
    }
    async function reconcile(ctx) {
      const record = readRecord();
      for (const row of record.transactions.filter(item => item.status === 'pending' || item.status === 'submitting')) await settle(ctx, row, record);
      return record;
    }
    function fresh(snap) {
      check(quote, 'Get and review a fresh quote first.');
      check(now() - quote.quotedAt <= PINS.quoteMaxAgeMs && snap.block.timestamp - quote.block.timestamp <= 300
        && snap.block.timestamp < Number(quote.plan.deadline), 'This quote has expired. Get and review a fresh quote.');
      const old = BigInt(quote.plan.quote_sqrt_price_x96), current = snap.sourceSqrt;
      const delta = current * current >= old * old ? current * current - old * old : old * old - current * current;
      check(delta * 10000n <= old * old * 50n, 'The source price moved more than 0.5%. Get and review a fresh quote.');
      check(lower(snap.targetRaw) === lower(quote.targetRaw), 'The new pool state changed. Get and review a fresh quote.');
    }
    function nextAction(snap) {
      const plan = quote.plan, cap = BigInt(plan.liquidity.amount1_max);
      for (const action of plan.approvals) {
        if (action.kind === 'reset_token_allowance' && snap.allowance !== 0n && snap.allowance !== cap) return action;
        if (action.kind === 'approve_token_exact_cap' && snap.allowance !== cap) return action;
        if (action.kind === 'approve_position_manager_exact_cap' && (snap.permitAllowance[0] !== cap || snap.permitAllowance[1] !== BigInt(plan.allowance_expiration))) return action;
      }
      check(snap.allowance === cap, 'The GH0ST allowance changed. Get and review a fresh quote.');
      return plan.unsigned_mint_transaction;
    }
    async function getQuote() { return run(async () => {
      quote = null;
      const snap = await snapshot(), record = await reconcile(snap);
      check(!record.mint, `Liquidity was already added by ${record.mint?.hash}. A second position will not be minted.`);
      const response = await fetchFn(PINS.ethUsdUrl, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
      check(response.ok, 'Unable to fetch the ETH/USD quote. Try again.');
      const data = await response.json();
      check(data?.data?.base === 'ETH' && data?.data?.currency === 'USD', 'Unexpected ETH/USD quote response.');
      const built = planner.buildPlan({ wallet: C.wallet, quoteSqrtPriceX96: snap.sourceSqrt, ethUsd: data.data.amount,
        blockTimestamp: snap.block.timestamp, observedBlock: { number: snap.block.number, hash: snap.block.hash },
        initialized: snap.targetSqrt !== 0n, currentSqrtPriceX96: snap.targetSqrt || null,
        currentErc20Allowance: snap.allowance }, ethers);
      check(lower(built.pool_id) === PINS.targetPool, 'The liquidity plan identifies a different pool.');
      check(snap.tokenBalance >= BigInt(built.liquidity.amount1_max), 'Insufficient GH0ST for the displayed maximum.');
      check(snap.nativeBalance >= BigInt(built.liquidity.amount0_max), 'Insufficient native ETH for the displayed maximum plus gas.');
      quote = freeze({ plan: built, block: { number: snap.block.number, timestamp: snap.block.timestamp }, targetRaw: snap.targetRaw,
        quotedAt: now(), nextKind: nextKindFromPlan(built) });
      return quote;
    }); }
    const nextKindFromPlan = plan => plan.approvals[0]?.kind || plan.unsigned_mint_transaction.kind;
    async function signNext() { return exclusive(() => run(async () => {
      const snap = await snapshot();
      let record = await reconcile(snap);
      check(!record.mint, 'Liquidity was already added. A second position will not be minted.');
      fresh(snap);
      const action = nextAction(snap), isMint = action === quote.plan.unsigned_mint_transaction;
      const request = { from: C.wallet, to: action.to, data: action.data, value: BigInt(action.value), chainId: BigInt(C.chainId) };
      check(snap.tokenBalance >= BigInt(quote.plan.liquidity.amount1_max), 'Insufficient GH0ST for this quote.');
      const estimate = await snap.signer.estimateGas(request), gasLimit = (estimate * 150n + 99n) / 100n;
      const fees = await snap.provider.getFeeData(), gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
      check(gasPrice != null, 'Unable to estimate the current gas cost.');
      check(snap.nativeBalance >= BigInt(quote.plan.liquidity.amount0_max) + gasLimit * gasPrice, 'Insufficient native ETH for the maximum deposit and current gas estimate.');
      // Recheck identity after the read/estimate work and before opening the wallet confirmation.
      await identity();
      // A second read under the origin-wide lock also catches receipts completed by another tab before this action began.
      record = await reconcile(snap);
      check(!record.mint, 'Liquidity was already added. A second position will not be minted.');
      const row = { status: 'submitting', kind: action.kind, isMint, request: { ...action }, plan: isMint ? quote.plan : undefined };
      record.transactions.push(row); save(record);
      let tx;
      try { tx = await snap.signer.sendTransaction({ ...request, gasLimit }); }
      catch (error) {
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') { row.status = 'rejected'; save(record); }
        throw error;
      }
      row.hash = tx.hash; row.status = 'pending'; save(record); onChange(state());
      const receipt = await tx.wait();
      await settle(snap, row, record, receipt);
      if (isMint) quote = null;
      return { hash: tx.hash, kind: action.kind, minted: record.mint || null };
    })); }
    async function checkReceipts() { return run(async () => { const ctx = await snapshot(); return reconcile(ctx); }); }
    return Object.freeze({ state, invalidate, getQuote, signNext, checkReceipts });
  }
  root.GH0STLiquidityWallet = Object.freeze({ PINS, createController });
  if (!root.document || !root.GH0STDeployment || !root.GH0STLiquidity) return;
  const element = id => root.document.getElementById(id);
  if (!element('liquidity-quote')) return;
  const labels = { reset_token_allowance: 'Reset the old GH0ST approval', approve_token_exact_cap: 'Approve the displayed GH0ST maximum',
    approve_position_manager_exact_cap: 'Approve the 15-minute liquidity permission', initialize_and_mint_liquidity: 'Initialize pool and add liquidity', mint_liquidity: 'Add liquidity' };
  let app;
  function render() {
    if (!app) return;
    const { quote, busy, record } = app.state(), ctx = root.GH0STDeployment.getContext();
    const ready = ctx.allDeployed && !!ctx.signer && !ctx.busy && !busy;
    element('liquidity-quote').disabled = !ready || !!record.mint;
    element('liquidity-sign').disabled = !ready || !quote || !!record.mint;
    element('liquidity-receipt').disabled = !ready;
    element('liquidity-sign').textContent = quote ? 'Sign next reviewed step' : 'Review quote first';
    if (record.mint) element('liquidity-review').textContent = `Liquidity verified. Position NFT #${record.mint.tokenId}\nTransaction: ${record.mint.hash}\nPool: ${PINS.targetPool}`;
    else if (quote) {
      const p = quote.plan;
      element('liquidity-review').textContent = `Maximum deposit: ${root.ethers.formatEther(p.liquidity.amount0_max)} native ETH ($100)\nMaximum deposit: ${root.ethers.formatUnits(p.liquidity.amount1_max, 18)} GH0ST ($100)\nExpected use at quoted price: ${root.ethers.formatEther(p.liquidity.expected_amount0)} ETH + ${root.ethers.formatUnits(p.liquidity.expected_amount1, 18)} GH0ST\nExpected unused: ${root.ethers.formatEther(p.liquidity.expected_unused_amount0)} ETH returned + ${root.ethers.formatUnits(p.liquidity.expected_unused_amount1, 18)} GH0ST retained\nGas is additional, with 50% gas-limit headroom.\nETH/USD: $${p.prices.eth_usd.decimal}\nGH0ST/USD: $${p.prices.ghost_usd.decimal}\nFull range: ticks ${p.liquidity.tick_lower} to ${p.liquidity.tick_upper}; fee 0.3%\nPrice movement limit: 0.5%; quote valid for five minutes\nPermission expiry: ${new Date(Number(p.deadline) * 1000).toLocaleString()}\nPosition owner: ${p.wallet}\nNew pool: ${p.pool_id}\nSource price only: ${PINS.sourcePool}\nSteps: ${p.approvals.map(a => labels[a.kind]).concat(labels[p.unsigned_mint_transaction.kind]).join(' → ')}`;
    } else element('liquidity-review').textContent = ready ? 'Get a fresh quote to review the maximum amounts before signing.' : 'Complete and verify all 59 deployments first.';
  }
  app = createController({ ethersLib: root.ethers, planner: root.GH0STLiquidity, getContext: root.GH0STDeployment.getContext,
    storage: root.localStorage, fetchFn: root.fetch.bind(root), onChange: render });
  const click = (id, action) => element(id).addEventListener('click', async () => {
    element('liquidity-error').textContent = '';
    try { const result = await action(); if (result?.hash) element('log').textContent += `${new Date().toISOString()}  Liquidity step ${result.kind}: ${result.hash}\n`; }
    catch (error) { element('liquidity-error').textContent = error.shortMessage || error.message; }
    render();
  });
  click('liquidity-quote', app.getQuote); click('liquidity-sign', app.signNext); click('liquidity-receipt', app.checkReceipts);
  root.GH0STDeployment.subscribe(render);
  root.window?.ethereum?.on?.('accountsChanged', app.invalidate);
  root.window?.ethereum?.on?.('chainChanged', app.invalidate);
  render();
})(typeof globalThis !== 'undefined' ? globalThis : this);
