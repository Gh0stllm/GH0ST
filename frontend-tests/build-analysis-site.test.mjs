import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {zipSync,strToU8} from 'fflate';
import {APPROVED_OVERLAYS,buildAnalysisSite,extractSiteArchive,inspectSiteArchive} from '../scripts/build-analysis-site.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archivePath=process.env.S0UL_SITE_BASE_ARCHIVE??path.resolve(root,'../GH0ST-S0UL-Universal-Final.zip');
const archive=await readFile(archivePath);
const base=extractSiteArchive(archive);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest={format:'gh0st-production-site-base-v1',url:'',sha256:'9902a5c5749a476f142fd8db9c9a31ceb2411a2c62d9cae507aa009da215a18c',sizeBytes:7111313,fileCount:559};
const deployment={chainId:4663,confirmedComplete:true,publicRpc:'https://rpc.mainnet.chain.robinhood.com',
  contracts:Object.fromEntries(['executor','engine','model','reader','adapter','codec'].map((name,index)=>[name,{address:'0x'+String(index+1).padStart(40,'0'),codeHash:'0x'+'1'.repeat(64)}])),
  modelId:'0x'+'2'.repeat(64),domainSha256:'0x'+'3'.repeat(64),schemaHash:'0x'+'4'.repeat(64),configurationHash:'0x'+'5'.repeat(64)};

async function fixture(t){
  const projectDir=await mkdtemp(path.join(os.tmpdir(),'gh0st-site-build-test-'));
  t.after(()=>rm(projectDir,{recursive:true,force:true}));
  await mkdir(path.join(projectDir,'netlify'),{recursive:true});
  await writeFile(path.join(projectDir,'netlify/site-base.json'),JSON.stringify(manifest));
  for(const name of APPROVED_OVERLAYS){
    const destination=path.join(projectDir,'website',name);await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,name.endsWith('deployment.json')?JSON.stringify(deployment):await readFile(path.join(root,'website',name)));
  }
  return {projectDir,archivePath};
}
async function paths(directory,prefix=''){
  const names=[];for(const entry of await readdir(path.join(directory,prefix),{withFileTypes:true})){const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())names.push(...await paths(directory,name));else names.push(name);}return names.sort();
}
async function oldOutput(projectDir){await mkdir(path.join(projectDir,'dist'),{recursive:true});await writeFile(path.join(projectDir,'dist/keep.txt'),'previous valid deploy');}
async function unchanged(projectDir){assert.equal(await readFile(path.join(projectDir,'dist/keep.txt'),'utf8'),'previous valid deploy');assert.deepEqual(await paths(path.join(projectDir,'dist')),['keep.txt']);}

test('frozen production base has the exact reviewed identity and file set',()=>{
  assert.equal(archive.length,manifest.sizeBytes);assert.equal(digest(archive),manifest.sha256);assert.equal(base.size,559);
  assert.deepEqual([...base.keys()].filter(name=>name.endsWith('.pdf')).sort(),['research/gh0st-research-paper-001.pdf','research/gh0st-research-paper-002.pdf']);
  for(const name of ['_headers','_redirects','mint/vendor/ethers.js','s0ul/index.html'])assert(base.has(name),name+' is in the production archive');
});

test('build preserves all 558 non-overlay production files and adds only the four approved files',async t=>{
  const options=await fixture(t);
  // Neither an extra local asset nor server credentials can enter static output.
  await writeFile(path.join(options.projectDir,'website/unapproved-local-file.txt'),'never publish this');
  await writeFile(path.join(options.projectDir,'netlify/s0ul-analysis-config.mjs'),'export default {privateKey:"test-only-never-publish"}');
  await writeFile(path.join(options.projectDir,'.env'),'WORKER_KEY=test-only-never-publish');
  const report=await buildAnalysisSite(options),output=path.join(options.projectDir,'dist');
  assert.equal(report.baseFiles,559);assert.equal(report.outputFiles,563);assert.equal(report.preservedFiles,558);
  assert.deepEqual(report.replacedFiles,['s0ul/index.html']);
  assert.deepEqual(report.addedFiles,[...APPROVED_OVERLAYS].filter(name=>name!=='s0ul/index.html'));
  const expected=new Set([...base.keys(),...APPROVED_OVERLAYS]);assert.deepEqual(await paths(output),[...expected].sort());
  for(const[name,contents]of base)if(!APPROVED_OVERLAYS.includes(name))assert.deepEqual(await readFile(path.join(output,name)),Buffer.from(contents),name+' byte preservation');
  for(const name of APPROVED_OVERLAYS)assert.deepEqual(await readFile(path.join(output,name)),await readFile(path.join(options.projectDir,'website',name)),name+' exact overlay');
  assert.equal(Object.keys(report.pdfs).length,2);
  for(const[name,hash]of Object.entries(report.pdfs))assert.equal(digest(await readFile(path.join(output,name))),hash);
  // A rebuild replaces output rather than retaining a stale generated file.
  await writeFile(path.join(output,'obsolete.txt'),'remove on rebuild');
  assert.equal((await buildAnalysisSite(options)).preservedSetSha256,report.preservedSetSha256);
  assert.deepEqual(await paths(output),[...expected].sort());
});

test('archive identity mismatch fails before modifying an existing valid output',async t=>{
  const options=await fixture(t);await oldOutput(options.projectDir);
  await writeFile(path.join(options.projectDir,'netlify/site-base.json'),JSON.stringify({...manifest,sha256:'0'.repeat(64)}));
  await assert.rejects(buildAnalysisSite(options),/SHA-256 mismatch/);await unchanged(options.projectDir);
});

test('unexpected archive file count fails before modifying output',async t=>{
  const options=await fixture(t);await oldOutput(options.projectDir);
  await writeFile(path.join(options.projectDir,'netlify/site-base.json'),JSON.stringify({...manifest,fileCount:560}));
  await assert.rejects(buildAnalysisSite(options),/unexpected file count/);await unchanged(options.projectDir);
});

test('missing or symlink overlays fail closed without destroying existing output',async t=>{
  const options=await fixture(t);await oldOutput(options.projectDir);const asset=path.join(options.projectDir,'website/s0ul-analysis.css');
  await rm(asset);await assert.rejects(buildAnalysisSite(options),/ENOENT/);await unchanged(options.projectDir);
  await symlink(path.join(root,'website/s0ul-analysis.css'),asset);
  await assert.rejects(buildAnalysisSite(options),/regular file/);await unchanged(options.projectDir);
});

test('public config rejects credentials, unconfirmed deployment and private RPC endpoints',async t=>{
  const options=await fixture(t);await oldOutput(options.projectDir);
  for(const change of [{worker:{privateKey:'test-only'}},{confirmedComplete:false},{publicRpc:'https://example.com/private-key-rpc'},{contracts:{...deployment.contracts,codec:{address:'0x'+'0'.repeat(40),codeHash:'0x'+'1'.repeat(64)}}}]){
    await writeFile(path.join(options.projectDir,'website/s0ul-analysis-deployment.json'),JSON.stringify({...deployment,...change}));
    await assert.rejects(buildAnalysisSite(options),/Private credentials|must be confirmed|approved keyless|contract pin/);await unchanged(options.projectDir);
  }
});

test('download uses only the reviewed release URL and verifies streamed exact bytes',async t=>{
  const options=await fixture(t);const url='https://github.com/gh0st/research/releases/download/site-base/frozen.zip';
  await writeFile(path.join(options.projectDir,'netlify/site-base.json'),JSON.stringify({...manifest,url}));let calls=0;
  const result=await buildAnalysisSite({projectDir:options.projectDir,fetchImpl:async requested=>{calls++;assert.equal(requested,url);return new Response(archive);}});
  assert.equal(calls,1);assert.equal(result.outputFiles,563);
  await writeFile(path.join(options.projectDir,'netlify/site-base.json'),JSON.stringify({...manifest,url:'https://example.com/site.zip'}));
  await assert.rejects(buildAnalysisSite({projectDir:options.projectDir,fetchImpl:()=>{throw Error('must not fetch');}}),/verified GitHub release asset URL/);
  await writeFile(path.join(options.projectDir,'netlify/site-base.json'),JSON.stringify({...manifest,url}));
  await assert.rejects(buildAnalysisSite({projectDir:options.projectDir,fetchImpl:async()=>new Response(new Uint8Array(manifest.sizeBytes+1))}),/exceeded its exact size/);
});

test('safe extraction rejects traversal, absolute, backslash and shadowing archive paths',()=>{
  for(const name of ['../escape.txt','nested/../../escape.txt','/absolute.txt','C:/drive.txt','nested\\escape.txt','nested//empty.txt','nested/./dot.txt']){
    const data=zipSync({[name]:strToU8('x')});assert.throws(()=>inspectSiteArchive(data),/Unsafe archive path/,'reject '+name);
  }
  assert.throws(()=>inspectSiteArchive(zipSync({'dir':strToU8('file'),'dir/child':strToU8('x')})),/shadows a directory/);
});

test('safe extraction rejects symlink types, duplicate entries and local/directory disagreement',()=>{
  const one=Buffer.from(zipSync({'a.txt':strToU8('x')})),central=one.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  const link=Buffer.from(one);link.writeUInt32LE((0xa1ff<<16)>>>0,central+38);assert.throws(()=>inspectSiteArchive(link),/links and special files/);
  const mismatch=Buffer.from(one);mismatch[30]=0x62;assert.throws(()=>inspectSiteArchive(mismatch),/local path differs/);
  const duplicate=Buffer.from(zipSync({'a.txt':strToU8('a'),'b.txt':strToU8('b')}));
  const first=duplicate.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])),second=duplicate.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),first+4);
  duplicate[second+46]=0x61;const local=duplicate.readUInt32LE(second+42);duplicate[local+30]=0x61;
  assert.throws(()=>inspectSiteArchive(duplicate),/Duplicate archive path/);
});

test('safe extraction rejects unsupported formats and oversized advertised entries before inflation',()=>{
  assert.throws(()=>inspectSiteArchive(new Uint8Array(22)),/Missing ZIP directory/);
  const one=Buffer.from(zipSync({'a.txt':strToU8('x')})),central=one.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  for(const mutate of [b=>b.writeUInt16LE(1,central+8),b=>b.writeUInt16LE(99,central+10),b=>b.writeUInt32LE(64*1024*1024+1,central+24)]){
    const invalid=Buffer.from(one);mutate(invalid);assert.throws(()=>inspectSiteArchive(invalid),/Unsupported ZIP entry/);
  }
  assert.deepEqual([...extractSiteArchive(one).keys()],['a.txt']);
});

test('a nested EOCD inside a legal ZIP comment cannot replace the inspected payload',()=>{
  const outer=Buffer.from(zipSync({'a.txt':strToU8('trusted')}));
  const nested=Buffer.from(zipSync({'a.txt':strToU8('altered')}));
  const outerEnd=outer.length-22,nestedEnd=nested.length-22,nestedDirectory=nested.readUInt32LE(nestedEnd+16);
  outer.writeUInt16LE(nested.length,outerEnd+20);
  nested.writeUInt32LE(nested.readUInt32LE(nestedDirectory+42)+outer.length,nestedDirectory+42);
  nested.writeUInt32LE(nestedDirectory+outer.length,nestedEnd+16);
  // This apparent EOCD has an invalid comment length and must not be selected
  // by an independent inflater after our actual directory has been inspected.
  nested.writeUInt16LE(1,nestedEnd+20);
  const bytes=Buffer.concat([outer,nested]);
  assert.equal(inspectSiteArchive(bytes)[0].expanded,7);
  assert.equal(Buffer.from(extractSiteArchive(bytes).get('a.txt')).toString(),'trusted');
});
