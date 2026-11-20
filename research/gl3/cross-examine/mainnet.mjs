import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ethers = process.env.CROSS_ETHERS_PATH
  ? await import(pathToFileURL(resolve(process.env.CROSS_ETHERS_PATH)).href)
  : await import('ethers');
const { ContractFactory, Interface, Transaction, formatEther, getCreateAddress, hexlify, keccak256, id, toQuantity } = ethers;

const chainId = 4663001;
const genesis = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
const urls = ['https://rpc.gh0st.fyi/', 'https://gh0st.fyi/gl3/rpc'];
const owner = '0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
const nodeInterface = '0x00000000000000000000000000000000000000c8';
const bountyWei = 10n ** 18n;
const l1Abi = new Interface(['function gasEstimateL1Component(address to,bool contractCreation,bytes data) payable returns (uint64 gasEstimateForL1,uint256 baseFee,uint256 l1BaseFeeEstimate)']);
const [mode, artifactPath, evidenceOrPlan, extra] = process.argv.slice(2);
const actions = ['deploy', 'commit', 'reveal', 'pay', 'blocked-upgrade'];
const labels = ['Deploy and fund 1 GH0ST', 'Commit the challenge', 'Prove Approved → Rejected', 'Withdraw the 1 GH0ST reward', 'Record the blocked model upgrade'];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function requireThat(test, message) {
  if (!test) throw new Error(message);
}
async function rpc(i, method, params = []) {
  const result = await fetch(urls[i], {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }), signal: AbortSignal.timeout(14_000),
  });
  const body = await result.json();
  if (!result.ok || body.id !== 1 || body.jsonrpc !== '2.0' || body.error || !Object.hasOwn(body, 'result')) {
    const error = new Error(method + ' was rejected' + (body.error?.message ? ': ' + body.error.message : '.'));
    error.rpcData = body.error?.data;
    throw error;
  }
  return body.result;
}
async function chain() {
  const blocks = await Promise.all(urls.map(async (_, i) => {
    const [network, start, live] = await Promise.all([
      rpc(i, 'eth_chainId'), rpc(i, 'eth_getBlockByNumber', ['0x0', false]), rpc(i, 'eth_getBlockByNumber', ['latest', false]),
    ]);
    requireThat(BigInt(network) === BigInt(chainId) && same(start?.hash, genesis) && live?.hash, 'A GL3 RPC returned the wrong chain.');
    return live;
  }));
  const [first, second] = blocks.sort((a, b) => Number(BigInt(a.number) - BigInt(b.number)));
  if (first.number === second.number) {
    requireThat(same(first.hash, second.hash), 'The GL3 RPCs disagree at the same height.');
  } else {
    const anchored = await Promise.all(urls.map((_, i) => rpc(i, 'eth_getBlockByNumber', [first.number, false])));
    requireThat(anchored.every(item => same(item?.hash, first.hash)), 'The GL3 RPCs disagree on the common head.');
  }
  return first;
}
async function state() {
  const [head, latest, pending, balance, market, code] = await Promise.all([
    chain(), rpc(0, 'eth_getTransactionCount', [owner, 'latest']), rpc(0, 'eth_getTransactionCount', [owner, 'pending']),
    rpc(0, 'eth_getBalance', [owner, 'pending']), rpc(0, 'eth_gasPrice'), rpc(0, 'eth_getCode', [owner, 'latest']),
  ]);
  requireThat(code === '0x' && latest === pending && BigInt(market) > 0n, 'Wallet or nonce state has changed.');
  return { head, nonce: Number(BigInt(pending)), balance: BigInt(balance), gasPrice: BigInt(market) };
}
function compileActionData(abi, address, salt) {
  const digest = keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256','address','bytes32','address','uint16','bytes32'],
    [chainId, address, id('GH0ST_CROSS_EXAMINE_WALLET_AGE_INVARIANCE_V1'), owner, 7, salt],
  ));
  return [
    abi.encodeFunctionData('commitChallenge', [digest]),
    abi.encodeFunctionData('revealChallenge', [7, salt]),
    abi.encodeFunctionData('withdrawReward', [owner]),
    abi.encodeFunctionData('attemptUpgrade', [1, 0]),
  ];
}
function gasCeiling(base) {
  return (base * 125n + 99n) / 100n;
}
async function postingGas(contract, data, tag) {
  const result = await rpc(0, 'eth_call', [{
    from: owner, to: nodeInterface, data: l1Abi.encodeFunctionData('gasEstimateL1Component', [contract, false, data]),
  }, tag]);
  const [gas, baseFee] = l1Abi.decodeFunctionResult('gasEstimateL1Component', result);
  requireThat(gas > 0n && baseFee > 0n, 'Posting gas estimate was empty.');
  return gas;
}
async function makePlan(artifact, artifactSHA256, fixture) {
  const snapshot = await state();
  requireThat(Number.isSafeInteger(snapshot.nonce) && snapshot.nonce >= 0, 'Unsupported account nonce.');
  const contract = getCreateAddress({ from: owner, nonce: snapshot.nonce });
  requireThat((await Promise.all(urls.map((_, i) => rpc(i, 'eth_getCode', [contract, snapshot.head.number])))).every(code => code === '0x'),
    'The predicted contract address already contains code.');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const constructor = await factory.getDeployTransaction(owner, bountyWei, { value: bountyWei });
  const abi = factory.interface;
  const data = [constructor.data, ...compileActionData(abi, contract, hexlify(randomBytes(32)))];
  const price = snapshot.gasPrice * 2n;
  const estimates = await Promise.all(data.map(async (call, index) => {
    if (index === 0) {
      return BigInt(await rpc(0, 'eth_estimateGas', [{ from: owner, data: call, value: toQuantity(bountyWei) }]));
    }
    const test = [fixture.deployment, fixture.commit, fixture.verdictFlip, fixture.payout, fixture.blockedUpgrade][index];
    const executionGas = BigInt(test.gasUsed);
    requireThat(test.status === 1 && executionGas >= 21_000n, 'A local gas measurement was invalid.');
    return await postingGas(contract, call, snapshot.head.number) + executionGas + 5_000n;
  }));
  const rows = actions.map((action, i) => {
    const gasLimit = gasCeiling(estimates[i]);
    requireThat(gasLimit * price <= 4000n * 10n ** 18n, 'One transaction exceeds the GL3 RPC fee envelope.');
    const tx = {
      type: 2, chainId, nonce: snapshot.nonce + i, to: i ? contract : null,
      data: data[i], value: toQuantity(i ? 0n : bountyWei), gasLimit: toQuantity(gasLimit),
      maxFeePerGas: toQuantity(price), maxPriorityFeePerGas: '0x0', accessList: [],
    };
    return { id: action, title: labels[i], tx, unsignedHash: Transaction.from(tx).unsignedHash };
  });
  const maxGas = rows.reduce((sum, item) => sum + BigInt(item.tx.gasLimit) * price, 0n);
  requireThat(snapshot.balance >= maxGas + bountyWei, 'Project wallet balance is below the maximum reviewed cost.');
  const now = Date.now();
  return {
    schema:'gh0st.gl3.cross-examine-intent.v1', chainId, genesis, owner, contract,
    bountyWei: bountyWei.toString(), artifactSHA256, maxGasGh0st: formatEther(maxGas),
    expiresAtUTC: new Date(now + 2 * 3_600_000).toISOString(),
    releaseUntilUTC: new Date(now + 6 * 3_600_000).toISOString(),
    quoteBlock: Number(BigInt(snapshot.head.number)), actions: rows,
  };
}
async function privateJSON(path) {
  try {
    const info = await lstat(path);
    requireThat(info.isFile() && (info.mode & 0o077) === 0 && info.uid === process.getuid(), 'A local journal has unexpected permissions.');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function save(path, value) {
  const fd = await open(path, 'wx', 0o600);
  try {
    await fd.writeFile(JSON.stringify(value, null, 2) + '\n');
    await fd.sync();
  } finally {
    await fd.close();
  }
}
function selectEvent(abi, receipt, contract, name, assertion) {
  const matches = receipt.logs.filter(log => same(log.address, contract) && same(log.topics[0], abi.getEvent(name).topicHash));
  requireThat(matches.length === 1 && assertion(abi.parseLog(matches[0]).args), 'Unexpected ' + name + ' event.');
  return matches[0];
}
async function canonicalReceipt(tx, wait) {
  for (let i = 0; i < (wait ? 45 : 1); i++) {
    const receipts = await Promise.all(urls.map((_, i) => rpc(i, 'eth_getTransactionReceipt', [tx.hash])));
    if (receipts.every(Boolean)) {
      const views = await Promise.all(urls.map((_, i) => Promise.all([
        rpc(i, 'eth_getBlockByNumber', [receipts[i].blockNumber, false]),
        rpc(i, 'eth_getTransactionByHash', [tx.hash]),
      ])));
      requireThat(receipts.every((r, i) => {
        const [header, recorded] = views[i];
        return same(r.blockHash, receipts[0].blockHash) && same(header?.hash, r.blockHash) && r.status === '0x1'
          && same(recorded?.from, owner) && same(recorded?.input, tx.data) && same(recorded?.to, tx.to)
          && BigInt(recorded.nonce) === BigInt(tx.nonce) && BigInt(recorded.value) === tx.value;
      }), 'GL3 returned a failed or mismatched transaction ' + tx.hash);
      return receipts[0];
    }
    if (wait) await delay(1500);
  }
  return null;
}
async function readContract(abi, to, method, values, tag) {
  const data = abi.encodeFunctionData(method, values);
  return abi.decodeFunctionResult(method, await rpc(0, 'eth_call', [{ to, data, skipL1Charging: true }, tag]));
}
async function release(artifact, artifactSHA256, planPath, authorizationPath) {
  const plan = await privateJSON(planPath);
  const approval = await privateJSON(authorizationPath);
  requireThat(plan && approval && approval.planDigest === sha(JSON.stringify(plan))
    && approval.planDigest === sha(JSON.stringify(approval.plan)) && plan.artifactSHA256 === artifactSHA256,
    'Exact signed approval for this built contract is required.');
  requireThat(plan.chainId === chainId && plan.genesis === genesis && same(plan.owner, owner)
    && plan.bountyWei === bountyWei.toString() && plan.actions.length === actions.length
    && approval.signatures.length === actions.length && Date.parse(approval.authorizedAtUTC) <= Date.parse(plan.expiresAtUTC),
    'The signed plan does not match the demo.');
  const expectedAddress = getCreateAddress({ from: owner, nonce: plan.actions[0].tx.nonce });
  requireThat(same(expectedAddress, plan.contract), 'The signed address does not match CREATE.');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const abi = factory.interface;
  const [age, salt] = abi.decodeFunctionData('revealChallenge', plan.actions[2].tx.data);
  requireThat(age === 7n, 'Unreviewed challenger edit.');
  const constructor = await factory.getDeployTransaction(owner, bountyWei, { value: bountyWei });
  const expectedData = [constructor.data, ...compileActionData(abi, plan.contract, salt)];
  const signed = plan.actions.map((entry, i) => {
    const item = approval.signatures[i];
    const tx = Transaction.from(item.raw);
    requireThat(item.id === actions[i] && entry.id === actions[i] && same(tx.hash, item.hash)
      && same(tx.unsignedHash, entry.unsignedHash) && same(tx.unsignedHash, Transaction.from(entry.tx).unsignedHash)
      && same(tx.from, owner) && tx.chainId === BigInt(chainId) && tx.type === 2
      && tx.nonce === plan.actions[0].tx.nonce + i && same(tx.to, i ? plan.contract : null)
      && tx.value === (i ? 0n : bountyWei) && same(tx.data, expectedData[i]),
      'One of the signatures is outside this demo.');
    return tx;
  });
  requireThat(formatEther(signed.reduce((sum, tx) => sum + tx.gasLimit * tx.maxFeePerGas, 0n)) === plan.maxGasGh0st,
    'The signatures do not respect the reviewed gas total.');
  const receipts = [];
  const proofs = [];
  for (const [i, tx] of signed.entries()) {
    const file = resolve(dirname(authorizationPath), 'intent-' + actions[i] + '.json');
    const issued = await privateJSON(file);
    let receipt = await canonicalReceipt(tx, Boolean(issued));
    if (!receipt) {
      requireThat(!issued, 'An earlier broadcast is unresolved. Inspect its receipt before taking any further action.');
      requireThat(Date.now() < Date.parse(plan.releaseUntilUTC), 'The demo release window expired.');
      const live = await state();
      requireThat(live.nonce === tx.nonce && live.gasPrice <= tx.maxFeePerGas
        && live.balance >= tx.value + tx.gasLimit * tx.maxFeePerGas,
        'Wallet nonce, fee, or balance changed. The demo stopped before broadcasting.');
      const call = { from: owner, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: toQuantity(tx.value) };
      let estimated;
      try {
        estimated = BigInt(await rpc(0, 'eth_estimateGas', [call]));
      } catch (error) {
        const data = typeof error.rpcData === 'string' ? error.rpcData : error.rpcData?.data;
        // An idle GL3 can still be at the commitment block. The next sequenced
        // transaction will advance the child height, while this read does not.
        if (i !== 2 || !same(data, abi.getError('RevealTooEarly').selector)) throw error;
        const [pinned, opened] = await readContract(abi, plan.contract, 'commitments', [owner], live.head.number);
        requireThat(same(pinned, abi.decodeFunctionData('commitChallenge', signed[1].data)[0])
          && opened === BigInt(receipts[1].blockNumber) && opened === BigInt(live.head.number),
          'The reveal commitment does not match the canonical commit block.');
        estimated = await postingGas(plan.contract, call.data, live.head.number) + 100_000n;
      }
      requireThat(estimated <= tx.gasLimit, 'The live transaction estimate exceeds its signed gas limit.');
      if (i === 4) {
        const simulation = abi.decodeFunctionResult('attemptUpgrade', await rpc(0, 'eth_call', [
          { ...call, skipL1Charging: true }, 'latest',
        ]));
        requireThat(simulation[0] === false, 'The candidate no longer demonstrates the rejected upgrade.');
      }
      await save(file, { id: actions[i], txHash: tx.hash, signedPlanDigest: approval.planDigest });
      requireThat(same(await rpc(0, 'eth_sendRawTransaction', [tx.serialized]), tx.hash), 'The broadcast hash did not match the signed transaction.');
      receipt = await canonicalReceipt(tx, true);
      requireThat(receipt, 'The broadcast has no receipt on both RPCs yet. Review the recorded hash before continuing.');
    }
    const at = receipt.blockNumber;
    let event;
    if (i === 0) {
      requireThat(same(receipt.contractAddress, plan.contract), 'Unexpected deployment address.');
      event = selectEvent(abi, receipt, plan.contract, 'ClaimOpened', args => args[1] === 1n && args[2] === 365n && args[3] === bountyWei);
      const [code, before, after] = await Promise.all([
        rpc(0, 'eth_getCode', [plan.contract, at]), readContract(abi, plan.contract, 'verdictAt', [1, 365], at),
        readContract(abi, plan.contract, 'verdictAt', [1, 7], at),
      ]);
      requireThat(code !== '0x' && before[0] === true && before[1] === 102n && after[0] === false && after[1] === 90n, 'Pinned verdicts changed.');
    } else if (i === 1) {
      event = selectEvent(abi, receipt, plan.contract, 'ChallengeCommitted',
        args => same(args[0], owner) && same(args[1], abi.decodeFunctionData('commitChallenge', tx.data)[0]));
    } else if (i === 2) {
      event = selectEvent(abi, receipt, plan.contract, 'CounterexampleAccepted', args =>
        args[0] === 1n && same(args[1], owner) && args[2] === 365n && args[3] === 7n
        && args[4] === 102n && args[5] === 90n && args[6] === true && args[7] === false);
      selectEvent(abi, receipt, plan.contract, 'RewardCredited', args => same(args[0], owner) && args[1] === bountyWei);
    } else if (i === 3) {
      event = selectEvent(abi, receipt, plan.contract, 'RewardWithdrawn',
        args => same(args[0], owner) && same(args[1], owner) && args[2] === bountyWei);
      const [credit] = await readContract(abi, plan.contract, 'rewardCredit', [owner], at);
      requireThat(credit === 0n, 'Withdrawn credit was not cleared.');
      const deltas = await Promise.all(urls.map(async (_, i) => {
        const balances = await Promise.all([toQuantity(BigInt(at) - 1n), at].map(tag => rpc(i, 'eth_getBalance', [plan.contract, tag])));
        return BigInt(balances[0]) - BigInt(balances[1]);
      }));
      requireThat(deltas.every(delta => delta === bountyWei), 'Both RPCs must confirm the escrow balance decreased by the exact payout.');
    } else {
      event = selectEvent(abi, receipt, plan.contract, 'ModelUpgradeBlocked',
        args => args[0] === 1n && args[2] === 365n && args[3] === 7n
          && args[4] === true && args[5] === false && args[6] === true);
      const [version] = await readContract(abi, plan.contract, 'activeVersion', [], at);
      requireThat(version === 1n, 'The rejected upgrade changed the active model.');
    }
    receipts.push(receipt);
    const row = {
      action: actions[i], hash: tx.hash, block: Number(BigInt(at)), blockHash: receipt.blockHash,
      gasUsed: Number(BigInt(receipt.gasUsed)), event: abi.parseLog(event).name,
    };
    proofs.push(row);
    console.log(JSON.stringify(row));
  }
  const result = {
    chainId, genesis, contract: plan.contract, verifiedBy: urls,
    rewardGh0st: '1', rewardRecipient: owner, selfFundedDemo: true,
    verdicts: [{ age: 365, approved: true, score: 102 }, { age: 7, approved: false, score: 90 }],
    activeModel: 1, upgradeBlocked: true, actions: proofs,
    actualGasGh0st: formatEther(receipts.reduce((sum, r) => sum + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice), 0n)),
  };
  await save(resolve(dirname(authorizationPath), 'mainnet-results.json'), result);
}
try {
  const raw = await readFile(artifactPath, 'utf8');
  const artifact = JSON.parse(raw);
  if (mode === 'quote') {
    const fixture = JSON.parse(await readFile(evidenceOrPlan, 'utf8'));
    requireThat(fixture.sourceSHA256 === artifact.sourceSHA256 && fixture.compilerVersion === artifact.compilerVersion
      && fixture.chainId === 31337 && fixture.blockedUpgrade?.activeVersionAfter === 1
      && fixture.payout?.recipientBalanceDeltaWei === bountyWei.toString(), 'Local test evidence does not match the artifact.');
    await save(extra, await makePlan(artifact, sha(raw), fixture));
  } else if (mode === 'release') {
    await release(artifact, sha(raw), evidenceOrPlan, extra);
  } else {
    throw new Error('Use quote ARTIFACT TEST_EVIDENCE OUTPUT or release ARTIFACT INTENT SIGNED_APPROVAL.');
  }
} catch (error) {
  console.error(error.shortMessage ?? error.message);
  process.exitCode = 1;
}
