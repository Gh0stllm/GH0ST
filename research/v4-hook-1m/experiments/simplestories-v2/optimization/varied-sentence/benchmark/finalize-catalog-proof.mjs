// Combine completed local-EVM proofs; no network or chain operations.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const bytes=p=>readFileSync(path.resolve(HERE,p));
const read=p=>JSON.parse(bytes(p));
const sha=data=>createHash('sha256').update(data).digest('hex');
const baseline=read('catalog-10000-evm.json'),additional=read('catalog-v2-additions-evm.json');
const base=read('../quality/catalog-10000.json'),delta=read('../quality/catalog-v2-additions.json'),catalog=read('../quality/catalog-v2-10000.json');
assert.equal(baseline.status,'PASS');assert.equal(additional.status,'PASS');
assert.equal(baseline.catalogSha256,sha(bytes('../quality/catalog-10000.json')));
assert.equal(additional.catalogSha256,sha(bytes('../quality/catalog-v2-additions.json')));
for(const field of ['sourceSha256','artifactSha256','modelCallGasLimit','modelHash','modelRuntimeHash'])assert.equal(baseline[field],additional[field]);
assert.equal(catalog.length,10000);assert.equal(baseline.passed,base.length);assert.equal(additional.passed,delta.length);
const same=(a,b)=>JSON.stringify([a.prompt_ids,a.top_k,a.temperature_milli,a.tokens,a.text])===JSON.stringify([b.prompt_ids,b.top_k,b.temperature_milli,b.tokens,b.text]);
const oldRows=new Map(base.map(r=>[r.seed,r])),newRows=new Map(delta.map(r=>[r.seed,r]));
const evidence=name=>new Map(bytes(name).toString().trim().split('\n').map(line=>JSON.parse(line)).map(r=>[r.seed,r]));
const oldEvidence=evidence('catalog-10000-evm.jsonl'),newEvidence=evidence('catalog-v2-additions-evm.jsonl');
const keys=new Set(),proof=[];
for(const row of catalog){
  const key=row.text.toLowerCase().replace(/[.!?]+$/,'').trim().replace(/\s+/g,' ');assert(!keys.has(key));keys.add(key);
  const reused=oldRows.has(row.seed)&&same(oldRows.get(row.seed),row);
  assert(reused||(newRows.has(row.seed)&&same(newRows.get(row.seed),row)));
  const entry=(reused?oldEvidence:newEvidence).get(row.seed);assert.equal(entry?.passed,true);
  proof.push({...entry,source:reused?'catalog-10000-evm.jsonl':'catalog-v2-additions-evm.jsonl'});
}
const evidencePath=path.join(HERE,'catalog-v2-10000-evm.jsonl');
writeFileSync(evidencePath,proof.map(row=>JSON.stringify(row)).join('\n')+'\n');
const report={status:'PASS',scope:'10,000 distinct word sequences, each reproduced in a bounded local EVM model call. This combines exact unchanged rows from the full baseline and 32 replacement rows from a second isolated local run; it is not 10,000 swap transactions.',
  catalogSha256:sha(bytes('../quality/catalog-v2-10000.json')),sourceSha256:baseline.sourceSha256,artifactSha256:baseline.artifactSha256,modelRuntimeHash:baseline.modelRuntimeHash,
  modelCallGasLimit:baseline.modelCallGasLimit,checked:catalog.length,passed:proof.length,reusedBaselineRows:proof.filter(r=>r.source==='catalog-10000-evm.jsonl').length,
  newlyCheckedRows:proof.filter(r=>r.source==='catalog-v2-additions-evm.jsonl').length,
  baselineReportSha256:sha(bytes('catalog-10000-evm.json')),additionalReportSha256:sha(bytes('catalog-v2-additions-evm.json')),evidenceSha256:sha(readFileSync(evidencePath)),
  sourceReports:['catalog-10000-evm.json','catalog-v2-additions-evm.json'],publicTransactionsSubmitted:0,completedAt:new Date().toISOString()};
writeFileSync(path.join(HERE,'catalog-v2-10000-evm.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
