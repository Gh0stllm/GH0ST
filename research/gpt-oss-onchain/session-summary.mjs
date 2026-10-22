import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const SHA=b=>crypto.createHash('sha256').update(b).digest('hex');
const items=[
 ['optimization-session','OptimizedMxfp4.sol','winner_source_sha256'],
 ['helper-experiments','HelperMxfp4.sol','source_sha256'],
 ['batching-experiments','BatchMxfp4.sol','source_sha256'],
 ['lane-experiments','LaneMxfp4.sol','source_sha256'],
 ['lane-v2-experiments','LaneMxfp4V2.sol','source_sha256'],
 ['lane-cache-experiments','CachedLaneMxfp4.sol','source_sha256'],
 ['nine-lane-experiments','NineLaneMxfp4.sol','source_sha256'],
 ['nine-lane-cache-experiments','CachedNineLaneMxfp4.sol','source_sha256'],
 ['lane-helper-experiments','HelperLaneMxfp4.sol','source_sha256'],
 ['nine-lane-helper-experiments','HelperNineLaneMxfp4.sol','source_sha256'],
 ['state-experiments','VectorState.sol','source_sha256'],
 ['router-experiments','RouterTop4.sol','source_sha256'],
 ['code-path-validation','HelperLaneMxfp4.sol','source_sha256'],
];
const reports=items.map(([name,source,field])=>{
 const report=JSON.parse(fs.readFileSync(ROOT+'evidence/'+name+'.json','utf8'));
 const actual=SHA(fs.readFileSync(ROOT+source));
 assert.equal(actual,report[field],`${name}: source hash mismatch`);
 return {name,source,source_sha256:actual,status:report.status,
  cases:report.validation.cases??report.validation.roundtrips??0,
  fuzz_cases:report.validation.fuzz_cases??0,
  configurations:report.candidates?.length??0,
  passed_configurations:report.candidates?.filter(x=>x.status==='PASS').length??0,
  invalid_rejections:report.validation.invalid_rejections??0,
  raw:report};
});
const total=reports.reduce((sum,r)=>sum+r.cases,0);
if(process.argv.includes('--progress')){
 console.log(JSON.stringify({now:new Date().toISOString(),cases:total,reports:reports.map(({raw,...r})=>r)},null,2));
 process.exit(0);
}
for(const r of reports)assert(r.status.startsWith('PASS'),`${r.name} is not complete`);
const failed=fs.readdirSync(ROOT+'evidence').filter(n=>n.endsWith('failure.json'));
assert.equal(failed.length,0,'Failure artifacts require investigation: '+failed.join(','));
const baselinePins={
 'Mxfp4Kernel.sol':'4e36e51cbd4588c56884d491b84cceabf99cb2d9',
 'benchmark.mjs':'98efe5ffba3376a54f92cb466cf1f3fc6d4027a0',
 'evidence/synthetic-benchmark.json':'8521b04586284b4faf35e8e95a4b7344bf7f3f7f'};
for(const [path,pin] of Object.entries(baselinePins)){
 const bytes=fs.readFileSync(ROOT+path);
 const blob=crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 assert.equal(blob,pin,'Published baseline changed: '+path);
}
const dense=name=>reports.find(r=>r.name===name).raw.benchmarks.find(b=>b.kind==='dense');
const priorRow=dense('lane-v2-experiments');
const prior=priorRow.previous_scalar_transactions_gas??priorRow.previous_eight_transactions_gas;
const eight=dense('lane-helper-experiments'),nine=dense('nine-lane-experiments');
const storage=reports.find(r=>r.name==='state-experiments').raw.benchmarks.find(b=>b.values===2880);
const router=reports.find(r=>r.name==='router-experiments').raw.benchmarks.find(b=>b.kind==='random');
const validation={status:'PASS_SYNTHETIC_COMPONENT_RESEARCH',validated_at:new Date().toISOString(),
session_started_at:'2026-10-22T17:08:48.000Z',
source_hashes_match:true,published_initial_baseline_unchanged:true,
recorded_validation_cases_across_prototypes:total,
distinct_storage_bit_patterns:reports.find(r=>r.name==='state-experiments').raw.validation.distinct_16bit_patterns,
compiler_layout_configurations:reports.reduce((s,r)=>s+r.configurations,0),
passed_compiler_layout_configurations:reports.reduce((s,r)=>s+r.passed_configurations,0),
results:{eight_row_dense:{rows:8,columns:2880,previous_eight_transactions_gas:prior,
 calldata_gas:eight.tile_calldata.gas,predeployed_code_gas:eight.tile_code.gas,
 reduction_vs_previous_percent:100*(prior-eight.tile_code.gas)/prior,
 weight_code_deployment_gas:eight.store.deployment_gas,
 amortization_calls_vs_new_calldata:Math.ceil(eight.store.deployment_gas/(eight.tile_calldata.gas-eight.tile_code.gas))},
 lane_comparison:{eight_gas_per_output:eight.tile_code.gas/8,nine_gas_per_output:nine.tile_code.gas/9,
 selection:'eight-row helper/cached polynomial implementation'},
 storage_2880_values:storage,
 integer_top4:router},
reports:reports.map(({raw,...r})=>r),
limitations:['Synthetic weights, integer activations and router scores only.',
 'Full GPT-OSS inference, actual model output fidelity and quality remain untested.',
 'All gas receipts are local Shanghai EVM, not Robinhood mainnet fees.',
 'Per-call predeployed-code gas excludes one-time data and engine deployment.',
 'Storage format preserves existing 16-bit values only; it is not a quantizer for arbitrary wider state.',
 'Validation case counts aggregate repeated cases across separate implementations; they are not unique model prompts.']};
fs.writeFileSync(ROOT+'evidence/hour-session-validation.json',JSON.stringify(validation,null,2)+'\n');
console.log(JSON.stringify(validation,null,2));
