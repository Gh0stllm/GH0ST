'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const solc = require('solc');
const { BrowserProvider, ContractFactory, keccak256, getBytes, id } = require('ethers');
const ganache = require('ganache');
const { parse, evaluate, compileRule } = require('./compiler.cjs');

// A row makes 256 actual EVM STATICCALLs to the same deployed selector and returns all answers verbatim.
const harnessSource = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract Reader {
    function row(address target, uint8 qty) external view returns (bytes memory out) {
        bytes4 selector = bytes4(keccak256("quote(uint8,uint8)"));
        out = new bytes(1024);
        assembly ("memory-safe") {
            let buf := mload(0x40)
            mstore(0x40, add(buf, 96))
            mstore(buf, selector)
            mstore(add(buf, 4), qty)
            for { let tier := 0 } lt(tier, 256) { tier := add(tier, 1) } {
                mstore(add(buf, 36), tier)
                if iszero(staticcall(gas(), target, buf, 68, 0, 32)) { revert(0, 0) }
                if iszero(eq(returndatasize(),32)) { revert(0, 0) }
                let v := mload(0)
                if gt(v, 0xffffffff) { revert(0, 0) }
                let end := add(add(out, 36), mul(tier, 4))
                mstore8(sub(end, 4), shr(24, v))
                mstore8(sub(end, 3), shr(16, v))
                mstore8(sub(end, 2), shr(8, v))
                mstore8(sub(end, 1), v)
            }
        }
    }
}`;

function harness() {
  const output = JSON.parse(solc.compile(JSON.stringify({language: 'Solidity',
    sources: {'Reader.sol':{content:harnessSource}}, settings: { evmVersion:'shanghai',
      optimizer:{enabled:true,runs:200}, outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
  assert(!(output.errors || []).some(e => e.severity === 'error'), 'Row reader failed to compile');
  return output.contracts['Reader.sol'].Reader;
}

const sha256 = b => createHash('sha256').update(b).digest('hex');
async function verify(dir, ruleFile, proofFile) {
  const rule = fs.readFileSync(ruleFile, 'utf8');
  const ast = parse(rule);
  const artifact = JSON.parse(fs.readFileSync(path.join(dir, 'artifact.json'), 'utf8'));
  assert.deepEqual(artifact, compileRule(rule), 'Artifact differs from deterministic rebuild');
  assert.equal(fs.readFileSync(path.join(dir,'Quote.sol'), 'utf8'), artifact.solidity);
  assert.equal(fs.readFileSync(path.join(dir,'quote.mjs'), 'utf8'), artifact.javascript);
  const { quote } = await import(pathToFileURL(path.join(dir, 'quote.mjs')));
  for (const bad of [-1,256,1.1,NaN,'1',null,undefined,Infinity]) {
    assert.throws(() => quote(bad,1), RangeError);
    assert.throws(() => quote(0,bad), RangeError);
  }
  const instance = ganache.provider({chain:{hardfork:'shanghai', chainId:1337},
    logging:{quiet:true}, wallet:{deterministic:true, totalAccounts:1}});
  try {
    const provider = new BrowserProvider(instance);
    provider.pollingInterval = 10;
    const signer = await provider.getSigner();
    const compiledReader = harness();
    const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
    await deployed.waitForDeployment();
    const target = await deployed.getAddress();
    assert.equal(await provider.getCode(target), artifact.deployedBytecode);
    const reader = await new ContractFactory(compiledReader.abi,
      '0x' + compiledReader.evm.bytecode.object, signer).deploy();
    await reader.waitForDeployment();
    const sums = Object.fromEntries(['reference','app','evm'].map(k=>[k,createHash('sha256')]));
    const knownPricing = rule.trim() === '(qty * 100) * (if tier == 1 then 95 else if tier == 2 then 90 else 100) / 100';
    let compared = 0;
    for (let q=0; q<256; q++) {
      const bytes = Buffer.from(getBytes(await reader.row(target, q)));
      assert.equal(bytes.length, 1024);
      const reference = Buffer.alloc(1024), app = Buffer.alloc(1024);
      for (let tier=0; tier<256; tier++) {
        const value = evaluate(ast,q,tier);
        if (knownPricing) assert.equal(value, q * (tier === 1 ? 95 : tier === 2 ? 90 : 100));
        const jsValue = quote(q,tier);
        assert.equal(jsValue, value, 'JavaScript mismatch at '+q+','+tier);
        assert.equal(bytes.readUInt32BE(tier*4), value, 'EVM mismatch at '+q+','+tier);
        reference.writeUInt32BE(value,tier*4);
        app.writeUInt32BE(jsValue,tier*4);
        compared++;
      }
      sums.reference.update(reference);
      sums.app.update(app);
      sums.evm.update(bytes);
    }
    const proof = {
      kind:'finite-domain-exhaustive-execution', network:'local Ganache EVM, Shanghai', chainId:1337,
      compiler:artifact.solc, sourceSha256:artifact.sourceSha256,
      javascriptSha256:sha256(artifact.javascript), soliditySha256:sha256(artifact.solidity),
      runtimeKeccak256:keccak256(artifact.deployedBytecode), readerSourceSha256:sha256(harnessSource),
      domain:'qty=0..255, tier=0..255; unsigned inputs', checkedPairs:compared,
      selector:id('quote(uint8,uint8)').slice(0,10),
      digestOrder:'qty ascending, then tier ascending; 4-byte big-endian unsigned outputs',
      outputSha256:Object.fromEntries(Object.entries(sums).map(([k,h])=>[k,h.digest('hex')])),
      independentPricingFormula:knownPricing, matched:true,
      examples: [[0,1],[3,1],[10,2],[255,0],[255,255]].map(([q,t])=>({qty:q,tier:t,cents:quote(q,t)}))
    };
    fs.writeFileSync(proofFile,JSON.stringify(proof,null,2)+'\n');
    return proof;
  } finally { await instance.disconnect(); }
}

module.exports = { verify };
if (require.main === module) {
  const dir = path.resolve(process.argv[2] || __dirname);
  verify(dir, process.argv[3] || path.join(dir,'quote.rule'), process.argv[4] || path.join(dir,'proof.json'))
    .then(proof=>console.log(JSON.stringify(proof,null,2)))
    .catch(error=>{ console.error(error);process.exitCode=1; });
}
