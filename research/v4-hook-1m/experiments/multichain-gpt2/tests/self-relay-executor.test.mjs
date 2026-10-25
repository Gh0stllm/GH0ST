// Local interface/security test. It does not claim a working public DVN pathway.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compile, HERE, json, sha256 } from '../scripts/build.mjs';
import { startLocalChain, ethers } from './harness.mjs';

const directory = path.join(HERE, 'reports/self-relay-executor');
fs.mkdirSync(directory, { recursive: true });
const report = { status: 'RUNNING', scope: 'LOCAL_EXECUTOR_INTERFACE_AND_OFFICIAL_OPTIONS_DECODING', publicTransactions: 0, checks: [] };
let chain;
try {
  const build = compile({ includeTests: true, outputDirectory: directory });
  chain = await startLocalChain({ stage: 0 });
  const library = await chain.deploy(build.artifacts.SelfRelayCaller);
  const app = await chain.deploy(build.artifacts.SelfRelayCaller);
  const executor = await chain.deploy(build.artifacts.GH0STSelfRelayExecutor, [library.address, app.address, 30202, 4663]);
  const full = '0x0003010011010000000000000000000000000007a120';
  const [options, dvn] = await chain.view(library, 'split', [full]);
  assert.equal(options, '0x010011010000000000000000000000000007a120'); assert.equal(dvn, '0x');
  assert.equal(await chain.value(executor, 'OPTIONS_HASH'), ethers.keccak256(options));
  report.checks.push('official UlnOptions yields the exact permitted 500k receive options');
  for (const size of [384, 416, 512, 640, 4480]) assert.equal(await chain.value(executor, 'getFee', [30202, app.address, size, options]), 0n);
  report.checks.push('valid bound job sizes quote zero service fee');
  const reject = async (name, target, method, args) => { await assert.rejects(() => chain.view(target, method, args)); report.checks.push(name); };
  await reject('untrusted caller cannot assign', executor, 'assignJob', [30202, app.address, 416, options]);
  await reject('wrong destination rejected', executor, 'getFee', [30102, app.address, 416, options]);
  await reject('wrong application rejected', executor, 'getFee', [30202, library.address, 416, options]);
  await reject('short payload rejected', executor, 'getFee', [30202, app.address, 383, options]);
  await reject('oversized payload rejected', executor, 'getFee', [30202, app.address, 4481, options]);
  await reject('empty options rejected', executor, 'getFee', [30202, app.address, 416, '0x']);
  await reject('full Type3 envelope rejected as worker options', executor, 'getFee', [30202, app.address, 416, full]);
  await reject('unpriced native drop or altered gas options rejected', executor, 'getFee', [30202, app.address, 416, options.slice(0, -2) + '21']);
  assert.equal(await chain.value(library, 'assign', [executor.address, 30202, app.address, 416, options]), 0n);
  const receipt = await chain.tx(library, 'assign', [executor.address, 30202, app.address, 416, options]);
  assert.equal(receipt.status, '0x1');
  const events = receipt.logs.filter(l => l.address.toLowerCase() === executor.address.toLowerCase()).map(l => executor.interface.parseLog(l));
  assert.equal(events.length, 1); assert.equal(events[0].name, 'RelayJobAssigned');
  assert.equal(events[0].args.destinationEid, 30202n); assert.equal(events[0].args.payloadBytes, 416n);
  report.checks.push('only bound send library can assign and assignment emits no verification result');
  const factory = new ethers.ContractFactory(build.artifacts.GH0STSelfRelayExecutor.abi, build.artifacts.GH0STSelfRelayExecutor.evm.bytecode.object);
  for (const args of [[chain.accounts[0], app.address, 30202, 4663], [library.address, chain.accounts[0], 30202, 4663],
    [library.address, app.address, 0, 4663], [library.address, app.address, 30202, 204]]) {
    const tx = await factory.getDeployTransaction(...args);
    await assert.rejects(() => chain.rpc('eth_call', [{ from: chain.accounts[0], data: tx.data, gas: '0xffffff' }, 'latest']));
  }
  report.checks.push('constructor rejects missing code, zero destination and wrong chain');
  report.runtimeBytes = executor.runtimeBytes;
  report.sourceSha256 = sha256(fs.readFileSync(path.join(HERE, 'contracts/GH0STSelfRelayExecutor.sol')));
  report.status = 'PASS_SELF_RELAY_EXECUTOR_INTERFACE';
} catch (error) { report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; throw error; }
finally { if (chain) await chain.stop(); fs.writeFileSync(path.join(directory, 'results.json'), json(report)); }
console.log(json({ status: report.status, checks: report.checks.length }));
