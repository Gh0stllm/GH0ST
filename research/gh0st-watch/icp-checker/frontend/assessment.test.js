import test from 'node:test';
import assert from 'node:assert/strict';
import {assess} from './assessment.js';

const base = {erc20:true,verified:true,rules:[
  {title:'Mint',status:'Untested'}, {title:'Burn',status:'Not reproduced'}]};
const item = (report, label) => report.items.find(card => card.label === label);

test('an unavailable receipt is distinct from a checked receipt with zero matched swaps', () => {
  const missing = assess(base, null);
  const sample = assess(base, {origin:{bundle:{early:{checked:1, matches:0, max:0, origin:100, end:109}}}, token:{top:'0.00%',count:1}});
  assert.equal(missing.title, 'Partial behavior coverage');
  assert.equal(item(missing,'Launch activity').value, 'Unknown');
  assert.equal(item(sample,'Launch activity').value, 'No matched swaps');
  assert.equal(item(sample,'Holder concentration').value, '0.00%');
});

test('factory-only launches are not attributed to the sending wallet', () => {
  const r=assess(base, {origin:{history:{items:[{kind:'Factory creation · wallet unknown'}],direct:50,internal:50}}});
  assert.equal(item(r,'Deployer history').value,'Factory activity only');
});

test('positive headline retains replay scope and missing coverage never becomes an all-clear', () => {
  const allMissing=assess({...base,rules:[{title:'Mint',status:'Untested'}]});
  assert.equal(allMissing.title,'Behavior untested');
  const finding=assess({...base,rules:[{title:'Mint',status:'Reproduced',scope:'Fresh ICP deployment'}]});
  assert.match(finding.description,/Fresh ICP deployment/);
  assert.equal(item(finding,'Behavior checks').tone,'attention');
});
