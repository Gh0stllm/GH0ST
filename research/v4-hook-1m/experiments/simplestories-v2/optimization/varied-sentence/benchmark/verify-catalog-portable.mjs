// Portable copy; original measured script is preserved byte-for-byte.
// Bounded eth_call verification of a distinct-sentence catalog on isolated Anvil only.
import assert from 'node:assert/strict';
import {loadRuntimeFixtures} from '../portable/runtime-fixtures.mjs';
import {readFileSync,writeFileSync,appendFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ContractFactory,JsonRpcProvider,keccak256,toBeHex} from 'ethers';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'../../../../..');
const args=process.argv.slice(2);const opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
assert(args.every((x,i)=>['--catalog','--count','--port','--label'].includes(x)||(i>0&&['--catalog','--count','--port','--label'].includes(args[i-1]))),'Unknown option');
const catalogPath=path.resolve(ROOT,opt('--catalog','experiments/simplestories-v2/optimization/varied-sentence/quality/catalog-v2-10000.json'));
const count=Number(opt('--count','10000')),port=Number(opt('--port','18586')),label=opt('--label','catalog-portable-10000');
assert(Number.isInteger(count)&&count>0&&count<=10000);assert(Number.isInteger(port)&&port>=18570&&port<=18599);assert(/^[a-z0-9-]+$/.test(label));
const URL=`http://127.0.0.1:${port}`,CAP=32000000n,CALL_CAP=29250000n;
const sha=x=>createHash('sha256').update(x).digest('hex');
const source=path.resolve(HERE,'../kernel/SimpleStoriesV2TwoPrefixCachedModel.sol');
assert.equal(sha(readFileSync(source)),'675a50eb0730a8bad06a23a76e3f56d197af64bd74703e997af56d34eb7b8efb');
const artifactPath=source.replace('.sol','.compiled.json'),artifact=JSON.parse(readFileSync(artifactPath));
const catalogBytes=readFileSync(catalogPath),parsed=JSON.parse(catalogBytes),rows=(Array.isArray(parsed)?parsed:parsed.cases??parsed.sentences??parsed.rows).slice(0,count);
assert.equal(rows.length,count,'Catalog is too small');
const keys=new Set();for(const row of rows){assert.equal(row.top_k,64);assert.equal(row.temperature_milli,1000);assert.deepEqual(row.prompt_ids,[3]);assert(row.tokens.length>=2&&row.tokens.length<=5&&[1,2,15,30].includes(row.tokens.at(-1)));assert(row.tokens.every(x=>Number.isInteger(x)&&x>=1&&x<4019));assert(/^0x[0-9a-f]{64}$/i.test(row.seed));const key=row.text.toLowerCase().replace(/[.!?]+$/,'').trim().replace(/\s+/g,' ');assert(!keys.has(key),'Duplicate word sequence');keys.add(key);}
const {plan,runtimes,manifestSha256:runtimeFixtureSha256}=loadRuntimeFixtures({root:ROOT});
const reportPath=path.join(HERE,label+'-evm.json'),evidencePath=path.join(HERE,label+'-evm.jsonl');
const report={runtimeFixtureSha256,status:'RUNNING',scope:'Isolated unforked Anvil 31337 only; all catalog generations are real EVM eth_call executions with bounded gas. This is not a mainnet or a 10,000-swap transaction test.',startedAt:new Date().toISOString(),catalogSha256:sha(catalogBytes),catalogPath:path.relative(ROOT,catalogPath),sourceSha256:sha(readFileSync(source)),artifactSha256:sha(readFileSync(artifactPath)),runnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),expected:count,checked:0,passed:0,failed:[],modelCallGasLimit:CALL_CAP.toString(),transactionAndBlockGasLimit:CAP.toString(),concurrency:4,batchSize:16,branches:[],publicTransactionsSubmitted:0,dataInstallation:'544 verified data/weight-code runtimes injected on the isolated node; actual model and branch constructors executed normally.'};
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
let child,provider,temp,stderr='';
async function rpc(method,params=[]){const res=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(180000)});const body=await res.json();if(body.error)throw Error(body.error.message);return body.result;}
async function guard(){assert.equal(await rpc('eth_chainId'),'0x7a69','Not isolated chain31337');assert((await rpc('web3_clientVersion')).toLowerCase().includes('anvil'));}
try{
 save();writeFileSync(evidencePath,'');
 try{await rpc('eth_chainId');throw Error('Reserved local port is already in use');}catch(e){if(e.message==='Reserved local port is already in use')throw e;}
 temp=mkdtempSync(path.join(os.tmpdir(),'gh0st-catalog-'));
 child=spawn(process.env.ANVIL_BINARY||'anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--hardfork','cancun','--gas-limit',String(CAP),'--code-size-limit','24576','--quiet','--no-cors'],{cwd:temp,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',x=>{stderr=(stderr+String(x)).slice(-3000);});
 let ready=false;for(let i=0;i<100;i++){try{await guard();ready=true;break;}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,stderr);
 for(let i=0;i<544;i+=24){await guard();await Promise.all(plan.transactions.slice(i,Math.min(i+24,544)).map(async row=>{const code=runtimes[row.predicted_address];assert.equal(keccak256(code),row.runtime_code_hash);await rpc('anvil_setCode',[row.predicted_address,code]);}));}
 provider=new JsonRpcProvider(URL,31337,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=10;
 const signer=await provider.getSigner(0),from=await signer.getAddress(),factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer);
 await guard();const model=await factory.deploy(...plan.transactions[544].constructor_arguments,3,{gasLimit:CAP});const receipt=await model.deploymentTransaction().wait();assert.equal(receipt.status,1);
 report.constructorGas=receipt.gasUsed.toString();report.model=model.target;report.modelHash=await model.modelHash();report.modelRuntimeHash=keccak256(await provider.getCode(model.target));save();
 for(const token of await model.rootCandidates(64)){await guard();const receipt=await(await model.prepareBranch(token,{gasLimit:CAP})).wait();assert.equal(receipt.status,1);assert(receipt.gasUsed<=CAP);report.branches.push({token:Number(token),gasUsed:receipt.gasUsed.toString()});}
 let lowGasRejected=false;try{await provider.call({from,to:model.target,data:model.interface.encodeFunctionData('generateCachedSentence',[5,rows[0].seed,64,1000]),gasLimit:1000000n});}catch{lowGasRejected=true;}assert(lowGasRejected,'Low-gas control must fail');report.lowGasControlRejected=true;
 report.stage='VERIFYING_CATALOG';save();console.log('All 64 on-chain prefix branches prepared; verifying '+count+' catalog entries.');
 let cursor=0;const started=Date.now();
 async function worker(){while(cursor<count){const start=cursor;cursor+=16;const chunk=rows.slice(start,Math.min(start+16,count));await guard();const requests=chunk.map((r,j)=>({jsonrpc:'2.0',id:start+j,method:'eth_call',params:[{from,to:model.target,data:model.interface.encodeFunctionData('generateCachedSentence',[5,r.seed,64,1000]),gas:toBeHex(CALL_CAP)},'latest']}));
  const res=await fetch(URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requests),signal:AbortSignal.timeout(180000)});const responses=await res.json();assert(Array.isArray(responses));const mapped=new Map(responses.map(r=>[r.id,r]));const evidence=[];
  for(let j=0;j<chunk.length;j++){const row=chunk[j],id=start+j,result=mapped.get(id);try{assert(result&&!result.error,result?.error?.message??'Missing result');const output=model.interface.decodeFunctionResult('generateCachedSentence',result.result);assert.deepEqual(Array.from(output[0],Number),row.tokens);assert.equal(output[1],row.tokens.at(-1)===1);assert.equal(output[2],[2,15,30].includes(row.tokens.at(-1)));if(row.last_logit_hash)assert.equal(output[3],row.last_logit_hash);report.passed++;evidence.push({index:id,seed:row.seed,returnHash:keccak256(result.result),lastLogitHash:output[3],passed:true});}catch(error){report.failed.push({index:id,seed:row.seed,error:String(error.message).slice(0,300)});evidence.push({index:id,seed:row.seed,passed:false});}report.checked++;}
  appendFileSync(evidencePath,evidence.map(r=>JSON.stringify(r)).join('\n')+'\n');save();if(report.checked%128<16||report.checked===count)console.log(report.checked+'/'+count+' checked; '+report.failed.length+' failures.');
 }}
 await Promise.all(Array.from({length:4},worker));
 report.verificationElapsedMs=Date.now()-started;report.status=report.failed.length===0?'PASS':'FAIL';report.stage='COMPLETE';report.completedAt=new Date().toISOString();report.evidenceSha256=sha(readFileSync(evidencePath));save();assert.equal(report.passed,count,'Some catalog entries failed bounded EVM verification');console.log(JSON.stringify({status:report.status,checked:report.checked,passed:report.passed,elapsedMs:report.verificationElapsedMs,report:reportPath}));
}catch(error){report.status='FAIL';report.error=String(error.message).slice(0,1000);save();throw error;}
finally{provider?.destroy();child?.kill('SIGTERM');if(child)await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));if(temp)rmSync(temp,{recursive:true,force:true});}
