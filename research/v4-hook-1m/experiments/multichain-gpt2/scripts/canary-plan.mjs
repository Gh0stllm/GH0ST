// Model-free, fixed-network transport canary. No RPC or wallet access.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const CANARY_KIND='rh-opbnb-canary';
export const CANARY_CONTRACT='RHOpBNBCanary';
export const CANARY_PACKET_BYTES=416;
export const CANARY_OPTIONS='0x0003010011010000000000000000000000000007a120';
export const CANARY_RAW_OPTIONS='0x010011010000000000000000000000000007a120';
export const CANARY_CHAINS=Object.freeze([
  Object.freeze({key:'robinhood',stage:0,role:'home',chainId:4663,eid:30416,endpoint:'0x6f475642a6e85809b1c36fa62763669b1b48dd5b',rpcEnv:'RH_RPC_URL',sendLibrary:'0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7',receiveLibrary:'0xe1844c5d63a9543023008d332bd3d2e6f1fe1043',requiredDVNs:Object.freeze(['0x1258a278519c7f4bd997a9c3bfd4aa802a028d89','0xd01ae6905d48315f7be10c7330aecf8360ef5b12'])}),
  Object.freeze({key:'opbnb',stage:1,role:'remote',chainId:204,eid:30202,endpoint:'0x1a44076050125825900e736c501f859c50fe728c',rpcEnv:'OPBNB_RPC_URL',sendLibrary:'0x44289609cc6781fa2c665796b6c5aabf9ffcedc5',receiveLibrary:'0x9c9e25f9fc4e8134313c2a9f5c719f5c9f4fbd95',requiredDVNs:Object.freeze(['0x3ebb618b5c9d09de770979d552b27d6357aff73b','0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b'])}),
]);
export function canonical(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);}
export const CANARY_IDENTITY=Object.freeze({version:1,kind:CANARY_KIND,packetBytes:CANARY_PACKET_BYTES,chains:CANARY_CHAINS.map(({chainId,eid})=>({chainId,eid}))});
export const CANARY_ROUTE_ID='0x'+createHash('sha256').update(canonical(CANARY_IDENTITY)).digest('hex');
export function makeCanaryPlan(){return {schemaVersion:1,status:'OFFLINE_CANARY_PLAN',routeKind:CANARY_KIND,routerContract:CANARY_CONTRACT,routeId:CANARY_ROUTE_ID,packetBytes:CANARY_PACKET_BYTES,receiveGas:500000,executorMode:'self-relay',identity:CANARY_IDENTITY,chains:CANARY_CHAINS.map(c=>({...c,requiredDVNs:[...c.requiredDVNs]})),modelWeights:0,publicTransactions:0};}
export function parseCanaryArgs(args,keys,flags=[]){const out={};for(const arg of args){if(flags.includes(arg)){assert(!out[arg.slice(2)],'Duplicate option');out[arg.slice(2)]=true;continue;}const m=/^--([a-z-]+)=(.+)$/.exec(arg);assert(m&&keys.includes(m[1]),'Unknown or malformed option');assert(!Object.hasOwn(out,m[1]),'Duplicate option');out[m[1]]=m[2];}return out;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert(process.argv.length===2,'Canary plan takes no arguments');console.log(JSON.stringify(makeCanaryPlan(),null,2));}
