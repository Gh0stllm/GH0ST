import test from 'node:test';
import assert from 'node:assert/strict';
import { publicStateRequest } from '../scripts/quote-opbnb-posting.mjs';
const addr='0x'+'11'.repeat(20);
test('posting proxy accepts only bounded state arguments and numeric IDs',()=>{
  assert.deepEqual(publicStateRequest({id:1,method:'eth_getCode',params:[addr,'latest']}),{jsonrpc:'2.0',id:1,method:'eth_getCode',params:[addr,'latest']});
  assert.throws(()=>publicStateRequest({id:1,method:'eth_getCode',params:[addr,'latest','private-payload']}));
  assert.throws(()=>publicStateRequest({id:'arbitrary-data',method:'eth_chainId',params:[]}));
  assert.throws(()=>publicStateRequest({id:1,method:'eth_chainId',params:['arbitrary-data']}));
  assert.throws(()=>publicStateRequest({id:1,method:'eth_getProof',params:[addr,Array(65).fill('0x1'),'latest']}));
});
test('posting proxy rejects calls, signing and transaction submission',()=>{
  for(const method of ['eth_call','eth_estimateGas','eth_sendTransaction','eth_sendRawTransaction','eth_sign'])
    assert.throws(()=>publicStateRequest({id:1,method,params:[]}));
  assert.throws(()=>publicStateRequest({id:1,method:'eth_getStorageAt',params:[addr,'private-payload','latest']}));
  assert.throws(()=>publicStateRequest({id:1,method:'eth_getBlockByHash',params:['0x123',false]}));
});
