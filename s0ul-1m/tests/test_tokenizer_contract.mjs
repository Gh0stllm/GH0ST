import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';

const base = fileURLToPath(new URL('../', import.meta.url));
const vectors = JSON.parse(readFileSync(`${base}tests/fixtures/tokenizer-vectors.json`, 'utf8'));
const sources = Object.fromEntries(['S0ULTypes.sol', 'S0ULTokenizer.sol'].map(name =>
  [name, { content: readFileSync(`${base}contracts/${name}`, 'utf8') }]));
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
})));
const errors = (output.errors ?? []).filter(error => error.severity === 'error');
assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'));
const artifact = output.contracts['S0ULTokenizer.sol'].S0ULTokenizer;
assert.ok(artifact.evm.deployedBytecode.object.length / 2 <= 24576, 'portable EIP-170 code size');

let rpc, provider, tokenizer;
before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
    miner: { blockGasLimit: 60_000_000 }, wallet: { deterministic: true } });
  provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const signer = await provider.getSigner();
  tokenizer = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
  await tokenizer.waitForDeployment();
});
after(async () => { await provider?.destroy(); await rpc?.disconnect(); });

test('frozen domain specification and portable code size', async () => {
  assert.equal(await tokenizer.domainSha256(), '0x' + vectors.domain_sha256);
  assert.equal(await tokenizer.DOMAIN_COUNT(), BigInt(vectors.domain_count));
});

test('exact Python token IDs for ordinary text, controls, overlaps and UTF-8', async () => {
  for (const vector of vectors.encode) {
    const ids = Array.from(await tokenizer.encode(vector.text), Number);
    assert.deepEqual(ids, vector.ids, JSON.stringify(vector.text));
    assert.ok(ids.every(id => id >= 4 && id < 512), 'ordinary text never injects control IDs');
    assert.equal(await tokenizer.decode(ids, true), vector.utf8_hex);
  }
});

test('decoding preserves raw bytes and displays control/reserved markers', async () => {
  for (const vector of vectors.decode) {
    assert.equal(await tokenizer.decode(vector.ids, vector.skip_special), vector.bytes_hex);
  }
});

test('bounds reject oversized inputs and out-of-vocabulary IDs without truncating', async () => {
  const ids = await tokenizer.encode('z'.repeat(4096));
  assert.equal(ids.length, 4096);
  assert.equal(await tokenizer.decode([0, 1, 2, 3], true), '0x');
  assert.equal(await tokenizer.decode([], false), '0x');
  await assert.rejects(tokenizer.encode('z'.repeat(4097)));
  await assert.rejects(tokenizer.decode(Array(4097).fill(4), false));
  await assert.rejects(tokenizer.decode([512], false));
});

test('report actual local tokenizer gas for a representative command', async () => {
  const text = 'Check my ETH balance.';
  const encoded = await tokenizer.encode(text);
  console.log(JSON.stringify({
    tokenizer_runtime_bytes: artifact.evm.deployedBytecode.object.length / 2,
    prompt: text, prompt_tokens: encoded.length,
    local_encode_call_gas: String(await tokenizer.encode.estimateGas(text)),
    local_decode_call_gas: String(await tokenizer.decode.estimateGas(Array.from(encoded), true)),
  }));
});
