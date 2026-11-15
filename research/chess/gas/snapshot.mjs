import { Interface, formatUnits } from 'ethers';
import { writeFileSync } from 'node:fs';
import { rpc, verifyChain, endpointSource } from './rpc.mjs';
const abi = new Interface([
  'function getPricesInWei() view returns(uint256 perL2Tx,uint256 perL1CalldataUnit,uint256 perStorageAllocation,uint256 perArbGasBase,uint256 perArbGasCongestion,uint256 perArbGasTotal)',
  'function getGasAccountingParams() view returns(uint256 speedLimitPerSecond,uint256 gasPoolMax,uint256 maxTxGasLimit)',
  'function getMaxTxGasLimit() view returns(uint256)',
  'function getMinimumGasPrice() view returns(uint256)',
  'function getL1BaseFeeEstimate() view returns(uint256)',
  'function getL1PricePerUnit() view returns(uint256)',
]);
const chainId = await verifyChain();
const [block,gasPrice,clientVersion] = await Promise.all([rpc('eth_getBlockByNumber',['latest',false]),rpc('eth_gasPrice'),rpc('web3_clientVersion')]);
const report = {scope:'Read-only Robinhood mainnet fee and resource snapshot; no transaction broadcast',checkedAt:new Date().toISOString(),chainId,endpointSource,clientVersion,block:{number:Number(BigInt(block.number)),hash:block.hash,timestamp:Number(BigInt(block.timestamp)),gasLimit:BigInt(block.gasLimit).toString(),baseFeePerGasWei:BigInt(block.baseFeePerGas).toString()},gasPriceWei:BigInt(gasPrice).toString(),gasPriceGwei:formatUnits(gasPrice,'gwei'),arbGasInfo:{}};
for (const name of ['getPricesInWei','getGasAccountingParams','getMaxTxGasLimit','getMinimumGasPrice','getL1BaseFeeEstimate','getL1PricePerUnit']) {
  try {
    const result = await rpc('eth_call',[{to:'0x000000000000000000000000000000000000006C',data:abi.encodeFunctionData(name)},block.number]);
    const decoded=abi.decodeFunctionResult(name,result);
    report.arbGasInfo[name]=Array.from(decoded,x=>x.toString());
  } catch(e) {report.arbGasInfo[name]={unavailable:true,code:e.rpcCode??null};}
}
writeFileSync(new URL('./mainnet-snapshot.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
