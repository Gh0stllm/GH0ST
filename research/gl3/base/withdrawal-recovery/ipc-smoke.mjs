import net from 'node:net';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ipcClient} from './ipc-rpc.mjs';
createRequire('/root/dispute/package.json')('solc');
const root='/workspace/gl3/testnet/withdrawal-recovery/',cases=[];
async function test(name,response,pattern){
 const path=root+'ipc-smoke-'+process.pid+'-'+cases.length+'.sock';
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.once('data',data=>{const q=JSON.parse(data.toString());socket.end(response(q));});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
 try{const result=ipcClient(path).send('nitroexecution_headMessageIndex',[]);if(pattern)await assert.rejects(result,pattern);else assert.equal(await result,9);await new Promise(r=>setTimeout(r,20));cases.push({name,passed:true});}
 finally{await new Promise(r=>server.close(r));try{fs.unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
await test('normal response then immediate server close',q=>JSON.stringify({jsonrpc:'2.0',id:q.id,result:9})+'\n');
await test('RPC error rejects',q=>JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-1,message:'expected'}})+'\n',/IPC RPC error/);
await test('wrong ID rejects',q=>JSON.stringify({jsonrpc:'2.0',id:q.id+1,result:9})+'\n',/ID mismatch/);
await test('close before response rejects',()=>'',/before matching response/);
await test('oversized response rejects',()=> 'x'.repeat(1048577),/exceeds1MiB/);
console.log(JSON.stringify({passed:true,cases,scope:'One-shot IPC framing/close/error bounds with solc hook active; not a Nitro crash or withdrawal pass'}));
