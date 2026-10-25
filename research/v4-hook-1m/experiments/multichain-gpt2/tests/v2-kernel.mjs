// Exact signed-domain regression for the optimization kernel, plus real-row gas measurements.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HERE, confinedOutput, sha256, json } from '../scripts/build.mjs';
import { startOptimizedChain } from './optimized-runtime.mjs';

const solc = createRequire(path.join(HERE, 'package.json'))('solc');
const wrapper = `pragma solidity 0.8.30;
import {GPT2DotOptimized} from "GPT2DotOptimized.sol";
import {GPT2DotOptimizedV2} from "GPT2DotOptimizedV2.sol";
contract KernelProbe {
 function baseline(bytes memory rows,uint256 stride,uint256 offset,int256[] memory x,uint256 count) external pure returns(int256[] memory y) {
  GPT2DotOptimized.Prepared memory p = GPT2DotOptimized.prepare(x); y=new int256[](count);
  for(uint256 i;i<count;++i) y[i]=GPT2DotOptimized.dotPacked(rows,offset+i*stride,x,p);
 }
 function candidate(bytes memory rows,uint256 stride,uint256 offset,int256[] memory x,uint256 count) external pure returns(int256[] memory y) {
  GPT2DotOptimizedV2.Prepared memory p=GPT2DotOptimizedV2.prepare(x); y=new int256[](count);
  for(uint256 i;i<count;++i) y[i]=GPT2DotOptimizedV2.dotPacked(rows,offset+i*stride,x,p);
 }
}`;
const sources = Object.fromEntries(['GPT2DotOptimized.sol', 'GPT2DotOptimizedV2.sol'].map(name => [name, { content: fs.readFileSync(path.join(HERE, 'contracts', name), 'utf8') }]));
sources['KernelProbe.sol'] = { content: wrapper };
const settings = { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } };
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
const errors = (output.errors ?? []).filter(error => error.severity === 'error'); assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
const directory = confinedOutput('reports/v2-weightsum-kernel'); fs.mkdirSync(directory, { recursive: true });
const report = { status: 'RUNNING', scope: 'NATIVE_MONAD_PURE_KERNEL_MICROBENCHMARK_NOT_FULL_MODEL', compiler: solc.version(), settings, source_sha256: Object.fromEntries(Object.entries(sources).map(([name, item]) => [name, sha256(item.content)])),
  public_transactions_submitted: 0, cases: [], rejected: [], real_rows: [] };
let chain;
const scalar = (bytes, offset, input) => input.reduce((sum, value, i) => sum + value * BigInt(bytes.readInt8(offset + i)), 0n);
try {
  chain = await startOptimizedChain({ config: { stage: 0, chain_id: 143, endpoint_id: 30390, profile: 'monad' } });
  const probe = await chain.deploy(output.contracts['KernelProbe.sol'].KernelProbe, [], 'exact kernel test wrapper');
  const widths = [1, 2, 4, 5, 6, 7, 8, 9, 31, 32, 33, 63, 64, 65, 767, 768, 769, 3072];
  for (const width of widths) for (const mode of ['zero', 'int21_edges', 'int32_edges', 'outside_int21', 'deterministic_small']) {
    const input = Array.from({ length: width }, (_, i) => {
      if (mode === 'zero') return 0n;
      if (mode === 'int21_edges') return i % 2 ? 1048575n : -1048576n;
      if (mode === 'int32_edges') return i % 2 ? 2147483647n : -2147483648n;
      if (mode === 'outside_int21') return i % 2 ? 1048576n : -1048577n;
      return BigInt((i * 3907 + 181) % 32768 - 16384);
    });
    const data = Buffer.alloc(width + 11);
    for (let i = 0; i < width; i++) data.writeInt8((i * 73 + 19) % 256 - 128, i + 7);
    const expected = scalar(data, 7, input), args = ['0x' + data.toString('hex'), width, 7, input, 1];
    assert.equal((await chain.value(probe, 'baseline', args))[0], expected);
    assert.equal((await chain.value(probe, 'candidate', args))[0], expected);
    report.cases.push({ width, mode, output: expected.toString(), passed: true });
  }
  for (const [label, args] of [
    ['above_int32', ['0x01', 1, 0, [2147483648n], 1]],
    ['below_int32', ['0x01', 1, 0, [-2147483649n], 1]],
    ['short_row', ['0x01', 2, 0, [1n, 2n], 1]],
  ]) {
    for (const method of ['baseline', 'candidate']) await assert.rejects(() => chain.view(probe, method, args));
    report.rejected.push(label);
  }
  const dataDirectory = [path.join(HERE, 'data'), path.resolve(HERE, '../gpt2-bsc/data')].find(dir => fs.existsSync(path.join(dir, 'manifest.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'manifest.json')));
  const reference = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'reference-report.json'))).cases.find(item => item.id === 'eos').positions[0];
  for (const [id, inputName] of [[5, 'l00-ln1'], [8, 'l00-gelu']]) {
    const tensor = manifest.tensors[id], all = fs.readFileSync(path.join(dataDirectory, tensor.file));
    assert.equal(sha256(all), tensor.sha256);
    const descriptor = reference.stages[inputName], activation = fs.readFileSync(path.join(dataDirectory, descriptor.file));
    assert.equal(sha256(activation), descriptor.sha256);
    const x = Array.from({ length: descriptor.count }, (_, i) => BigInt(activation.readInt32BE(i * 4)));
    const count = 32, rows = all.subarray(0, tensor.row_bytes * count), args = ['0x' + rows.toString('hex'), tensor.row_bytes, 8, x, count];
    const expected = Array.from({ length: count }, (_, i) => scalar(rows, i * tensor.row_bytes + 8, x));
    const gas = {};
    for (const method of ['baseline', 'candidate']) {
      assert.deepEqual(Array.from(await chain.value(probe, method, args)), expected);
      const receipt = await chain.tx(probe, method, args); assert.equal(receipt.status, '0x1'); gas[method] = receipt.gasUsed;
    }
    report.real_rows.push({ tensor: id, width: tensor.width, count, ...gas, savings_percent: Number(gas.baseline - gas.candidate) / Number(gas.baseline) * 100 });
  }
  for (const name of ['GPT2DotOptimized.sol', 'GPT2DotOptimizedV2.sol']) assert.equal(sha256(fs.readFileSync(path.join(HERE, 'contracts', name))), report.source_sha256[name]);
  report.status = 'PASS_EXACT_KERNEL_DOMAIN_AND_REAL_ROWS';
} catch (error) { report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; throw error; }
finally { if (chain) await chain.stop(); fs.writeFileSync(path.join(directory, 'results.json'), json(report)); }
console.log(json({ status: report.status, exact_domain_cases: report.cases.length, rejected_cases: report.rejected.length, real_rows: report.real_rows }));
