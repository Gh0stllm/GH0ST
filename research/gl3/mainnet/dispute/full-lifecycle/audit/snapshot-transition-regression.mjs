// Read-only captured-snapshot regression. All execution stays on Runpod.
import fs from 'node:fs';import assert from 'node:assert/strict';import {verifyTerminalTransition} from './terminal-transition.mjs';
assert.equal(process.platform,'linux');
const source='/root/full-lifecycle-audit/strict-current',manifestPath='/root/full-lifecycle/evidence/terminal-input-manifest.json',out=new URL('./captured-transition-regression.json',import.meta.url);
const save=x=>fs.writeFileSync(out,JSON.stringify(x,null,2)+'\n'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
while(true){
 try{
  const report=JSON.parse(fs.readFileSync(source+'/strict-audit.json')),states=JSON.parse(fs.readFileSync(source+'/edge-state-snapshot.json')).edges,manifest=JSON.parse(fs.readFileSync(manifestPath));
  const proof=report.boundOneStepEvents?.[0];
  if(!proof){save({passed:false,classification:'PENDING_REAL_ONE_STEP_PATH',scope:'No on-chain challenge proof is substituted by a synthetic positive fixture',asOfUTC:new Date().toISOString()});if(process.argv.includes('--watch')){await sleep(1000);continue;}break;}
  const input={manifest,proof,states,claims:report.claims,honestAssertionHash:report.pair.honest},binding=verifyTerminalTransition(input);
  const first=proof.path.find(x=>x.kind==='subchallenge-claim'),bad=structuredClone(input);bad.states[first.from].startHeight=String(Number(binding.startHeight)+1);bad.states[first.from].endHeight=String(Number(binding.endHeight)+1);
  assert.throws(()=>verifyTerminalTransition(bad),/different terminal transition/);
  save({passed:true,classification:'REAL_CAPTURED_PATH_POSITIVE_AND_WRONG_INTERVAL_NEGATIVE',binding,oneStepEdge:proof.edge,oneStepTransaction:proof.transaction,wrongIntervalRejected:true,syntheticOneStep:false,scope:'Transition-boundary regression over the actual captured one-step ancestry; not separate full lifecycle acceptance',allExecutionOnRunpod:true,asOfUTC:new Date().toISOString()});break;
 }catch(e){save({passed:false,classification:'FAILED_CAPTURED_PATH_REGRESSION',error:String(e),stack:e.stack,asOfUTC:new Date().toISOString()});process.exitCode=1;break;}
}
