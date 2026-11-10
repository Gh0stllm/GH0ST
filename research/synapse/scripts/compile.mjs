import { compile } from './lib.mjs';
const { manifest } = compile();
console.log(`Compiled ${Object.keys(manifest.contracts).length} contracts with solc ${manifest.versions.solc}; report: results/compile-report.json`);
