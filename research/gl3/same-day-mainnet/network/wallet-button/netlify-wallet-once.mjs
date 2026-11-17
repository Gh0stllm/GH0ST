// Separate narrow mutation guard; the earlier deployment guards are unchanged.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const SITES=new Set(['1460fb0c-b81d-4624-aac5-b78658310ce0','cda71aa3-eb0f-40be-ac67-d24c7545a703','60e107a7-2bda-498a-8790-b757a2321a5e']);
const digest=(b,a='sha256')=>createHash(a).update(b).digest('hex');
const check=(v,m)=>{if(!v)throw Error(m)};
function configs(rows){return Object.fromEntries(rows.map(f=>{const c={};for(const[k,out]of[['dn','display_name'],['g','generator'],['bd','build_data'],['p','priority'],['rgo','region'],['mo','memory']])if(f[k]!==undefined&&f[k]!==null)c[out]=f[k];if('ro'in f)c.routes=f.ro.map(r=>Object.fromEntries([['p','pattern'],['l','literal'],['e','expression'],['m','methods'],['ps','prefer_static']].filter(([k])=>r[k]!==undefined&&r[k]!==null).map(([k,out])=>[out,r[k]])));return[f.n,c]}));}
function readBound(file,hash){const s=fs.lstatSync(file);check(s.isFile()&&!s.isSymbolicLink()&&s.size<4000000,'Not bounded regular input');const b=fs.readFileSync(file);check(digest(b)===hash,'Bound source changed');return b;}
export function requestSpec(i){
 const p=JSON.parse(readBound(i.planPath,i.planSHA256));check(p.schema==='gh0st.gl3.wallet-button-deployment.v1'&&SITES.has(p.siteId)&&p.siteId===i.siteId,'Unreviewed site/plan');
 check(p.allHTMLBaselineBytesPreservedOutsideDeclaredEdits===true&&p.originalNonHTMLFilesPreserved===true,'Preservation missing');
 const changed=Object.keys(p.changes),html=Object.keys(p.originalFiles).filter(k=>k.toLowerCase().endsWith('.html'));
 check(changed.length===html.length+2&&html.every(k=>p.changes[k]?.onlyDeclaredEditsAdded===true)&&p.changes['/gh0st-network-wallet.mjs']?.newModule===true&&p.changes['/gh0st-network-wallet.css']?.newStylesheet===true,'Only declared HTML edits, one module and self-hosted stylesheet are allowed');
 check(Object.keys(p.body).sort().join(',')==='draft,files,function_schedules,functions,functions_config'&&p.body.draft===true,'Unexpected deploy settings');
 check(Object.keys(p.body.files).length===Object.keys(p.originalFiles).length+2&&Object.entries(p.originalFiles).every(([k,v])=>p.changes[k]?p.body.files[k]===p.changes[k].SHA1:p.body.files[k]===v),'Original file dropped/changed');
 check(Object.keys(p.body.functions).length===p.originalFunctions.length&&p.originalFunctions.every(f=>p.body.functions[f.n]===f.d),'Original function digest changed');
 check(JSON.stringify(p.body.functions_config)===JSON.stringify(configs(p.originalFunctions)),'Original function configuration changed');
 check(JSON.stringify(p.body.function_schedules)===JSON.stringify(p.originalSchedules),'Function schedule changed');
 if(i.operation==='createWalletDraft')return{method:'POST',path:'/sites/'+p.siteId+'/deploys?'+new URLSearchParams({title:'GH0ST GL3 add-network wallet '+p.siteKey+' '+p.baseDeployId}),body:JSON.stringify(p.body),base:p.baseDeployId};
 check(/^[a-f0-9]{24}$/.test(i.deployId||''),'Invalid deploy ID');
 if(i.operation==='uploadWalletFile'){
  const c=p.changes[i.path];check(c&&typeof i.path==='string'&&!i.path.includes('..'),'Only declared changed files');
  const root=path.dirname(path.dirname(i.planPath)),file=path.resolve(root,c.file);check(file.startsWith(path.resolve(root)+'/'),'Upload path escapes stage');const body=readBound(file,c.SHA256);check(digest(body,'sha1')===c.SHA1,'Upload digest changed');
  if(i.path.toLowerCase().endsWith('.html')){const sri=Buffer.from(p.moduleSHA256,'hex').toString('base64'),tag='\n<script type="module" src="/gh0st-network-wallet.mjs" integrity="sha256-'+sri+'"></script>\n';let s=body.toString('binary');check(c.originalSHA1===p.originalFiles[i.path],'Original HTML binding changed');if(c.baselineSHA1!==c.originalSHA1)check(p.siteKey==='main'&&i.path==='/index.html'&&c.originalSHA1==='a1fe5398bdcb47a668897dcae094258ff58ee5fe'&&c.baselineSHA1==='31122bdf7a01d22662904154d45b43dad64e4ade','Unreviewed processing exception');check(s.split(tag).length===2,'Exact SRI tag missing or duplicated');s=s.replace(tag,'');if(c.CSPAdjustment){const old="default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'",replacement=old+"; script-src 'sha256-"+sri+"'";check(p.siteKey==='main'&&i.path==='/roadmap/index.html'&&c.CSPAdjustment.original===old&&c.CSPAdjustment.replacement===replacement&&s.split(replacement).length===2,'Only exact hash-bound roadmap CSP grant allowed');s=s.replace(replacement,old);}check(digest(Buffer.from(s,'binary'),'sha1')===c.baselineSHA1,'HTML differs outside declared edits');}
  else check(i.path==='/gh0st-network-wallet.mjs'?digest(body)===p.moduleSHA256:i.path==='/gh0st-network-wallet.css'&&digest(body)===p.stylesheetSHA256,'Unknown module or stylesheet');
  return{method:'PUT',path:'/deploys/'+i.deployId+'/files/'+i.path.replace(/^\//,'').split('/').map(encodeURIComponent).join('/'),body,type:'application/octet-stream'};
 }
 if(i.operation==='publishWalletDraft'){
  const r=JSON.parse(readBound(i.reviewFile,i.reviewSHA256));
  check(r.schema==='gh0st.gl3.wallet-button-publication-review.v1'&&r.publicationApproved===true&&r.siteId===p.siteId&&r.baseDeployId===p.baseDeployId&&r.draftDeployId===i.deployId&&r.planSHA256===i.planSHA256,'Exact publication review required');
  check(['originalNonHTMLFilesPreserved','allHTMLBaselineBytesPreservedOutsideDeclaredEdits','originalFunctionsAndSchedulesPreserved','actualDraftHTTPHashesVerified','walletMockTestsPassed','injectionTestsPassed'].every(k=>r[k]===true),'Missing completed review evidence');
  check(JSON.stringify(r.processedIndexBoundary)===JSON.stringify(p.processedIndexBoundary),'Processed index exception not reviewed');
  check(JSON.stringify(r.roadmapCSPAdjustment)===JSON.stringify(p.roadmapCSPAdjustment),'Roadmap CSP exception not reviewed');
  check(/^[a-f0-9]{64}$/.test(r.actualDraftEvidenceSHA256||''),'Missing draft evidence digest');
  return{method:'POST',path:'/sites/'+p.siteId+'/deploys/'+i.deployId+'/restore',base:p.baseDeployId};
 }
 throw Error('Unreviewed wallet operation');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 let status=null;
 try{
  const input=JSON.parse(fs.readFileSync(0,'utf8')),spec=requestSpec(input),cli=path.resolve(process.argv[2]);
  const {getToken}=await import(pathToFileURL(path.resolve(path.dirname(cli),'../dist/utils/command-helpers.js')));const[token]=await getToken();check(token,'Missing existing CLI authentication');
  const headers={authorization:'Bearer '+token,accept:'application/json'};
  if(spec.base){const r=await fetch('https://api.netlify.com/api/v1/sites/'+input.siteId,{headers,signal:AbortSignal.timeout(45000),redirect:'error'});check(r.ok,'CAS read failed');const s=await r.json();check(s.published_deploy?.id===spec.base,'Production changed; stop and prepare a fresh snapshot');}
  const r=await fetch('https://api.netlify.com/api/v1'+spec.path,{method:spec.method,headers:{...headers,'content-type':spec.type||'application/json'},body:spec.body,signal:AbortSignal.timeout(45000),redirect:'error'});
  status=r.status;check(r.ok,'Netlify mutation rejected');process.stdout.write(await r.text());
 }catch{process.stderr.write(JSON.stringify({message:'Wallet-site request failed or is ambiguous; reconcile the saved intent before retrying.',httpStatus:status})+'\n');process.exitCode=1;}
}
