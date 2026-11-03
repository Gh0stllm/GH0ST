import assert from 'node:assert/strict';
import test from 'node:test';
import {scoreReport,scoreScenario} from './score.js';
const keys=['mint','underflow','withdraw','authorization','replay','token'];
const scan=(outcomes,erc20=true)=>({erc20,rules:keys.map((key,i)=>({key,status:outcomes[i]??'Untested',scope:'RH state simulation',detail:'Execution observation.'}))});

test('missing evidence yields no score and preserves the whole range',()=>{
  const m=scoreReport(scan([]),{token:{top:null,count:0}});
  assert.equal(m.score,null);assert.equal(m.coverage,0);assert.equal(m.lower,0);assert.equal(m.upper,100);
  assert(m.factors.every(f=>f.points===null));
});
test('observed score, coverage and full-evidence range have distinct denominators',()=>{
  const m=scoreReport(scan(['Not reproduced']),{token:{top:'50.00%',count:10}});
  assert.equal(m.earned,5);assert.equal(m.assessed,25);assert.equal(m.score,20);assert.equal(m.coverage,25);
  assert.equal(m.lower,5);assert.equal(m.upper,80);
});
test('non-token scoring omits holder weight, explicit zero remains measured, malformed percentages stay unknown',()=>{
  const non=scoreReport(scan(Array(6).fill('Reproduced'),false));assert.equal(non.possible,90);assert.equal(non.score,100);assert.equal(non.coverage,100);
  const known=scoreReport(scan(Array(6).fill('Not reproduced')),{token:{top:'25.50%',count:10}});
  assert.equal(known.score,3);assert.equal(known.lower,known.upper);
  assert.equal(scoreReport(scan([]),{token:{top:'0.00%',count:10}}).score,0);
  assert.equal(scoreReport(scan([]),{token:{top:'123.00%',count:10}}).score,null);
});
test('counterfactual changes only a copy and can reintroduce uncertainty',()=>{
  const m=scoreReport(scan(['Not reproduced'],false));const what=scoreScenario(m,'mint',100);
  assert.equal(what.score,100);assert.equal(m.score,0);assert.equal(scoreScenario(what,'mint',null).score,null);
  assert.throws(()=>scoreScenario(m,'mint',35),RangeError);
});
