// Validate the local client's actual MonadTen storage-page behavior before using its gas results.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HERE, confinedOutput, sha256, json } from '../scripts/build.mjs';
import { startOptimizedChain } from './optimized-runtime.mjs';
const solc = createRequire(path.join(HERE, 'package.json'))('solc');
const source = `pragma solidity 0.8.30;
contract PageProbe {
 constructor() { assembly { sstore(0,1) sstore(1,2) sstore(128,3) } }
 function measure(uint256 a,uint256 b) external view returns(uint256 costA,uint256 costB,uint256 valueA,uint256 valueB) {
   assembly { let g := gas() valueA := sload(a) costA := sub(g,gas()) g := gas() valueB := sload(b) costB := sub(g,gas()) }
 }
}`;
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'PageProbe.sol': { content: source } }, settings: {
  optimizer: { enabled: false }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
} })));
assert(!(output.errors ?? []).some(error => error.severity === 'error'));
const artifact = output.contracts['PageProbe.sol'].PageProbe;
const directory = confinedOutput('reports/optimized-native-profile'); fs.mkdirSync(directory, { recursive: true });
const report = { status: 'RUNNING', probe_source_sha256: sha256(source), compiler: solc.version(), public_transactions_submitted: 0,
  observed: [], sources: ['https://docs.monad.xyz/developer-essentials/opcode-pricing', 'https://docs.monad.xyz/developer-essentials/gas-pricing'] };
let chain;
try {
  for (const profile of ['ethereum', 'monad']) {
    chain = await startOptimizedChain({ config: { stage: 0, chain_id: profile === 'monad' ? 143 : 56, endpoint_id: profile === 'monad' ? 30390 : 30102, profile } });
    const probe = await chain.deploy(artifact, [], 'opcode page probe');
    const same = await chain.view(probe, 'measure', [0, 1]), separate = await chain.view(probe, 'measure', [0, 128]);
    assert.equal(same[2], 1n); assert.equal(same[3], 2n); assert.equal(separate[3], 3n);
    if (profile === 'monad') {
      assert.equal(chain.environment.node_info?.hardFork, 'MonadTen');
      assert(same[0] >= 8000n && same[1] < 200n && separate[1] >= 8000n, 'Native client lacks expected 128-slot warm-page behavior');
    } else assert(same[0] >= 2000n && same[1] >= 2000n && separate[1] >= 2000n);
    report.observed.push({ profile, environment: chain.environment, same_page: { first: same[0], second: same[1] }, different_page: { first: separate[0], second: separate[1] } });
    await chain.stop(); chain = null;
  }
  report.status = 'PASS_NATIVE_MONAD_TEN_STORAGE_PAGE_PRICING';
} catch (error) { report.status = 'FAILED'; report.error = { message: error.message, stack: error.stack }; throw error; }
finally { if (chain) await chain.stop(); fs.writeFileSync(path.join(directory, 'results.json'), json(report)); }
console.log(json(report));
