// Local-only harness. Nodes are always fresh child processes on loopback; no URL is accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import * as ethers from 'ethers';
export { ethers };
export const CAP = 16_777_216n;
export const BLOCK_LIMIT = 70_000_000n;
export const CHAIN_IDS = [4663, 56, 143, 5042];
export const EIDS = [30416, 30102, 30390, 30417];
const knownLocalAnvil = '/Users/abhijith/.foundry/versions/foundry-rs/foundry/v1.8.5/anvil';
export const ANVIL = process.env.ANVIL_BIN ?? (fs.existsSync(knownLocalAnvil) ? knownLocalAnvil : 'anvil');
const hex = ethers.toBeHex;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function creationCode(runtime) {
  const bytes = Buffer.from(runtime);
  assert(bytes.length > 0 && bytes.length <= 24_576, 'Runtime must fit EIP-170');
  const size = bytes.length.toString(16).padStart(4, '0');
  return '0x61' + size + '600e60003961' + size + '6000f3' + bytes.toString('hex');
}
export const addressRuntime = addresses => Buffer.concat([Buffer.from([0]), ...addresses.map(address => Buffer.from(ethers.zeroPadValue(address, 32).slice(2), 'hex'))]);
export function packedInt32(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeInt32BE(Number(value), i * 4));
  return bytes;
}
export const checkpoint = values => Object.fromEntries(['phase', 'layer', 'head', 'cursor', 'position', 'pendingToken', 'stepNumber', 'bestToken', 'bestLogit', 'stateCommitment']
  .map((name, i) => [name, name === 'stateCommitment' ? values[i] : BigInt(values[i])]));

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function startOptimizedChain({ config, onTransaction = () => {} } = {}) {
  assert(config, 'A local stage configuration is required');
  const stage = config.stage, chainId = config.chain_id, profile = config.profile ?? 'ethereum';
  assert(CHAIN_IDS.includes(chainId), 'Only the four verified chain identities are supported');
  assert(['ethereum', 'monad'].includes(profile));
  assert(profile !== 'monad' || chainId === 143, 'Native Monad profile belongs only to Monad');
  const cap = BigInt(config.maxTransactionGas ?? (profile === 'monad' ? 30000000 : CAP));
  const blockLimit = BigInt(config.blockGasLimit ?? (profile === 'monad' ? 150000000 : BLOCK_LIMIT));
  assert(cap > 100000n && cap <= (profile === 'monad' ? 30000000n : CAP));
  if (ANVIL.includes('/')) assert(fs.existsSync(ANVIL), 'Local Anvil executable is missing; set ANVIL_BIN');
  const port = await unusedPort();
  const nodeArgs = ['--host', '127.0.0.1', '--port', String(port), '--chain-id', String(chainId), '--network', profile,
    ...(profile === 'ethereum' ? ['--hardfork', 'cancun'] : []),
    '--gas-limit', String(blockLimit), '--gas-price', '0', '--block-base-fee-per-gas', '0', '--balance', '1000000000',
    '--code-size-limit', '24576', '--prune-history', '1', '--silent'];
  const processHandle = spawn(ANVIL, nodeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = '', stopped = false, rpcId = 0, count = 0, totalGas = 0n;
  processHandle.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
  processHandle.on('error', error => { diagnostics = error.message; });
  const rpc = async (method, params = []) => {
    assert(!stopped, 'Local node has stopped');
    const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(300_000) });
    const body = await response.json();
    if (body.error) { const error = Error(body.error.message); error.data = body.error.data; error.code = body.error.code; throw error; }
    return body.result;
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (processHandle.exitCode !== null) return;
    processHandle.kill('SIGTERM');
    await Promise.race([new Promise(resolve => processHandle.once('exit', resolve)), delay(3000)]);
    if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (processHandle.exitCode !== null) throw Error('Anvil exited: ' + diagnostics);
      try { ready = BigInt(await rpc('eth_chainId')) === BigInt(chainId); if (ready) break; } catch {}
      await delay(50);
    }
    assert(ready, 'Local Anvil failed to start: ' + diagnostics);
    assert.match(await rpc('web3_clientVersion'), /anvil/i);
    assert.equal(BigInt((await rpc('eth_getBlockByNumber', ['latest', false])).gasLimit), blockLimit);
    const accounts = await rpc('eth_accounts');
    let nodeInfo;
    try { nodeInfo = await rpc('anvil_nodeInfo'); } catch { nodeInfo = null; }
    const environment = { stage, chain_id: chainId, endpoint_id: config.endpoint_id, local_process_pid: processHandle.pid,
      client: await rpc('web3_clientVersion'), requested_network_profile: profile, node_info: nodeInfo,
      hardfork: profile === 'ethereum' ? 'cancun' : 'Anvil native default; inspect node_info before matching live Monad',
      execution_profile: profile === 'ethereum' ? 'generic Ethereum EVM; target chain identity only' : 'Anvil native Monad engine; live-fork parity requires separate semantic checks', block_gas_limit: blockLimit,
      transaction_gas_ceiling: cap, code_size_limit: 24_576, gas_price_wei: 0, forked: false, node_arguments: nodeArgs };
    async function send(request, { from = accounts[0], gas = null, purpose = 'transaction', category = 'test' } = {}) {
      assert.equal(request.chainId, undefined, 'Caller network overrides are forbidden');
      let declared = BigInt(request.gas ?? gas ?? cap);
      assert(declared > 0n && declared <= cap, 'Declared transaction gas exceeds the stage ceiling');
      assert.equal(BigInt(await rpc('eth_chainId')), BigInt(chainId), 'Local chain identity changed');
      if (profile === 'monad' && request.gas === undefined && gas === null) {
        const estimate = BigInt(await rpc('eth_estimateGas', [{ from, value: '0x0', gasPrice: '0x0', ...request, gas: hex(cap) }]));
        declared = estimate * 101n / 100n + 1000n;
        if (declared > cap) declared = cap;
      }
      const hash = await rpc('eth_sendTransaction', [{ from, value: '0x0', gasPrice: '0x0', ...request, gas: hex(declared) }]);
      let raw;
      for (let attempt = 0; attempt < 100; attempt++) { raw = await rpc('eth_getTransactionReceipt', [hash]); if (raw) break; await delay(10); }
      assert(raw, 'Automined receipt missing');
      const receipt = { ...raw, gasUsed: BigInt(raw.gasUsed), blockNumber: Number(raw.blockNumber), transactionHash: raw.transactionHash ?? hash };
      assert(receipt.gasUsed <= cap, 'Receipt exceeds transaction comparison ceiling');
      const submitted = await rpc('eth_getTransactionByHash', [hash]);
      assert(submitted && BigInt(submitted.gas) === declared, 'Submitted transaction gas differs from billed-gas record');
      const calldataBytes = request.data ? (request.data.length - 2) / 2 : 0;
      assert(Number.isSafeInteger(calldataBytes) && calldataBytes >= 0);
      count++; totalGas += receipt.gasUsed;
      await onTransaction({ stage, chain_id: chainId, index: count, category, purpose, hash, from,
        to: request.to ?? null, address: receipt.contractAddress ?? null, declared_gas: declared, gas: receipt.gasUsed,
        calldata_bytes: calldataBytes, gas_limit_verified_from_transaction: true,
        billed_gas_scenario: profile === 'monad' ? declared : receipt.gasUsed,
        billing_basis: profile === 'monad' ? 'declared gas limit per official Monad fee policy; test gas price zero' : 'receipt gas used; test gas price zero',
        effective_gas_price: BigInt(raw.effectiveGasPrice ?? 0), status: raw.status, block: receipt.blockNumber, receipt: raw });
      return receipt;
    }
    const contract = (address, artifact) => ({ address: ethers.getAddress(address), interface: new ethers.Interface(artifact.abi), artifact });
    async function deploy(artifact, args = [], label = artifact.sourceFile ?? 'contract', category = 'deployment') {
      const request = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object).getDeployTransaction(...args);
      const receipt = await send({ data: request.data }, { purpose: 'deploy ' + label, category });
      assert.equal(receipt.status, '0x1', label + ' deployment failed');
      const code = await rpc('eth_getCode', [receipt.contractAddress, 'latest']);
      assert((code.length - 2) / 2 <= 24_576, 'Deployed runtime exceeds EIP-170');
      return { ...contract(receipt.contractAddress, artifact), receipt, runtimeBytes: (code.length - 2) / 2, runtimeKeccak256: ethers.keccak256(code) };
    }
    async function deployRuntime(runtime, purpose) {
      const receipt = await send({ data: creationCode(runtime) }, { purpose, category: 'deployment' });
      assert.equal(receipt.status, '0x1', purpose + ' CREATE failed');
      const code = await rpc('eth_getCode', [receipt.contractAddress, 'latest']);
      assert.equal(code.toLowerCase(), '0x' + Buffer.from(runtime).toString('hex'), 'CREATE-deployed bytes mismatch');
      return { address: receipt.contractAddress, receipt, bytes: Buffer.from(runtime).length, keccak256: ethers.keccak256(code) };
    }
    async function view(target, method, args = [], { from = accounts[0], gas = cap, value = 0n } = {}) {
      assert(BigInt(gas) > 0n && BigInt(gas) <= cap, 'View gas exceeds comparison ceiling');
      const data = await rpc('eth_call', [{ from, to: target.address, data: target.interface.encodeFunctionData(method, args), gas: hex(gas), value: hex(value) }, 'latest']);
      return target.interface.decodeFunctionResult(method, data);
    }
    const value = async (...args) => (await view(...args))[0];
    async function estimate(target, method, args = [], { from = accounts[0], gas = cap } = {}) {
      assert(BigInt(gas) > 0n && BigInt(gas) <= cap, 'Estimate gas exceeds comparison ceiling');
      return BigInt(await rpc('eth_estimateGas', [{ from, to: target.address, data: target.interface.encodeFunctionData(method, args), gas: hex(gas), gasPrice: '0x0' }]));
    }
    const tx = (target, method, args = [], options = {}) => send({ to: target.address, data: target.interface.encodeFunctionData(method, args), value: hex(options.value ?? 0n) }, { purpose: method, ...options });
    return { stage, chainId, cap, profile, targetGas: BigInt(config.targetGas ?? cap * 97n / 100n), accounts, environment, rpc, send, deploy, deployRuntime, contract, view, value, estimate, tx, stop,
      metrics: () => ({ transactions: count, gas: totalGas }) };
  } catch (error) { await stop(); throw error; }
}

export async function startOptimizedChains(configs, options = {}) {
  const chains = [];
  try {
    for (const config of configs) chains.push(await startOptimizedChain({ ...options, config }));
    assert.equal(new Set(chains.map(chain => chain.environment.local_process_pid)).size, configs.length, 'Separate EVM processes required');
    return chains;
  } catch (error) { await Promise.allSettled(chains.map(chain => chain.stop())); throw error; }
}

export const packetType = 'tuple(uint8 version,bytes32 routeId,bytes32 modelId,bytes32 sessionId,uint32 position,uint32 inputToken,uint8 destinationStage,uint8 kind,uint32 outputToken,bytes32 trace,bytes hidden)';
export function decodePacket(bytes) { return ethers.AbiCoder.defaultAbiCoder().decode([packetType], bytes)[0].toObject(); }
export const encodePacket = packet => ethers.AbiCoder.defaultAbiCoder().encode([packetType], [packet]);
export async function deliver(chains, endpoints, routers, packet, options = {}) {
  const destination = EIDS.indexOf(Number(packet.dstEid));
  assert(destination >= 0, 'Only the fixed local endpoints can receive');
  return chains[destination].tx(endpoints[destination], 'deliver', [packet.srcEid, packet.sender, packet.nonce,
    packet.guid, routers[destination].address, packet.message], { category: 'message_receive', ...options });
}
