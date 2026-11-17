// Exact reviewed deployment endpoints, one HTTP attempt. No credential values are logged.
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const MAIN='1460fb0c-b81d-4624-aac5-b78658310ce0',RPC='cda71aa3-eb0f-40be-ac67-d24c7545a703',SCAN='60e107a7-2bda-498a-8790-b757a2321a5e';
const check=(v,m)=>{if(!v)throw Error(m);},sha=(b,a)=>createHash(a).update(b).digest('hex');
export function requestSpec(i){
 check([MAIN,RPC,SCAN].includes(i.siteId),'Unreviewed site');let method,path,body,type='application/json';
 if(i.operation==='createSiteDeploy'){
  check(i.body?.draft===true&&i.title?.startsWith('GH0ST GL3 disabled '),'Only disabled draft creation is allowed');
  check(!i.body.environment&&!i.body.edge_functions&&!i.body.server,'Unexpected runtime mutation');
  check(Object.values(i.body.files||{}).every(x=>/^[a-f0-9]{40}$/.test(x)),'Invalid file manifest');
  check(Object.keys(i.body.functions||{}).every(n=>['live-stats','watcher-scans','gl3-rpc'].includes(n)),'Unknown function');
  body=JSON.stringify(i.body);check(sha(body,'sha256')===i.bodySHA256,'Manifest changed');method='POST';path='/sites/'+i.siteId+'/deploys?'+new URLSearchParams({title:i.title});
 }else if(i.operation==='updatePublicSiteProtection'){
  check([RPC,SCAN].includes(i.siteId)&&JSON.stringify(i.body)==='{"sso_login":false}','Only two new sites exact public override allowed');method='PATCH';path='/sites/'+i.siteId;body=JSON.stringify(i.body);
 }else if(i.operation==='provisionSiteTLSCertificate'){
  check([RPC,SCAN].includes(i.siteId)&&i.body===undefined,'Only platform certificates for two new sites allowed');method='POST';path='/sites/'+i.siteId+'/ssl';
 }else{
  check(/^[a-f0-9]{24}$/.test(i.deployId||''),'Invalid deploy');
  if(i.operation==='restoreSiteDeploy'){check(i.siteId!==MAIN,'Publishing the main site is forbidden');method='POST';path='/sites/'+i.siteId+'/deploys/'+i.deployId+'/restore';}
  else if(i.operation==='uploadDeployFunction'){
   check(i.name==='gl3-rpc'&&resolve(i.file).endsWith('/gl3-rpc.zip'),'Unknown function bundle');body=readFileSync(i.file);check(sha(body,'sha256')===i.expectedSHA256,'Function ZIP changed');method='PUT';type='application/octet-stream';path='/deploys/'+i.deployId+'/functions/gl3-rpc?runtime=js';
  }else if(i.operation==='uploadDeployFile'){
   check(typeof i.path==='string'&&!i.path.includes('..')&&i.path.length<256,'Invalid file path');body=i.body;check(typeof body==='string'&&sha(Buffer.from(body),'sha1')===i.expectedSHA1,'File changed');method='PUT';type='application/octet-stream';path='/deploys/'+i.deployId+'/files/'+i.path.split('/').map(encodeURIComponent).join('/');
  }else throw Error('Unreviewed operation');
 }
 return {method,path,body,type};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let requestStatus=null;
 try{
  const input=JSON.parse(readFileSync(0,'utf8')),s=requestSpec(input),cli=resolve(process.argv[2]),root=resolve(dirname(cli),'..');
  const {getToken}=await import(pathToFileURL(root+'/dist/utils/command-helpers.js'));const [token]=await getToken();check(token,'Existing CLI is not authenticated');
  const r=await fetch('https://api.netlify.com/api/v1'+s.path,{method:s.method,headers:{authorization:'Bearer '+token,'content-type':s.type,accept:'application/json'},body:s.body,signal:AbortSignal.timeout(45000),redirect:'error'});
  requestStatus=r.status;check(r.ok,'Netlify returned status'+r.status);process.stdout.write(await r.text());
 }catch{process.stderr.write(JSON.stringify({message:'Netlify single-attempt request unresolved or rejected. Preserve intent and reconcile before retry.',httpStatus:requestStatus})+'\n');process.exitCode=1;}
}
