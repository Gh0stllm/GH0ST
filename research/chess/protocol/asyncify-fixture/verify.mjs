import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const bytes = fs.readFileSync(path.join(root, 'build/fixture.asyncify.wasm'));
const compiled = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(compiled);
if (imports.length) throw new Error(`Unexpected imports: ${JSON.stringify(imports)}`);
const instantiate = async () => (await WebAssembly.instantiate(compiled)).exports;
const snapshot = e => ({result: String(e.get_result()), starts:e.get_starts(), constructors:e.get_constructors(),
  destructors:e.get_destructors(), callbacks:e.get_callbacks(), steps:e.get_steps(), mode:e.get_mode()});
const report = {scope:'Independent Node WebAssembly exact-stack fixture; not ICP execution, Stockfish, paid gameplay or a public deployment',
  wasmSha256:crypto.createHash('sha256').update(bytes).digest('hex'), wasmBytes:bytes.length, imports, tests:[]};
for (const seed of [1, 17, 0x7fffffff]) {
  const base = await instantiate();
  if (base.begin(seed, 0, 1) !== 0) throw new Error('Reference unexpectedly yielded');
  const expected = snapshot(base);
  for (const quantum of [1, 7, 100]) {
    const e = await instantiate();
    let pending = e.begin(seed, quantum, 1), messages = 1;
    while (pending) {
      e.host_churn(messages * 3);
      pending = e.advance();
      if (++messages > 3000) throw new Error('Continuation did not finish');
    }
    const actual = snapshot(e);
    for (const key of ['result','starts','constructors','destructors','callbacks','mode']) {
      if (actual[key] !== expected[key]) throw new Error(`Mismatch ${key}: ${JSON.stringify({actual,expected})}`);
    }
    if (actual.starts !== 1 || actual.constructors !== actual.destructors) throw new Error('Lifetime mismatch');
    report.tests.push({seed, quantum, messages, ...actual});
  }
}
let negativeDetected = false;
try {
  const e = await instantiate();
  let pending = e.begin(1, 1, 0), step = 1;
  while (pending && step < 3000) { e.host_churn(step++); pending = e.advance(); }
  negativeDetected = e.get_starts() !== 1 || e.get_constructors() !== e.get_destructors();
} catch (error) { negativeDetected = error instanceof WebAssembly.RuntimeError; }
if (!negativeDetected) throw new Error('Unsafe shared-stack negative control was not detected');
report.unsafeSharedStackNegativeControlDetected = true;
report.passed = true;
fs.writeFileSync(path.join(root, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
