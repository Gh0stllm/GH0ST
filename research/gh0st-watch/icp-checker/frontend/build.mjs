import fs from 'node:fs';
import { build } from 'esbuild';
import solc from 'solc';
const input={language:'Solidity',sources:{'Probe.sol':{content:fs.readFileSync('Probe.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['evm.bytecode.object']}}}};
const result=JSON.parse(solc.compile(JSON.stringify(input)));
if(result.errors?.some(e=>e.severity==='error')) throw Error(JSON.stringify(result.errors));
const probe='0x'+result.contracts['Probe.sol'].Probe.evm.bytecode.object;
await build({entryPoints:['app.js'],bundle:true,format:'esm',target:'es2022',minify:true,legalComments:'none',outfile:'dist/watch.js',define:{__PROBE__:JSON.stringify(probe)}});

// Certify one same-origin stylesheet, including the interactive report instruments.
fs.writeFileSync('dist/watch.css', ['watch.css','score.css','bundles.css','time-machine.css'].map(name=>fs.readFileSync(name,'utf8')).join('\n'));
