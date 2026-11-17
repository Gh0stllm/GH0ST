// Imported by the private Linux-only runner. No public endpoint or wallet access.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
export function dbIdentity(dataDir,pid){
 const paths={},fds=fs.readdirSync(`/proc/${pid}/fd`).flatMap(n=>{try{return [fs.readlinkSync(`/proc/${pid}/fd/${n}`)];}catch{return [];}});
 function visit(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){if(!x.isDirectory())continue;const p=d+'/'+x.name;if(['l2chaindata','arbitrumdata','wasm'].includes(x.name)){assert(!paths[x.name]);const s=fs.statSync(p);assert(fds.some(f=>f.startsWith(p+'/')),'No open DB handle for '+x.name);paths[x.name]={path:p,dev:s.dev,ino:s.ino};}else visit(p);}}
 visit(dataDir);assert.equal(Object.keys(paths).length,3);return paths;
}
export function storageSnapshot(dataDir){
 const physical=spawnSync('du',['-B1','-s',dataDir],{encoding:'utf8'});assert.equal(physical.status,0,physical.stderr);
 let logicalBytes=0,fileCount=0;function walk(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+x.name;if(x.isDirectory())walk(p);else if(x.isFile()){logicalBytes+=fs.statSync(p).size;fileCount++;}}}walk(dataDir);
 return {physicalAllocatedBytes:Number(physical.stdout.split(/\s/)[0]),logicalBytes,fileCount,measuredWhileOpen:true};
}
