import test from 'node:test';
import assert from 'node:assert/strict';
import {rankedBaseTokens} from './discover.js';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const asset=(address,symbol)=>({type:'token',id:'robinhood_'+address,attributes:{address,symbol}});
const pool=(token,name,volume)=>({type:'pool',attributes:{name,volume_usd:{h24:volume}},relationships:{base_token:{data:{id:token.id}}}});

test('highest-ranked pool supplies the metric; duplicate addresses do not crowd out other coins',()=>{
  const first=asset(address(10),'SAME'),duplicate=asset(address(10).toUpperCase().replace('0X','0x'),'SAME');
  const others=Array.from({length:9},(_,i)=>asset(address(i+11),'SAME'));
  const tokens=rankedBaseTokens({included:[first,duplicate,...others],data:[pool(first,'First / ETH','100'),pool(duplicate,'Later / USDC','999'),...others.map(x=>pool(x,'Other / ETH','1'))]}).tokens;
  assert.equal(tokens.length,6);
  assert.equal(new Set(tokens.map(x=>x.address.toLowerCase())).size,6);
  assert.equal(tokens[0].name,'First / ETH');
  assert.match(tokens[0].metric,/\$100 pool vol/);
  assert.equal(tokens[1].address.toLowerCase(),address(11));
});
