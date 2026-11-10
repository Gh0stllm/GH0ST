import { compile } from './lib.mjs';
const { manifest } = compile();
console.log(`Compiled ${Object.keys(manifest.contracts).length} contracts; results/v2/compile-report.json`);
