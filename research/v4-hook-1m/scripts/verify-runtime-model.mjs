import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? 'swap-speaker-535k/model');
const read = name => readFileSync(path.join(directory, name));
const manifest = JSON.parse(read('manifest.json'));
const expected = {
  'core.bin': 4544,
  'embeddings.bin': 524352,
  'nodes.bin': 540606,
  'vocabulary.bin': 262144,
};
const hashes = {};
for (const [name, size] of Object.entries(expected)) {
  const bytes = read(name);
  assert.equal(bytes.length, size, `${name}: unexpected tensor size`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, manifest.artifacts[name].sha256, `${name}: manifest hash mismatch`);
  assert.equal(bytes.length, manifest.artifacts[name].bytes, `${name}: manifest size mismatch`);
  hashes[name] = digest;
}
assert.equal(manifest.parameters, 534751);
const vocabulary = JSON.parse(read('vocabulary.json'));
assert.equal(vocabulary.length, 8192);
assert.equal(new Set(vocabulary).size, vocabulary.length);
const packed = read('vocabulary.bin');
for (const [index, word] of vocabulary.entries()) {
  assert.match(word, /^[A-Za-z]+(?:'[A-Za-z]+)?[.!?]?$/, `Invalid vocabulary entry ${index}`);
  assert.ok(Buffer.byteLength(word) <= 32, `Vocabulary entry ${index} exceeds its slot`);
  const slot = Buffer.alloc(32);
  slot.write(word);
  assert.deepEqual(packed.subarray(index * 32, (index + 1) * 32), slot,
    `Packed vocabulary differs at entry ${index}`);
}
console.log(JSON.stringify({ status: 'PASS', directory, parameters: manifest.parameters,
  vocabulary: vocabulary.length, runtimeHashes: hashes }, null, 2));
