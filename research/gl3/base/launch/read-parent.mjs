// Read-only unsigned deployment-input inventory. Never constructs a transaction.
import {Interface,keccak256} from '/root/dispute/node_modules/ethers/lib.esm/index.js';
import {writeFile} from 'node:fs/promises';
const endpoint='https://rpc.mainnet.chain.robinhood.com';
let id=0;async function rpc(method,params){const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const result=await response.json();if(result.error)throw Error(JSON.stringify(result.error));return result.result;}
const chainId=Number(BigInt(await rpc('eth_chainId',[])));if(chainId!==4663)throw Error('wrong chain '+chainId);
const header=await rpc('eth_getBlockByNumber',['latest',false]);
const token='0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
const code=await rpc('eth_getCode',[token,header.number]);
const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function totalSupply() view returns(uint256)','function owner() view returns(address)']);
const calls={};for(const name of ['name','symbol','decimals','totalSupply','owner']){try{const result=await rpc('eth_call',[{to:token,data:abi.encodeFunctionData(name,[])},header.number]);const value=abi.decodeFunctionResult(name,result)[0];calls[name]={status:'returned',value:String(value)};}catch(error){calls[name]={status:'unsupported-or-reverted',error:String(error).slice(0,300)};}}
const recheck=await rpc('eth_getBlockByNumber',[header.number,false]);if(recheck.hash!==header.hash)throw Error('observed block changed');
const report={schema:'gh0st.gl3.base.parent-input-read.v1',checkedUTC:new Date().toISOString(),scope:'READ_ONLY_ROBINHOOD_PARENT_TOKEN_INVENTORY_NOT_DEPLOYMENT_OR_AUDIT',endpointSource:'official-public-fallback',chainId,blockNumber:Number(BigInt(header.number)),blockHash:header.hash,blockTimestamp:Number(BigInt(header.timestamp)),blockRechecked:true,finalityProven:false,token:{address:token,runtimeBytes:(code.length-2)/2,runtimeKeccak256:keccak256(code),expectedRuntimeKeccak256:'0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164',calls},RPCRequests:id,privateKeysAccessed:false,signatures:0,transactionCalldataCreated:false,transactionsSubmitted:0,newAuthoritySelected:false};
if(report.token.runtimeKeccak256!==report.token.expectedRuntimeKeccak256)throw Error('token runtime changed');
await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({chainId,blockNumber:report.blockNumber,runtimeMatches:true,RPCRequests:id,transactionsSubmitted:0}));
