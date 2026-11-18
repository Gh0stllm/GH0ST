// Exercise one authenticated opening group on a disposable stock Nitro
// node. Only the isolated chain and ephemeral genesis signer are accepted.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const CHAIN = 412346n;
const MAX_SIGNED = 95_000;
const MAX_GAS = 32_000_000n;
const NODE_INTERFACE = '0x00000000000000000000000000000000000000c8';
const CONTRACT_CREATION = '0x0000000000000000000000000000000000000000';
const ARB_SYS = '0x0000000000000000000000000000000000000064';
const ARB_WASM = '0x0000000000000000000000000000000000000071';
const HEAD_SLOT = '0x' + '6d'.repeat(32);
const PUBLIC_GENESIS = '0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
const SLICE_HEAD_BYTES = 112;
const DRIVER_BYTES = 44;

const args = process.argv.slice(2);
const activationOnly = args[0] === '--activation-only';
const instructionSlices = args[0] === '--instruction-slices';
if (activationOnly || instructionSlices) args.shift();
const expectedArgs = activationOnly ? 5 : instructionSlices ? 6 : 7;
if (args.length !== expectedArgs) {
  throw new Error('Pass ETHERS_PACKAGE_JSON PRIVATE_RPC IMPORT_DIR SEARCH_PACKAGE WITNESS_BIN TRACE_REPORT NEW_RESULT, or use --activation-only with no witness/trace, or --instruction-slices with SLICE_TRACE_DIR instead of witness/trace');
}
const [ethersPackage, url, importDir, wasmPath, witnessPath, tracePath] = args;
const output = args.at(-1);
const endpoint = new URL(url);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
    || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password || endpoint.hash) {
  throw new Error('Private rehearsal requires a plain IPv4 loopback address and port');
}

const { Wallet, Interface, id, getBytes, hexlify, keccak256 } = createRequire(path.resolve(ethersPackage))('ethers');
const readJson = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const setup = readJson(path.join(importDir, 'rehearsal.json'));
const program = readJson(wasmPath);
const config = fs.readFileSync(path.join(importDir, 'config.bin'));
const head = fs.readFileSync(path.join(importDir, 'checkpoint.bin'));
const witness = activationOnly || instructionSlices ? null : fs.readFileSync(witnessPath);
const trace = witness ? readJson(tracePath) : null;
const slices = instructionSlices ? readJson(path.join(witnessPath, 'trace.json')).slices : null;
const quanta = trace?.quanta ?? 40;
const firstGroup = `first${quanta}`;
const codeBacked = witness !== null && Boolean(setup.codeWitnessBytes);
const codeManifest = codeBacked ? fs.readFileSync(path.join(importDir, 'code-witness-manifest.bin')) : null;
if (head.length !== 72 || !program.initializedSearch || program.configCommitment !== setup.configCommitment
    || program.initialCheckpoint !== setup.initialCheckpoint
    || (witness && witness.subarray(0, 4).toString() !== 'GW01')) {
  throw new Error('Wrong rehearsal inputs or initialized package');
}
if (trace && (trace.quanta !== quanta || !Number.isInteger(quanta) || quanta < 1 || quanta > 40
    || !(codeBacked ? trace.codePacketWritten : trace.packetWritten)
    || trace.archivedWitnessBytes !== witness.length
    || !/^[a-f0-9]{64}$/.test(trace.journalSHA256))) {
  throw new Error('Trace differs from the first-group witness');
}
const prefix = Buffer.alloc(quanta === 40 ? 3 : 4);
if (quanta === 40) {
  prefix[0] = codeBacked ? 2 : 1;
} else {
  prefix[0] = codeBacked ? 4 : 3;
  prefix[1] = quanta;
}
prefix.writeUInt16BE(config.length, prefix.length - 2);
if (codeBacked && (codeManifest.readUInt32BE(0) !== witness.length || setup.codeWitnessBytes !== witness.length)) {
  throw new Error('Manifest does not describe the exact witness');
}
const calldata = witness ? Buffer.concat([prefix, config, head, codeManifest ?? witness]) : null;
if (calldata && calldata.length >= MAX_SIGNED) throw new Error('The first group calldata alone exceeds admission');
const sliceCalls = instructionSlices ? loadSliceCalls() : [];
const signer = new Wallet(process.env.GH0ST_PRIVATE_REHEARSAL_SIGNER || '');
if (signer.address.toLowerCase() !== setup.signerAddress) throw new Error('Signer differs from the ephemeral funded address');
if (fs.existsSync(output)) throw new Error('New result path required');

let sequence = 0;
async function rpc(method, params = []) {
  const result = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!result.ok) throw new Error(`${method} HTTP error ${result.status}`);
  const reply = await result.json();
  if (reply.error) throw new Error(`${method}: ${String(reply.error.message).slice(0, 180)}`);
  return reply.result;
}

const arbSys = new Interface(['function arbOSVersion() view returns (uint256)']);
const arbWasm = new Interface(['function activateProgram(address) payable returns (uint16,uint256)',
  'function programVersion(address) view returns (uint16)', 'function inkPrice() view returns (uint32)']);
const nodeInterface = new Interface(['function gasEstimateL1Component(address,bool,bytes) returns (uint64,uint256,uint256)']);
const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
if (BigInt(await rpc('eth_chainId')) !== CHAIN || !/^0x[0-9a-f]{64}$/i.test(genesis?.hash || '')
    || genesis.hash.toLowerCase() === PUBLIC_GENESIS
    || BigInt(await rpc('eth_call', [{ to: ARB_SYS, data: arbSys.encodeFunctionData('arbOSVersion') }, 'latest'])) !== 116n) {
  throw new Error('RPC did not confirm the isolated ArbOS 61 chain');
}

if (codeBacked) {
  const payloadBytes = 24_575;
  const records = Math.ceil(witness.length / payloadBytes);
  if (codeManifest.length !== 4 + 52 * records) throw new Error('Incorrect code-witness manifest length');
  for (let i = 0; i < records; i++) {
    const position = 4 + i * 52;
    const address = hexlify(codeManifest.subarray(position, position + 20));
    const pin = hexlify(codeManifest.subarray(position + 20, position + 52));
    const code = Buffer.from(getBytes(await rpc('eth_getCode', [address, 'latest'])));
    const part = witness.subarray(i * payloadBytes, (i + 1) * payloadBytes);
    if (code[0] !== 0 || !code.subarray(1).equals(part) || keccak256(code) !== pin) {
      throw new Error('Code-witness cell does not match the traced read set');
    }
  }
}

const report = { scope: activationOnly ? 'private stock Nitro activation only'
    : instructionSlices ? 'private stock Nitro cold Stockfish instruction slices' : 'private stock Nitro first Stockfish group',
  genesis: genesis.hash, chainId: Number(CHAIN), witnessBytes: witness?.length ?? null,
  codeBacked, quanta: witness ? quanta : null, calldataBytes: calldata?.length ?? null, transactions: {},
  inkPerGas: Number(BigInt(await rpc('eth_call', [{ to: ARB_WASM, data: arbWasm.encodeFunctionData('inkPrice') }, 'latest']))),
  activationPassed: false, fullMove: false, publicDeployment: false, passed: false };
let nonce = Number(BigInt(await rpc('eth_getTransactionCount', [signer.address, 'pending'])));

async function send(label, inputs) {
  const marketGasPrice = BigInt(await rpc('eth_gasPrice'));
  // Only the disposable rehearsal signer uses this margin. Recent full-gas
  // attempts can increase the private base fee before the next block.
  const gasPrice = marketGasPrice * 125n / 100n + 1n;
  const posterCall = nodeInterface.encodeFunctionData('gasEstimateL1Component',
    [inputs.to ?? CONTRACT_CREATION, !inputs.to, inputs.data ?? '0x']);
  const estimate = await rpc('eth_call', [{ from: signer.address, to: NODE_INTERFACE, data: posterCall }, 'latest']);
  const [posterGasEstimate] = nodeInterface.decodeFunctionResult('gasEstimateL1Component', estimate);
  const gasLimit = MAX_GAS + posterGasEstimate * 102n / 100n + 10_000n;
  const raw = await signer.signTransaction({ chainId: CHAIN, type: 0, gasLimit,
    nonce, gasPrice, ...inputs });
  const signedTransactionBytes = getBytes(raw).length;
  if (signedTransactionBytes >= MAX_SIGNED) throw new Error(`${label} signed size ${signedTransactionBytes} exceeds admission`);
  const at = performance.now();
  const hash = await rpc('eth_sendRawTransaction', [raw]);
  nonce += 1;
  const row = { hash, signedTransactionBytes, posterGasEstimate: posterGasEstimate.toString(), gasLimit: gasLimit.toString() };
  report.transactions[label] = row;
  for (let attempt = 0; attempt < 600; attempt++) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      row.wallMs = performance.now() - at;
      row.receipt = receipt;
      const gasUsed = BigInt(receipt.gasUsed);
      const posterGas = BigInt(receipt.gasUsedForL1 ?? '0x0');
      if (posterGas < 0n || posterGas >= gasUsed) throw new Error(`${label} returned invalid gas components`);
      row.computeGas = Number(gasUsed - posterGas);
      if (receipt.status !== '0x1') throw new Error(`${label} reverted, compute gas used=${row.computeGas}`);
      if ((label === firstGroup || label.startsWith('slice')) && gasUsed - posterGas > MAX_GAS) {
        throw new Error(`${label} exceeded the L2 compute gas cap`);
      }
      return receipt;
    }
    await sleep(100);
  }
  throw new Error(`${label} receipt deadline`);
}

function verifyJournal(logs, committedHead, expectedCount, expectedTrace = null) {
  const hash = createHash('sha256');
  let previousIndex = -1;
  let count = 0;
  let length = 0;
  for (const log of logs) {
    const chunk = Buffer.from(getBytes(log.data));
    if (log.topics.length !== 2 || log.topics[1] !== committedHead || chunk.length === 0
        || chunk.length > 12_288 - 64) throw new Error('Wrong checkpoint page log');
    for (let offset = 0; offset < chunk.length;) {
      if (chunk.length - offset < 7) throw new Error('Incomplete checkpoint page header');
      const index = chunk.readUInt32BE(offset);
      const size = chunk.readUInt16BE(offset + 5);
      const end = offset + 7 + size;
      const mode = chunk[offset + 4];
      if (index <= previousIndex || index >= 196_608 || end > chunk.length ||
          !((mode === 0 && size === 0) || (mode === 1 && size > 0 && size < 4096) || (mode === 2 && size === 4096))) {
        throw new Error('Out-of-order or incomplete checkpoint page');
      }
      previousIndex = index;
      count++;
      offset = end;
    }
    length += chunk.length;
    hash.update(chunk);
  }
  const digest = hash.digest('hex');
  if (count !== expectedCount || (expectedTrace && (count !== expectedTrace.changedPages
      || length !== expectedTrace.journalDataBytes || digest !== expectedTrace.journalSHA256))) {
    throw new Error('Published journal differs from the exact interpreter trace');
  }
  return { changedPages: count, bytes: length, sha256: digest };
}

function legacyHeadCommitment(checkpoint) {
  const fields = Buffer.alloc(41);
  fields.writeUInt32LE(checkpoint.readUInt32BE(32), 0);
  for (const offset of [4, 12, 20, 28]) fields.writeBigUInt64LE(checkpoint.readBigUInt64BE(32 + offset), offset);
  fields.writeUInt32LE(checkpoint.readUInt32BE(68), 36);
  return keccak256(Buffer.concat([Buffer.from('GL3_STYLUS_CHECKPOINT_V1'),
    Buffer.from(setup.configCommitment + setup.job, 'hex'), checkpoint.subarray(0, 32), fields]));
}

function sliceHeadCommitment(sliceHead) {
  return keccak256(Buffer.concat([Buffer.from('GL3_STYLUS_CHECKPOINT_SLICE_V1'),
    getBytes(legacyHeadCommitment(sliceHead.subarray(0, 72))), sliceHead.subarray(72)]));
}

function frameCommitment(frame) {
  return keccak256(Buffer.concat([Buffer.from('GL3_STYLUS_SLICE_CONTEXT_V1'),
    frame.subarray(0, DRIVER_BYTES), getBytes(keccak256(frame.subarray(DRIVER_BYTES)))]));
}

function loadSliceCalls() {
  if (!Array.isArray(slices) || slices.length !== 2) throw new Error('Expected exactly two private instruction slices');
  let previousInstructions = 0;
  return slices.map((row, index) => {
    const call = fs.readFileSync(path.join(witnessPath, `slice-${index}.bin`));
    const headStart = 3 + config.length;
    const headEnd = headStart + SLICE_HEAD_BYTES;
    const frameStart = headEnd + 6;
    if (call.length < frameStart + 6 || call.length >= MAX_SIGNED || row.callBytes !== call.length
        || call[0] !== 5 || call.readUInt16BE(1) !== config.length
        || !call.subarray(3, headStart).equals(config)
        || !/^[a-f0-9]{64}$/.test(row.before) || !/^[a-f0-9]{64}$/.test(row.after)
        || row.guestQuanta !== 0 || !Number.isInteger(row.instructions)
        || !Number.isInteger(row.changedPages) || row.changedPages < 0
        || !Number.isInteger(row.nextMachineBytes) || row.nextMachineBytes < 24 || row.nextMachineBytes > 65_535) {
      throw new Error(`Slice ${index} does not match the pinned rehearsal`);
    }
    const sliceHead = call.subarray(headStart, headEnd);
    const budget = call.readUInt32BE(headEnd);
    const machineLen = call.readUInt16BE(headEnd + 4);
    const frameEnd = frameStart + (machineLen ? DRIVER_BYTES + machineLen : 0);
    const frame = call.subarray(frameStart, frameEnd);
    const prior = index === 0 ? `0x${setup.initialCheckpoint}` : `0x${slices[index - 1].after}`;
    if (budget < 1 || budget > 1_000_000 || row.instructions !== previousInstructions + budget
        || sliceHead.readBigUInt64BE(72) !== BigInt(previousInstructions)
        || `0x${row.before}` !== prior || row.after === row.before
        || call.length - frameEnd !== row.witnessBytes
        || call.subarray(frameEnd, frameEnd + 4).toString() !== 'GW01') {
      throw new Error(`Invalid execution budget, head, or witness for slice ${index}`);
    }
    if (index === 0) {
      if (machineLen || !sliceHead.subarray(0, 72).equals(head) || sliceHead.subarray(80).some(byte => byte !== 0)
          || legacyHeadCommitment(head) !== prior) {
        throw new Error('Slice zero must use the exact quiescent genesis checkpoint');
      }
    } else if (machineLen !== slices[index - 1].nextMachineBytes
        || frame.subarray(0, 4).toString() !== 'GSD1'
        || frame.subarray(DRIVER_BYTES, DRIVER_BYTES + 4).toString() !== 'GVM1'
        || frameCommitment(frame) !== hexlify(sliceHead.subarray(80))
        || sliceHeadCommitment(sliceHead) !== prior) {
      throw new Error('Resume invocation differs from the trace commitment');
    }
    previousInstructions = row.instructions;
    return { call, sliceHead, frame, budget, row };
  });
}

function recoverFrame(logs, checkpoint, expectedMachineBytes) {
  const total = DRIVER_BYTES + expectedMachineBytes;
  const frame = Buffer.alloc(total);
  let offset = 0;
  for (const log of logs) {
    const bytes = Buffer.from(getBytes(log.data));
    if (log.topics.length !== 2 || log.topics[1] !== checkpoint || bytes.length <= 8
        || bytes.readUInt32BE(0) !== offset || bytes.readUInt32BE(4) !== total
        || offset + bytes.length - 8 > total) {
      throw new Error('Continuation logs do not encode one contiguous frame');
    }
    bytes.copy(frame, offset, 8);
    offset += bytes.length - 8;
  }
  if (offset !== total || frame.subarray(0, 4).toString() !== 'GSD1'
      || frame.subarray(DRIVER_BYTES, DRIVER_BYTES + 4).toString() !== 'GVM1') {
    throw new Error('Next continuation was missing or incomplete');
  }
  return frame;
}

async function rehearseSlices(address) {
  report.slices = [];
  for (const [index, { call, budget, row }] of sliceCalls.entries()) {
    const label = `slice${index}`;
    const previous = `0x${row.before}`;
    if (await rpc('eth_getStorageAt', [address, HEAD_SLOT, 'latest']) !== previous) {
      throw new Error(`${label} prior head is absent in contract storage`);
    }
    const receipt = await send(label, { to: address, data: hexlify(call) });
    const ownLogs = receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase());
    const events = ownLogs.filter(log => log.topics[0] === id('GL3StockfishSliceHeadV1'));
    const after = `0x${row.after}`;
    if (events.length !== 1 || events[0].topics.length !== 2 || events[0].topics[1] !== `0x${setup.job}`) {
      throw new Error('Expected one authenticated slice head event');
    }
    const event = Buffer.from(getBytes(events[0].data));
    const sliceHead = event.subarray(64, 176);
    const observedHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, receipt.blockNumber]);
    if (event.length !== 206 || hexlify(event.subarray(0, 32)) !== previous
        || hexlify(event.subarray(32, 64)) !== after || observedHead !== after
        || sliceHeadCommitment(sliceHead) !== after || event[176] !== 0
        || event.subarray(177, 194).some(byte => byte !== 0)
        || sliceHead.readUInt32BE(32) !== row.guestQuanta
        || sliceHead.readBigUInt64BE(72) !== BigInt(row.instructions)
        || event.readUInt32BE(194) !== row.changedPages || event.readBigUInt64BE(198) !== BigInt(budget)) {
      throw new Error('The signed transaction did not commit the exact traced slice');
    }
    const frameLogs = ownLogs.filter(log => log.topics[0] === id('GL3StockfishSliceFrameV1'));
    const frame = recoverFrame(frameLogs, after, row.nextMachineBytes);
    const journal = verifyJournal(
      ownLogs.filter(log => log.topics[0] === id('GL3StockfishCheckpointPagesV1')), after, row.changedPages);
    const next = sliceCalls[index + 1];
    if (frameCommitment(frame) !== hexlify(sliceHead.subarray(80))
        || (next && (!next.frame.equals(frame) || !next.sliceHead.equals(sliceHead)))) {
      throw new Error('The on-chain continuation differs from the next signed slice');
    }
    report.slices.push({
      label, before: previous, after, instructions: row.instructions, guestQuanta: row.guestQuanta,
      readPages: row.readPages, changedPages: row.changedPages, callBytes: call.length,
      witnessBytes: row.witnessBytes, nextMachineBytes: row.nextMachineBytes,
      continuationDigest: frameCommitment(frame), frameMatchesNextCall: next ? true : null, journal,
    });
  }
  report.passed = true;
}

async function deploymentData() {
  if (program.schema !== 'gh0st.stylus-fragment-package.v1') return program.initCode;
  const parts = program.fragments;
  const root = program.rootInitCodeTemplate;
  if (parts.length < 2 || parts.length > 4 || !root.endsWith('00'.repeat(20 * parts.length))
      || program.rootRuntimeBytes !== 8 + 20 * parts.length) throw new Error('Invalid root or fragment manifest');
  const addresses = [];
  for (const [index, part] of parts.entries()) {
    const receipt = await send('fragment' + index, { data: part.initCode });
    const address = receipt.contractAddress;
    const data = Buffer.from(getBytes(await rpc('eth_getCode', [address, 'latest'])));
    if (!address || data.length !== part.runtimeBytes
        || createHash('sha256').update(data).digest('hex') !== part.runtimeSHA256) {
      throw new Error('Deployed fragment differs from its manifest');
    }
    addresses.push(address.slice(2));
  }
  const linkOffset = root.length - 40 * addresses.length;
  return root.slice(0, linkOffset) + addresses.join('');
}

try {
  const deployed = await send('deploy', { data: await deploymentData() });
  const address = deployed.contractAddress;
  report.address = address;
  await send('activate', { to: ARB_WASM, data: arbWasm.encodeFunctionData('activateProgram', [address]),
    value: 1_000_000_000_000_000_000n });
  const active = await rpc('eth_call', [{ to: ARB_WASM, data: arbWasm.encodeFunctionData('programVersion', [address]) }, 'latest']);
  const oldHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, 'latest']);
  if (BigInt(active) !== 3n || oldHead.toLowerCase() !== `0x${setup.initialCheckpoint}`) {
    throw new Error('Activation or constructor checkpoint mismatch');
  }
  report.activationPassed = true;
  if (instructionSlices) {
    await rehearseSlices(address);
  } else if (!activationOnly) {
    const receipt = await send(firstGroup, { to: address, data: hexlify(calldata) });
    const ownLogs = receipt.logs.filter(log => log.address.toLowerCase() === address.toLowerCase());
    const events = ownLogs.filter(log => log.topics[0] === id('GL3StockfishCheckpointHeadV1')
      && log.topics[1] === `0x${setup.job}`);
    if (events.length !== 1) throw new Error('Expected exactly one authenticated head event');
    const event = Buffer.from(getBytes(events[0].data));
    const newHead = await rpc('eth_getStorageAt', [address, HEAD_SLOT, receipt.blockNumber]);
    if (event.length !== 166 || `0x${event.subarray(0, 32).toString('hex')}` !== oldHead || newHead === oldHead
        || `0x${event.subarray(32, 64).toString('hex')}` !== newHead || event.readUInt32BE(96) !== quanta || event[136] !== 0) {
      throw new Error('Committed head differs from the exact opening group boundary');
    }
    const checkpoint = event.subarray(64, 136);
    const commitment = legacyHeadCommitment(checkpoint);
    report.observedNodes = Number(checkpoint.readBigUInt64BE(36));
    report.guestInstructions = event.readBigUInt64BE(158).toString();
    if (commitment !== newHead || checkpoint.readUInt32BE(68) !== trace.logicalMemoryBytes
        || report.observedNodes !== trace.observedNodes
        || report.guestInstructions !== String(trace.guestInstructions)) {
      throw new Error('Header commitment or exact trace counters differ');
    }
    const pagesTopic = id('GL3StockfishCheckpointPagesV1');
    const pageLogs = ownLogs.filter(log => log.topics[0] === pagesTopic);
    const changed = event.readUInt32BE(154);
    if (codeBacked) {
      if (pageLogs.length !== 0 || changed !== trace.changedPages) throw new Error('Incorrect replayable head log');
      report.journal = { changedPages: changed, bytes: 0 };
    } else {
      report.journal = verifyJournal(pageLogs, newHead, changed, trace);
    }
    report.nextCheckpoint = hexlify(checkpoint);
    report.passed = true;
  }
} catch (error) {
  report.error = String(error.message).slice(0, 240);
  const failed = Object.entries(report.transactions).find(([label, row]) =>
    (label === firstGroup || label.startsWith('slice')) && row.receipt?.status === '0x0');
  if (failed) {
    const [label, row] = failed;
    report.checkpointAfterRevert = await rpc('eth_getStorageAt', [report.address, HEAD_SLOT, row.receipt.blockNumber]);
    report.revertedLabel = label;
  }
  process.exitCode = 1;
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ activationPassed: report.activationPassed, passed: report.passed,
    error: report.error, fullMove: false }));
}
