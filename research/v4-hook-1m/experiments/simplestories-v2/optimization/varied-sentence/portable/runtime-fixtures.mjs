// Reconstruct local-only fixtures from published model files. No RPC or writes.
import assert from 'node:assert/strict';
import {readFileSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {getAddress, keccak256} from 'ethers';

const HERE=path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT=path.resolve(HERE,'../../../../..');
export const DEFAULT_MANIFEST=path.join(HERE,'local-runtime-fixtures.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function loadRuntimeFixtures({root=DEFAULT_ROOT,manifestPath=DEFAULT_MANIFEST}={}) {
  root=realpathSync(root);
  const manifestBytes=readFileSync(manifestPath),manifest=JSON.parse(manifestBytes);
  assert.equal(manifest.schema_version,1);
  assert.equal(manifest.scope,'LOCAL_RUNTIME_FIXTURES_ONLY');
  assert.equal(manifest.runtimes.length,544);
  const files=new Map();
  for(const source of manifest.sources){
    assert(!files.has(source.id),'Duplicate source id');
    assert(!path.isAbsolute(source.path),'Source path must be relative');
    const resolved=realpathSync(path.resolve(root,source.path));
    assert(resolved.startsWith(root+path.sep),'Source path escapes research root');
    const bytes=readFileSync(resolved);
    assert.equal(bytes.length,source.bytes,'Source size: '+source.path);
    assert.equal(sha(bytes),source.sha256,'Source SHA256: '+source.path);
    files.set(source.id,bytes);
  }
  const runtimes=Object.create(null),transactions=[];
  for(const [order,row] of manifest.runtimes.entries()){
    assert.equal(row.order,order);
    assert.equal(getAddress(row.address),row.address);
    assert(!runtimes[row.address],'Duplicate local address');
    assert(Number.isSafeInteger(row.offset)&&row.offset>=0);
    assert(Number.isSafeInteger(row.length)&&row.length>0);
    const bytes=files.get(row.source);
    assert(bytes,'Unknown runtime source');
    assert(row.offset+row.length<=bytes.length,'Runtime slice exceeds source');
    assert(['','00'].includes(row.prefix_hex),'Unexpected prefix');
    const code='0x'+row.prefix_hex+bytes.subarray(row.offset,row.offset+row.length).toString('hex');
    assert.equal((code.length-2)/2,row.runtime_bytes);
    assert.equal(keccak256(code),row.runtime_code_hash,'Runtime keccak: '+row.kind);
    if(row.kind.startsWith('data:'))assert.equal(row.prefix_hex,'00','Data must start with STOP');
    else {assert(row.kind.startsWith('tile:'));assert.equal(row.prefix_hex,'','Tiles are executable raw bytecode');}
    runtimes[row.address]=code;
    transactions.push({order,kind:row.kind,predicted_address:row.address,runtime_code_hash:row.runtime_code_hash,runtime_bytes:row.runtime_bytes});
  }
  const groups=manifest.constructor_groups;
  for(const [kind,name,count] of [['data:weights:','weights',261],['data:tables:','tables',1],['tile:','tiles',282]]){
    const expected=transactions.filter(row=>row.kind.startsWith(kind)).map(row=>row.predicted_address);
    assert.equal(expected.length,count);assert.deepEqual(groups[name],expected,'Constructor order: '+name);
  }
  const constructorArgs=[groups.weights,groups.tables,groups.tiles];
  // Compatibility shape for historical local runners; contains no transaction data.
  transactions.push({order:544,kind:'model-constructor-fixture',constructor_arguments:constructorArgs});
  return {manifest,manifestSha256:sha(manifestBytes),runtimes,constructorArgs,
    plan:{scope:'LOCAL_RUNTIME_FIXTURES_ONLY',transactions}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=loadRuntimeFixtures();
  console.log(JSON.stringify({status:'PASS',scope:result.manifest.scope,
    runtimes:result.manifest.runtimes.length,sources:result.manifest.sources.length,
    totalRuntimeBytes:result.manifest.runtimes.reduce((n,r)=>n+r.runtime_bytes,0),
    manifestSha256:result.manifestSha256,constructorCounts:result.constructorArgs.map(x=>x.length)},null,2));
}
