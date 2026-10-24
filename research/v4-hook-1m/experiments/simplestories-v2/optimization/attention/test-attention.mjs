import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import solc from 'solc';
import { JsonRpcProvider, ContractFactory, AbiCoder, keccak256 } from 'ethers';

const base = path.resolve('experiments/simplestories-v2');
const out = path.join(base, 'optimization/attention');
const original = fs.readFileSync(path.join(base, 'contracts/SimpleStoriesV2Model.sol'), 'utf8');
function section(text, needle) {
  const start = text.indexOf(needle);
  if (start < 0) throw Error(`Missing ${needle}`);
  let level = 0, opened = false;
  for (let i = start; i < text.length; ++i) {
    if (text[i] === '{') { level++; opened = true; }
    if (text[i] === '}' && --level === 0 && opened) return text.slice(start, i + 1);
  }
  throw Error('Unclosed section');
}
const optimized = fs.readFileSync(path.join(out, 'attention-assembly.sol.inc'), 'utf8');
const source = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract LocalAttentionProbe {
int256 private constant Q = 4096;
uint256 private constant HIDDEN = 128;
error ArithmeticRange();
${section(original, 'struct Work')}
${section(original, 'function _u32')}
${section(original, 'function _checked')}
${section(original, 'function _table')}
${section(original, 'function _attention').replace('function _attention', 'function _attentionOld')}
${optimized.replace('function _attention', 'function _attentionNew')}
function evaluate(bool optimized, int32[] memory query, int32[] memory key, int32[] memory value,
uint256 position, bytes memory tables) external view returns (int32[] memory output, uint256 measuredGas) {
require(position < 16 && query.length == (position+1)*128 && key.length == (position+1)*64 && value.length == key.length);
require(tables.length == 3080);
Work memory w;
w.query = query; w.key = key; w.value = value;
w.attention = new int32[](128); w.scores = new int256[](position+1); w.probabilities = new uint256[](position+1);
uint256 beforeGas = gasleft();
if (optimized) _attentionNew(w, position, tables); else _attentionOld(w, position, tables);
measuredGas = beforeGas - gasleft();
output = w.attention;
}
}`;
fs.writeFileSync(path.join(out, 'LocalAttentionProbe.sol'), source);
const input = { language: 'Solidity', sources: { 'Probe.sol': { content: source } }, settings: {
  viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
} };
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (compiled.errors || []).filter(e => e.severity === 'error');
if (errors.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
const artifact = compiled.contracts['Probe.sol'].LocalAttentionProbe;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh0st-attention-local-'));
const rpc = 'http://127.0.0.1:18556';
const child = spawn('/Users/abhijith/.foundry/bin/anvil', ['--host', '127.0.0.1', '--port', '18556', '--chain-id', '31337', '--hardfork', 'cancun', '--gas-limit', '32000000', '--code-size-limit', '24576', '--quiet', '--no-cors', '--disable-console-log'], { cwd: dir, env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'ignore'] });
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw Error(`Anvil exited ${child.exitCode}`);
    try { if (await provider.send('eth_chainId', []) === '0x7a69') { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  if (!ready) throw Error('Local Anvil not ready');
  const signer = await provider.getSigner(0);
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
  await contract.waitForDeployment();
  const tables = '0x' + fs.readFileSync(path.join(base, 'model/tables.bin')).toString('hex');
  let state = 0xabcddcba;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state | 0; };
  for (const position of [0, 1, 9, 15]) {
    for (const kind of ['zero', 'small', 'q12', 'full-int32', 'signed-extremes', 'constant-extremes']) {
      const make = (length, salt) => Array.from({ length }, (_, i) => {
        if (kind === 'zero') return 0;
        if (kind === 'small') return random() % 100;
        if (kind === 'q12') return random() % 50000;
        if (kind === 'full-int32') return random();
        if (kind === 'signed-extremes') return (i + salt) % 2 ? 2147483647 : -2147483648;
        return salt % 2 ? 2147483647 : -2147483648;
      });
      const query = make((position + 1) * 128, 0), key = make((position + 1) * 64, 1), value = make((position + 1) * 64, 2);
      const a = await contract.evaluate(false, query, key, value, position, tables, { gasLimit: 32000000 });
      const b = await contract.evaluate(true, query, key, value, position, tables, { gasLimit: 32000000 });
      if (a[0].some((v, i) => v !== b[0][i])) throw Error(`Mismatch at ${position}/${kind}`);
      results.push({ position, kind, exact128Outputs: true, baselineAttentionGas: Number(a[1]), optimizedAttentionGas: Number(b[1]), outputHash: keccak256(AbiCoder.defaultAbiCoder().encode(['int32[]'], [a[0]])) });
    }
  }
  const zeroTables = '0x' + Buffer.alloc(3080).toString('hex');
  const errors = [];
  for (const mode of [false, true]) {
    try { await contract.evaluate(mode, Array(128).fill(0), Array(64).fill(0), Array(64).fill(0), 0, zeroTables); throw Error('Expected division by zero'); }
    catch (error) { if (error.data !== '0x4e487b710000000000000000000000000000000000000000000000000000000000000012') throw error; errors.push(error.data); }
  }
  const report = { localOnly: true, chainId: 31337, port: 18556, solc: solc.version(), sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), runtimeBytes: artifact.evm.deployedBytecode.object.length / 2,
    measuredScope: 'gasleft delta inside standalone probe attention only; not a v4 swap', originalModelSourceSha256: crypto.createHash('sha256').update(original).digest('hex'), cases: results,
    allExact: results.length === 24, zeroDenominatorPanicMatched: errors.length === 2 };
  fs.writeFileSync(path.join(out, 'attention-parity.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ allExact: report.allExact, zeroDenominatorPanicMatched: report.zeroDenominatorPanicMatched, cases: results.map(({ position, kind, baselineAttentionGas, optimizedAttentionGas }) => ({ position, kind, baselineAttentionGas, optimizedAttentionGas })) }, null, 2));
} finally {
  provider.destroy();
  child.kill('SIGTERM');
  await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
