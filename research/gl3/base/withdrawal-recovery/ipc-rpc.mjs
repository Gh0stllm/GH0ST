// Bounded one-shot local IPC avoids persistent-provider events during SIGKILL.
import net from 'node:net';
import assert from 'node:assert/strict';
let nextID=0;
export function ipcClient(path){
 assert(path.startsWith('/workspace/gl3/testnet/withdrawal-recovery/'));
 return {destroy(){},send(method,params){
  assert.equal(method,'nitroexecution_headMessageIndex');assert.deepEqual(params,[]);
  return new Promise((resolve,reject)=>{
   const id=++nextID,socket=net.createConnection(path);let done=false,buffer=Buffer.alloc(0);
   function finish(error,value){if(done)return;done=true;socket.destroy();if(error)reject(error);else resolve(value);}
   socket.setTimeout(15000,()=>finish(Error('Bounded IPC timeout')));
   socket.once('connect',()=>socket.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'));
   socket.on('error',error=>finish(error));socket.on('end',()=>{if(!done)finish(Error('IPC ended before matching response'));});
   socket.on('close',()=>{if(!done)finish(Error('IPC closed before matching response'));});
   socket.on('data',chunk=>{
    if(done)return;
    try{
     assert(buffer.length+chunk.length<=1048576,'IPC response exceeds1MiB');buffer=Buffer.concat([buffer,chunk]);
     while(!done){const end=buffer.indexOf(10);if(end<0)break;const line=buffer.subarray(0,end).toString('utf8').trim();buffer=buffer.subarray(end+1);if(!line)continue;
      const response=JSON.parse(line);assert.equal(response.jsonrpc,'2.0');assert.equal(response.id,id,'IPC response ID mismatch');
      if(response.error)throw Error('IPC RPC error '+JSON.stringify(response.error));assert('result' in response,'IPC result absent');finish(null,response.result);
     }
    }catch(error){finish(error);}
   });
  });
 }};
}
