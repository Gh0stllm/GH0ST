// User-run liquidity CLI. Imports never connect, prompt, sign, or broadcast.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import * as ethers from 'ethers';
import '../deployment/liquidity-plan.js';
import { PIN, loadReviewedPlan, verifyNetwork, gasWithHeadroom } from './deploy-reviewed-plan.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LP = globalThis.GH0STLiquidity, C = LP.CONSTANTS;
const eq = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const SOURCE_POOL = '0x42ce003822cbaa9eb94e9e07ef8d988e5a998ded86b189fd4f3e25b68f001d01';
const PINS = {
 [C.positionManager]: '0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2',
 [C.permit2]: '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca',
 [C.currency1]: '0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',
};
const KEY = {currency0:C.currency0,currency1:C.currency1,fee:C.fee,tickSpacing:C.tickSpacing,hooks:C.hook};
const POOL_ID = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([LP.POOL_KEY_TYPE],[KEY]));
const json = x => JSON.stringify(x, (_,v) => typeof v === 'bigint' ? v.toString() : v, 2);
function contracts(provider) { return {
 token:new ethers.Contract(C.currency1,LP.ERC20_ABI,provider), pm:new ethers.Contract(C.positionManager,LP.POSITION_MANAGER_ABI,provider),
 manager:new ethers.Contract(C.poolManager,['function extsload(bytes32) view returns(bytes32)'],provider),
}; }
export async function poolState(provider,id=POOL_ID,blockTag='latest') {
 const slot=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[id,6]));
 const m=contracts(provider).manager;
 const [word,liq]=await Promise.all([m.extsload(slot,{blockTag}),m.extsload(ethers.toBeHex(BigInt(slot)+3n,32),{blockTag})]);
 const sqrt=BigInt(word)&((1n<<160n)-1n);
 return {sqrtPriceX96:sqrt,initialized:sqrt>0n,liquidity:BigInt(liq)};
}
export async function verifyDeployment(provider,deployment) {
 await verifyNetwork(provider,deployment);
 const entries=deployment.transactions.map(x=>[x.predicted_address,x.runtime_code_hash]);
 entries.push(...Object.entries(PINS));
 for(let i=0;i<entries.length;i+=6) await Promise.all(entries.slice(i,i+6).map(async([address,hash])=>{
  assert.equal(ethers.keccak256(await provider.getCode(address)),hash,`Contract code does not match: ${address}`);
 }));
 const {pm,token}=contracts(provider);
 assert(eq(await pm.poolManager(),C.poolManager),'PositionManager points to another manager.');
 assert(eq(await pm.permit2(),C.permit2),'PositionManager points to another Permit2.');
 assert.equal(Number(await token.decimals()),18,'Unexpected GH0ST decimals.');
}
export async function ethUsd(fetcher=globalThis.fetch) {
 const response=await fetcher('https://api.coinbase.com/v2/prices/ETH-USD/spot',{signal:AbortSignal.timeout(15000),redirect:'error'});
 assert(response.ok,'Coinbase price request failed.');const data=await response.json();
 assert.equal(data.data?.base,'ETH');assert.equal(data.data?.currency,'USD');
 LP.decimalFraction(data.data.amount);return data.data.amount;
}
export async function readQuote(provider,fetcher) {
 const block=await provider.getBlock('latest');assert(block,'Latest block unavailable.');
 assert(Math.abs(Date.now()/1000-block.timestamp)<120,'RPC block is stale.');
 const {token}=contracts(provider);
 const [source,pool,price,allowance]=await Promise.all([poolState(provider,SOURCE_POOL,block.number),poolState(provider,POOL_ID,block.number),ethUsd(fetcher),token.allowance(C.wallet,C.permit2,{blockTag:block.number})]);
 assert(source.initialized&&source.liquidity>0n,'Reference pool has no active liquidity.');
 const plan=LP.buildPlan({wallet:C.wallet,initialized:pool.initialized,currentSqrtPriceX96:pool.sqrtPriceX96,quoteSqrtPriceX96:source.sqrtPriceX96,ethUsd:price,blockTimestamp:block.timestamp,observedBlock:block.number,currentErc20Allowance:allowance},ethers);
 return {plan,block,pool,source,quotedAt:Date.now()};
}
export function assertFresh(plan,quote,now=Date.now()) {
 assert(now-quote.quotedAt<=120000,'Quote expired. Run again for a fresh quote.');
 assert(quote.block.timestamp+60<Number(plan.deadline),'Mint deadline is too close. Run again.');
 assert.equal(quote.pool.initialized,plan.initialized,'Pool initialization changed. Run again for a fresh quote.');
 const lo=BigInt(plan.liquidity.sqrt_price_lower),hi=BigInt(plan.liquidity.sqrt_price_upper);
 assert(quote.source.sqrtPriceX96>=lo&&quote.source.sqrtPriceX96<=hi,'Reference price moved more than 0.5%. Run again.');
 if(quote.pool.initialized)assert(quote.pool.sqrtPriceX96>=lo&&quote.pool.sqrtPriceX96<=hi,'Pool price moved more than 0.5%. Run again.');
 const old=LP.decimalFraction(plan.prices.eth_usd.decimal),fresh=LP.decimalFraction(quote.plan.prices.eth_usd.decimal);
 const lhs=fresh.numerator*old.denominator,rhs=old.numerator*fresh.denominator;
 assert(lhs*10000n>=rhs*9950n&&lhs*10000n<=rhs*10050n,'ETH/USD moved more than 0.5%. Run again.');
}
export async function checkedReceipt(provider,entry) {
 const receipt=await provider.getTransactionReceipt(entry.hash);if(!receipt)return null;
 const tx=await provider.getTransaction(entry.hash);
 assert(tx&&eq(tx.from,C.wallet)&&eq(tx.to,entry.to)&&eq(tx.data,entry.data)&&BigInt(tx.value)===BigInt(entry.value),'Receipt transaction differs from the reviewed action.');
 assert.equal(Number(receipt.status),1,`Transaction reverted: ${entry.hash}`);return receipt;
}
export async function submitAction({provider,signer,action,nonce,state,save,log=()=>{}}) {
 const request={chainId:C.chainId,from:C.wallet,to:action.to,data:action.data,value:BigInt(action.value),nonce};
 const gasLimit=gasWithHeadroom(await signer.estimateGas(request));
 const fees=await provider.getFeeData(),price=fees.maxFeePerGas??fees.gasPrice;assert(price!==null,'No network gas price.');
 assert(await provider.getBalance(C.wallet,'pending')>=request.value+gasLimit*price,'Insufficient ETH for deposit and gas.');
 const populated=await signer.populateTransaction({...request,gasLimit});
 const signed=await signer.signTransaction(populated),hash=ethers.keccak256(signed);
 const entry={kind:action.kind,hash,nonce,to:action.to,data:action.data,value:String(action.value),status:'pending'};
 state.transactions.push(entry);save(state);log(`Prepared ${action.kind}: ${hash}`);
 try{await provider.broadcastTransaction(signed);}catch{log('RPC reported an error; checking the prepared transaction receipt.');}
 let receipt=await checkedReceipt(provider,entry);
 if(!receipt){try{await provider.waitForTransaction(hash,1,120000);}catch{}receipt=await checkedReceipt(provider,entry);}
 assert(receipt,`Submission unresolved. Exact hash is saved: ${hash}. Run this command again to inspect; do not resend manually.`);
 entry.status='confirmed';entry.blockNumber=receipt.blockNumber;save(state);log(`Confirmed ${action.kind}: ${hash}`);return receipt;
}
export async function verifyMint(provider,receipt,plan) {
 const {pm}=contracts(provider),iface=new ethers.Interface(LP.POSITION_MANAGER_ABI);
 const mints=receipt.logs.filter(x=>eq(x.address,C.positionManager)).map(x=>{try{return iface.parseLog(x);}catch{return null;}}).filter(x=>x?.name==='Transfer'&&eq(x.args.from,ethers.ZeroAddress)&&eq(x.args.to,C.wallet));
 assert.equal(mints.length,1,'Expected exactly one position NFT minted to your wallet.');const tokenId=mints[0].args.tokenId;
 const [owner,liquidity,info,pool]=await Promise.all([pm.ownerOf(tokenId),pm.getPositionLiquidity(tokenId),pm.getPoolAndPositionInfo(tokenId),poolState(provider)]);
 assert(eq(owner,C.wallet),'Position belongs to a different wallet.');assert.equal(liquidity,BigInt(plan.liquidity.units),'Unexpected position liquidity.');
 const key=info[0];assert(eq(key.currency0,C.currency0)&&eq(key.currency1,C.currency1)&&eq(key.hooks,C.hook)&&Number(key.fee)===C.fee&&Number(key.tickSpacing)===C.tickSpacing,'Position belongs to a different pool.');
 assert(pool.initialized&&pool.liquidity>=liquidity,'Pool liquidity verification failed.');
 return {tokenId:tokenId.toString(),owner,liquidity:liquidity.toString(),poolId:POOL_ID,transactionHash:receipt.hash};
}
function rpcUrl(){const file=path.join(root,'.env.local'),line=existsSync(file)?readFileSync(file,'utf8').split(/\r?\n/).find(x=>x.startsWith('ROBINHOOD_MAINNET_RPC_URL=')):null;
 const value=process.env.ROBINHOOD_MAINNET_RPC_URL||line?.slice(line.indexOf('=')+1).trim();assert(value&&new URL(value).protocol==='https:','Set ROBINHOOD_MAINNET_RPC_URL in private .env.local.');return value;}
function hiddenKey(){assert(process.stdin.isTTY&&process.stdout.isTTY,'Use your interactive terminal; piped keys are not accepted.');process.stdout.write('Private key (hidden; never saved): ');return new Promise((resolve,reject)=>{let value='';const was=process.stdin.isRaw;const finish=error=>{process.stdin.off('data',onData);process.stdin.setRawMode(!!was);process.stdin.pause();process.stdout.write('\n');if(error){value='';reject(error);}else{const copy=value;value='';resolve(copy);}};const onData=chunk=>{for(const ch of chunk.toString()){if(ch==='\u0003')return finish(Error('Cancelled.'));if(ch==='\r'||ch==='\n')return finish();if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else if(/[0-9a-fA-FxX]/.test(ch))value+=ch;}};process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);});}
export async function main(args=process.argv.slice(2)) {
 if(args.includes('--help')){console.log('Read-only quote: node scripts/provide-liquidity.mjs\nUser-run funding: node scripts/provide-liquidity.mjs --broadcast\nAdds up to $100 ETH and $100 GH0ST at quote-time prices. Full range, 0.5% price bounds, gas additional.');return;}
 assert(args.every(x=>x==='--broadcast'),'Unknown option. Use --help.');
 const deployment=loadReviewedPlan(readFileSync(path.join(root,'deployment/robinhood-mainnet-plan.json'))),provider=new ethers.JsonRpcProvider(rpcUrl(),C.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
 const dir=path.join(root,'deployment/.local'),file=path.join(dir,'cli-liquidity-receipts.json');let fd,lock;
 try{
 await verifyDeployment(provider,deployment);
 const state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schemaVersion:1,poolId:POOL_ID,wallet:C.wallet,transactions:[]};assert.equal(state.poolId,POOL_ID);assert(eq(state.wallet,C.wallet));
 for(const entry of state.transactions){if(entry.status==='pending'){const receipt=await checkedReceipt(provider,entry);assert(receipt,`Transaction still unresolved: ${entry.hash}. Check the explorer before continuing.`);entry.status='confirmed';}}
 const previousMint=state.transactions.findLast(x=>x.kind==='mint_liquidity'||x.kind==='initialize_and_mint_liquidity');
 if(previousMint){const receipt=await checkedReceipt(provider,previousMint);assert(receipt,'Previous mint is unresolved.');const result=await verifyMint(provider,receipt,state.plan);console.log(`Liquidity already added. NFT #${result.tokenId}\nPool: ${POOL_ID}\nTransaction: ${result.transactionHash}`);return;}
 const quote=await readQuote(provider),plan=quote.plan;
 console.log(`Robinhood mainnet: all 59 contracts verified.\nWallet: ${C.wallet}\nPool: ${POOL_ID}\nPool initialized: ${plan.initialized}\nETH/USD: $${plan.prices.eth_usd.decimal}\nMaximum: ${ethers.formatEther(plan.liquidity.amount0_max)} ETH + ${ethers.formatEther(plan.liquidity.amount1_max)} GH0ST ($100 each at quote time).\nExpected unused: ${ethers.formatEther(plan.liquidity.expected_unused_amount0)} ETH + ${ethers.formatEther(plan.liquidity.expected_unused_amount1)} GH0ST.\nFull range; 0.5% price bounds; 150% gas headroom. Network gas fees are additional.`);
 if(!args.includes('--broadcast'))return;
 assert(process.stdin.isTTY,'Broadcast requires your interactive terminal.');mkdirSync(dir,{recursive:true,mode:0o700});lock=path.join(dir,'cli-liquidity.lock');fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));
 const save=x=>{const tmp=file+'.tmp';writeFileSync(tmp,json(x)+'\n',{mode:0o600});renameSync(tmp,file);};
 const q=createInterface({input:process.stdin,output:process.stdout});let answer;try{answer=await q.question('Type ADD LIQUIDITY to fund this pool: ');}finally{q.close();}assert.equal(answer,'ADD LIQUIDITY','Cancelled.');
 let key=await hiddenKey(),signer;try{signer=new ethers.Wallet(key,provider);}catch{throw Error('Invalid private key.');}finally{key='';}assert(eq(await signer.getAddress(),C.wallet),'Key does not belong to the confirmed wallet.');
 const nowQuote=await readQuote(provider);assertFresh(plan,{...nowQuote,quotedAt:quote.quotedAt});
 const balances=await Promise.all([provider.getBalance(C.wallet),contracts(provider).token.balanceOf(C.wallet)]);
 assert(balances[0]>BigInt(plan.liquidity.amount0_max),'Insufficient ETH for the deposit plus gas.');
 assert(balances[1]>=BigInt(plan.liquidity.amount1_max),'Insufficient GH0ST for this deposit.');
 let nonce=await provider.getTransactionCount(C.wallet,'pending');assert.equal(nonce,await provider.getTransactionCount(C.wallet,'latest'),'Wallet has pending transactions. Wait before retrying.');
 state.plan=plan;save(state);
 for(const action of plan.approvals)await submitAction({provider,signer,action,nonce:nonce++,state,save,log:console.log});
 await verifyDeployment(provider,deployment);const fresh=await readQuote(provider);assertFresh(plan,{...fresh,quotedAt:quote.quotedAt});
 const {token}=contracts(provider);assert(await token.balanceOf(C.wallet)>=BigInt(plan.liquidity.amount1_max),'Insufficient GH0ST.');
 const receipt=await submitAction({provider,signer,action:plan.unsigned_mint_transaction,nonce:nonce++,state,save,log:console.log});
 const result=await verifyMint(provider,receipt,plan);state.completed=result;save(state);
 console.log(`Liquidity verified. NFT #${result.tokenId}\nPool: ${result.poolId}\nTransaction: https://robinhoodchain.blockscout.com/tx/${result.transactionHash}\nUnused native ETH was refunded; unspent GH0ST remains in your wallet.`);
 }finally{await provider.destroy();if(fd!==undefined){closeSync(fd);unlinkSync(lock);}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error.shortMessage||error.message).replace(/https?:\/\/[^\s)"']+/g,'[RPC URL redacted]').replace(/(?:alch_|nfp_)[A-Za-z0-9]+/g,'[credential redacted]').slice(0,1000));process.exitCode=1;});
