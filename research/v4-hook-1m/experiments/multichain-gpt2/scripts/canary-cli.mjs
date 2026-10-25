// Local interactive entry point. Decrypted keys stay in this process, never argv or env.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {formatEther} from 'ethers';
import {HERE} from './build.mjs';
import {validateCanaryConfig,checkedOutput} from './canary-runtime.mjs';
import * as keystore from './canary-keystore.mjs';

const DEFAULT_CONFIG='deployments/canary-proposed-20261025-v2/manifest.json';
const DEFAULT_KEYSTORE='deployments/canary-signer.json';
export function cliArguments(args){
  const action=args.shift()??'check';
  assert(['setup','check','deploy','relay','run'].includes(action),'Choose setup, check, deploy, relay or run');
  const out={action,config:DEFAULT_CONFIG,keystore:DEFAULT_KEYSTORE};
  for(const arg of args){const match=/^--(config|keystore)=(.+)$/.exec(arg);assert(match,'Unknown option');out[match[1]]=match[2];}
  return out;
}
export function loadRpcEnvironment(){
  // Read only the configured RPC entry, not arbitrary shell or environment commands.
  const file=path.resolve(HERE,'../../.env.local');
  if(!process.env.RH_RPC_URL&&fs.existsSync(file)){
    const line=fs.readFileSync(file,'utf8').split(/\r?\n/).find(x=>/^\s*(?:export\s+)?ROBINHOOD_MAINNET_RPC_URL\s*=/.test(x));
    if(line){let value=line.slice(line.indexOf('=')+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);process.env.RH_RPC_URL=value;}
  }
  process.env.RH_RPC_URL||=process.env.ROBINHOOD_MAINNET_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
  process.env.OPBNB_RPC_URL||='https://opbnb-mainnet-rpc.bnbchain.org';
}
async function rpc(url,method,params=[]){
  const result=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const body=await result.json();assert(result.ok&&!body.error&&Object.hasOwn(body,'result'),'Network read failed');return body.result;
}
export async function checkFunding(config,{request=rpc}={}){
  return Promise.all(config.chains.map(async chain=>{
    const url=process.env[chain.rpcEnv];assert(url,'RPC configuration missing');
    const id=Number(BigInt(await request(url,'eth_chainId')));assert(id===chain.chainId,'Wrong RPC network');
    const [balance,nonce]=await Promise.all([request(url,'eth_getBalance',[config.admin,'pending']),request(url,'eth_getTransactionCount',[config.admin,'pending'])]);
    return {chain:chain.key,chainId:id,nativeSymbol:id===204?'BNB':'ETH',balanceWei:BigInt(balance).toString(),balance:formatEther(BigInt(balance)),pendingNonce:Number(BigInt(nonce))};
  }));
}
export async function runCli(argv=process.argv.slice(2)){
  const options=cliArguments([...argv]),configFile=checkedOutput(options.config),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  validateCanaryConfig(config,{deployed:'prepared',paid:['deploy','relay','run'].includes(options.action)});
  loadRpcEnvironment();
  if(options.action==='setup'){
    const statusFile=checkedOutput('deployments/canary-signer-setup-status.json');
    const save=status=>fs.writeFileSync(statusFile,JSON.stringify({checkedAt:new Date().toISOString(),address:config.admin,...status},null,2)+'\n',{mode:0o600});
    save({status:'AWAITING_PRIVATE_INPUT'});
    try{
      await keystore.run(['--config='+configFile,'--keystore='+options.keystore]);
      save({status:'READY',keystoreFile:checkedOutput(options.keystore)});
    }catch(error){
      const reason=keystore.CANARY_KEYSTORE_ERRORS?.[error.code]??'Setup could not finish. No encrypted signer was saved.';
      save({status:'FAILED',reason});
      const safeError=new Error(reason);safeError.code='CANARY_SAFE_SETUP_ERROR';throw safeError;
    }
    return;
  }
  console.log('Wallet: '+config.admin);
  console.log('Spending policy: '+(config.spendingPolicy??'bounded'));
  const funding=await checkFunding(config);
  for(const chain of funding)console.log(chain.chain+': '+chain.balance+' '+chain.nativeSymbol+'; pending nonce '+chain.pendingNonce);
  const keyFile=checkedOutput(options.keystore);console.log('Encrypted signer: '+(fs.existsSync(keyFile)?'available':'not set up'));
  if(options.action==='check')return;
  // Do this for both chains before decrypting or submitting even the first transaction.
  assert(funding.every(x=>BigInt(x.balanceWei)>0n),'FUND_BOTH_CHAINS');
  assert(fs.existsSync(keyFile),'SETUP_SIGNER_FIRST');
  const {loadCanarySigner}=await import('./canary-keystore.mjs');
  let wallet=await loadCanarySigner({configFile,keystoreFile:keyFile});
  const signerFactory=provider=>wallet.connect(provider);
  try{
    if(options.action==='deploy'||options.action==='run'){
      const {run}=await import('./deploy-canary.mjs');await run(['--config='+configFile,'--execute'],{signerFactory});
    }
    if(options.action==='relay'||options.action==='run'){
      const {run}=await import('./canary-relay.mjs');await run(['--config='+configFile,'--execute','--watch'],{signerFactory});
    }
  }finally{wallet=null;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runCli().catch(error=>{
  if(error.message==='FUND_BOTH_CHAINS')console.error('Add native gas funds to both chains before deployment. opBNB needs BNB on opBNB, chain 204. Nothing was signed.');
  else if(error.message==='SETUP_SIGNER_FIRST')console.error('Run the signing setup first. Nothing was signed.');
  else if(error.code==='CANARY_SAFE_SETUP_ERROR')console.error(error.message+' Nothing was signed.');
  else if(keystore.CANARY_KEYSTORE_ERRORS?.[error.code])console.error(keystore.CANARY_KEYSTORE_ERRORS[error.code]+' Nothing was signed.');
  else if(['Entered key does not match configured admin','Passwords differ','Use a password of at least 12 characters','Invalid private-key encoding','Unable to unlock encrypted keystore','Keystore does not match configured admin','Private terminal input canceled'].includes(error.message))console.error(error.message+'. Nothing was signed.');
  else console.error('Local canary command stopped. Check the selected wallet, encrypted signer, network connection and deployment state. Secret values are never logged.');
  process.exitCode=1;
});
