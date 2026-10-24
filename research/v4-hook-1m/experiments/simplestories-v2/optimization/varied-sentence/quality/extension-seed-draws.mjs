// Reproduce disjoint global-seed draws without repeating ABI encoding per hash.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbiCoder, keccak256, toBeHex, zeroPadValue } from 'ethers';
const start = 262144, end = 393216, steps = 5;
const coder = AbiCoder.defaultAbiCoder();
const encoded = Buffer.from(coder.encode(['string', 'bytes32', 'uint256'],
  ['GH0ST_SAMPLE_STEP_V1', zeroPadValue('0x00', 32), 0]).slice(2), 'hex');
const output = Buffer.alloc((end - start) * steps * 32);
let cursor = 0;
for (let seed = start; seed < end; seed++) {
  encoded.writeBigUInt64BE(BigInt(seed), 56);
  for (let step = 0; step < steps; step++) {
    encoded.writeBigUInt64BE(BigInt(step), 88);
    const hash = keccak256(encoded);
    if ((seed === start || seed === end - 1) && (step === 0 || step === steps - 1)) {
      const reference = keccak256(coder.encode(['string', 'bytes32', 'uint256'],
        ['GH0ST_SAMPLE_STEP_V1', zeroPadValue(toBeHex(seed), 32), step]));
      if (hash !== reference) throw Error('ABI boundary check failed');
    }
    Buffer.from(hash.slice(2), 'hex').copy(output, cursor); cursor += 32;
  }
}
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extension-seed-draws-262144-393216x5.bin');
fs.writeFileSync(file, output);
console.log(JSON.stringify({ start, endExclusive: end, steps, bytes: output.length, keccak: keccak256(output), abiBoundaryChecks: 4 }));
