import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import solc from 'solc';

export async function buildSharedWorker(entryPoint,outfile) {
  // Use the same source and compiler settings as the browser's eth_call probe.
  const content=await readFile(new URL('./Probe.sol',import.meta.url),'utf8');
  const input={language:'Solidity',sources:{'Probe.sol':{content}},settings:{optimizer:{enabled:true,runs:200},
    evmVersion:'paris',outputSelection:{'*':{'*':['evm.bytecode.object']}}}};
  const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
  const errors=compiled.errors?.filter(error=>error.severity==='error');
  if (errors?.length) throw new Error(errors.map(error=>error.formattedMessage).join('\n'));
  const probe='0x'+compiled.contracts['Probe.sol'].Probe.evm.bytecode.object;
  await build({entryPoints:[resolve(entryPoint)],outfile:resolve(outfile),bundle:true,platform:'node',format:'esm',
    target:'node22',minify:true,legalComments:'none',define:{__PROBE__:JSON.stringify(probe)},
    banner:{js:"import {createRequire as createWorkerRequire} from 'node:module';const require=createWorkerRequire(import.meta.url);"}});
}
