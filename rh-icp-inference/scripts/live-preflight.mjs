import fs from "node:fs";
import { AbiCoder, Contract, JsonRpcProvider, keccak256, toBeHex, toQuantity } from "ethers";
import { loadSources, SWAP_TOPIC } from "../worker/swaps.mjs";

// Read-only. Private endpoints are read from the environment and never saved.
const endpoint = process.env.RH_RPC_URL;
if (!endpoint) throw new Error("Set RH_RPC_URL through the private env file");
const provider = new JsonRpcProvider(endpoint, 4663, { staticNetwork: true });
const registry = JSON.parse(fs.readFileSync("swap-sources.json", "utf8"));
const pools = loadSources(registry, 4663);
const abi = AbiCoder.defaultAbiCoder();
const report = { observedAt: new Date().toISOString(), readOnly: true, chainId: 4663, pools: [], publicRpcChecks: [] };
let stage = "chain ID";
try {
  if (BigInt(await provider.send("eth_chainId", [])) !== 4663n) throw new Error();
  stage = "current block";
  const block = await provider.getBlock("latest");
  if (!block || Math.abs(Date.now()/1000 - block.timestamp) > 120) throw new Error();
  report.block = { number: block.number, hash: block.hash, timestamp: block.timestamp };
  report.gasPriceWei = (await provider.send("eth_gasPrice", [])).toString();
  for (const pool of pools) {
    stage = "pool state";
    const manager = new Contract(pool.manager, ["function extsload(bytes32) view returns(bytes32)"], provider);
    const slot = keccak256(abi.encode(["bytes32", "uint256"], [pool.pool_id, 6]));
    const [word, liq, managerCode, hookCode, tokenCode] = await Promise.all([
      manager.extsload(slot, {blockTag:block.number}),
      manager.extsload(toBeHex(BigInt(slot)+3n,32), {blockTag:block.number}),
      provider.getCode(pool.manager, block.number), provider.getCode(pool.hook, block.number),
      provider.getCode(registry.token, block.number),
    ]);
    const sqrt = BigInt(word) & ((1n<<160n)-1n);
    const logs = await provider.getLogs({ address:pool.manager, topics:[SWAP_TOPIC,pool.pool_id], fromBlock:Math.max(0,block.number-249), toBlock:block.number });
    report.pools.push({ ...pool, initialized:sqrt>0n, sqrtPriceX96:String(sqrt), activeLiquidity:String(BigInt(liq)), managerHasCode:managerCode!=="0x", hookHasCode:hookCode!=="0x", managerCodeHash:keccak256(managerCode), hookCodeHash:keccak256(hookCode), tokenCodeHash:keccak256(tokenCode), recentSwapCount:logs.length, latestSwap:logs.length?{transactionHash:logs.at(-1).transactionHash,blockNumber:logs.at(-1).blockNumber,logIndex:logs.at(-1).index}:null });
  }
  for (const url of ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"]) {
    const row = { url, chainIdMatches:false, observedBlockMatches:false };
    try {
      const call = async (method,params) => {
        const response = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(20000)});
        const value = await response.json(); if(value.error)throw new Error(); return value.result;
      };
      row.chainIdMatches = BigInt(await call("eth_chainId",[]))===4663n;
      row.observedBlockMatches = (await call("eth_getBlockByNumber",[toQuantity(block.number),false]))?.hash===block.hash;
    } catch { row.failed=true; }
    report.publicRpcChecks.push(row);
  }
  report.blockers = [];
  if (!report.pools.some(p=>p.initialized && BigInt(p.activeLiquidity)>0n)) report.blockers.push("Neither registered pool has active liquidity");
  if (!report.publicRpcChecks.every(r=>r.chainIdMatches && r.observedBlockMatches)) report.blockers.push("Two public coordinator RPCs are not yet verified against the same canonical block");
  fs.mkdirSync("build",{recursive:true});
  fs.writeFileSync("build/live-preflight.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
} catch {
  console.error(`Read-only RH preflight failed during ${stage}; private endpoint withheld.`);
  process.exitCode=1;
} finally { provider.destroy(); }
