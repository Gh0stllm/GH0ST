// Authentication material is read only by the operator-approved private service.
// Never emit the token, secret or raw connection errors.
const fs=require('fs'),crypto=require('crypto'),WS=require('/root/dispute/node_modules/ws');
try{
 const secret=fs.readFileSync(process.argv[2],'utf8').trim().replace(/^0x/,''),url=new URL(process.argv[3]);
 if(!/^[0-9a-f]{64}$/i.test(secret)||url.hostname!=='127.0.0.1'||url.protocol!=='ws:')throw Error('private_reference_invalid');
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),a=enc({alg:'HS256',typ:'JWT'})+'.'+enc({iat:Math.floor(Date.now()/1000)}),token=a+'.'+crypto.createHmac('sha256',Buffer.from(secret,'hex')).update(a).digest('base64url');
 const ws=new WS(url,{headers:{Authorization:'Bearer '+token}}),timer=setTimeout(()=>process.exit(1),3000);
 ws.on('open',()=>ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'validation_wasmModuleRoots',params:[]})));
 ws.on('message',x=>{if(x.length>65536)process.exit(1);let j;try{j=JSON.parse(x);}catch{process.exit(1);}if(j.error||!Array.isArray(j.result)||!j.result.includes(process.argv[4]))process.exit(1);clearTimeout(timer);ws.close();});
 ws.on('error',()=>process.exit(1));
}catch{process.exit(1);}
