'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { createRequire } = require('node:module');
const REPO = path.resolve(__dirname, '../../../../../..');
const req = createRequire(path.join(REPO, '../bridge/package.json'));
const CACHE = path.join(REPO, 'research/chess/l3/nitro/.cache/contracts-provenance');
const PIN = '4341b132cfbdcc980ead03765ca5224ff6cb5d97';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function tarEntry(archive, suffix) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8);
    if (name.endsWith(suffix)) return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Verified archive entry not found: ${suffix}`);
}
function compileReader() {
  const compilation = JSON.parse(fs.readFileSync(path.join(REPO, 'research/chess/l3/nitro/evidence/contract-source-compilation.json')));
  assert.equal(compilation.main.sourceCommit, PIN);
  const archive = fs.readFileSync(path.join(CACHE, 'git.tgz'));
  assert.equal(sha(archive), compilation.main.sourceArchive.sha256);
  const source = fs.readFileSync(path.join(CACHE, 'git', `nitro-contracts-${PIN}`, 'yul/Reader4844.yul'));
  assert.deepEqual(source, tarEntry(archive, '/yul/Reader4844.yul'));
  const compilerArchive = fs.readFileSync(path.join(CACHE, 'deps/solc/package.tgz'));
  const compilerRecord = compilation.npmDependencyArchives.find(v => v.package === 'solc' && v.version === '0.8.17');
  assert.equal(sha(compilerArchive), compilerRecord.tarballSha256);
  assert.equal(`sha512-${crypto.createHash('sha512').update(compilerArchive).digest('base64')}`, compilerRecord.integrity);
  const soljson = fs.readFileSync(path.join(CACHE, 'deps/solc/package/soljson.js'));
  assert.deepEqual(soljson, tarEntry(compilerArchive, '/soljson.js'));
  const solc = req('solc/wrapper')(require(path.join(CACHE, 'deps/solc/package/soljson.js')));
  assert.ok(solc.version().startsWith('0.8.17+'));
  const input = { language: 'Yul', sources: { 'Reader4844.yul': { content: source.toString() } }, settings: { optimizer: { enabled: true, runs: 2000 }, evmVersion: 'london', outputSelection: { '*': { '*': ['evm.bytecode', 'evm.deployedBytecode'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual((output.errors || []).filter(e => e.severity === 'error'), []);
  const generated = output.contracts['Reader4844.yul'].Reader4844;
  const interfaceFile = path.join(CACHE, 'compiled-main/build/contracts/src/libraries/IReader4844.sol/IReader4844.json');
  const interfaceBytes = fs.readFileSync(interfaceFile);
  assert.equal(sha(interfaceBytes), compilation.main.artifacts.find(v => v.path === 'src/libraries/IReader4844.sol/IReader4844.json').sha256);
  const artifact = { _format: 'hh-sol-artifact-1', contractName: 'Reader4844', sourceName: 'yul/Reader4844.yul', abi: JSON.parse(interfaceBytes).abi, bytecode: `0x${generated.evm.bytecode.object}`, deployedBytecode: `0x${generated.evm.deployedBytecode.object}`, linkReferences: {}, deployedLinkReferences: {}, provenance: { sourceCommit: PIN, sourceSha256: sha(source), archiveSha256: sha(archive), compiler: solc.version(), compilerArchiveSha256: sha(compilerArchive), compilerArchiveIntegrity: compilerRecord.integrity, settings: input.settings, sourceByteForByteMatchesVerifiedArchive: true, compilerSoljsonByteForByteMatchesVerifiedArchive: true, interfaceArtifactSha256: sha(interfaceBytes), inputSha256: sha(JSON.stringify(input)), rawOpcodes: { blobhash: '0x49', blobbasefee: '0x4a' }, note: 'Exact upstream Yul compiled with pinned foundry default compiler/optimizer/EVM settings; verbatim opcodes retain real EIP-4844 behavior despite London compiler target' } };
  fs.writeFileSync(path.join(__dirname, 'Reader4844.json'), JSON.stringify(artifact, null, 2) + '\n');
  return artifact;
}
if (require.main === module) {
  const a = compileReader();
  console.log(JSON.stringify({ status: 'EXACT_READER4844_YUL_COMPILED', compiler: a.provenance.compiler, creationBytes: (a.bytecode.length - 2) / 2, runtimeBytes: (a.deployedBytecode.length - 2) / 2, sourceSha256: a.provenance.sourceSha256 }));
}
module.exports = { compileReader };
