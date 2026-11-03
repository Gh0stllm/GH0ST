import test from 'node:test';
import assert from 'node:assert/strict';
import {addressLine,repositoryPath,checkReadme} from './claims.js';
const address='0x'+'0a'.repeat(20);

test('only a GitHub repository homepage can select a network target',()=>{
  assert.equal(repositoryPath('https://github.com/Example-Org/Contract.git/'),'Example-Org/Contract');
  for(const url of ['https://github.com.evil.test/a/b','https://github.com@evil.test/a/b','https://evil@github.com/a/b','https://github.com/a/b/tree/main','https://github.com:333/a/b','https://github.com/a/b#file'])
    assert.throws(()=>repositoryPath(url));
});

test('address match must be a complete token and preserves README line evidence',()=>{
  assert.equal(addressLine('Neither x'+address+' nor '+address+'ff',address),null);
  assert.equal(addressLine('This deployment:\n`'+address.toUpperCase()+'`',address),2);
});

test('readme lookup and evidence link refer to the same immutable commit',async t=>{
  const sha='e'.repeat(40), md='Address\n'+address;
  const responses=[{default_branch:'release/main'},{object:{type:'commit',sha}},{type:'file',encoding:'base64',size:md.length,path:'docs/README.md',content:btoa(md)}];
  const urls=[];
  t.mock.method(globalThis,'fetch',async url=>{urls.push(url);return new Response(JSON.stringify(responses.shift()));});
  const result=await checkReadme('https://github.com/test/project',address);
  assert.deepEqual(urls,['https://api.github.com/repos/test/project','https://api.github.com/repos/test/project/git/ref/heads/release/main','https://api.github.com/repos/test/project/readme?ref='+sha]);
  assert.equal(result.permalink,'https://github.com/test/project/blob/'+sha+'/docs/README.md#L2');
});
