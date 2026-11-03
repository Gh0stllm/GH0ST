import {getAddress} from 'ethers';
import {networks} from './scan.js';

const address=/^0x[0-9a-f]{40}$/i;
export async function resolveInput(raw, network) {
  const value=raw.trim();
  if(address.test(value))return {address:getAddress(value),network};
  let url;
  try{url=new URL(value)}catch{throw Error('Enter a contract address or an RH explorer or DexScreener pair link. Search by ticker in the directory below.')}
  if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port){
    const parts=url.pathname.split('/').filter(Boolean);
    for(const [key,net] of Object.entries(networks)){
      if(url.origin===net.explorer && ['token','address'].includes(parts[0]) && address.test(parts[1]))return {address:getAddress(parts[1]),network:key};
    }
    if(url.hostname==='dexscreener.com' && parts[0]?.toLowerCase()==='robinhood' && /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(parts[1]) && parts.length===2){
      const response=await fetch('https://api.dexscreener.com/latest/dex/pairs/robinhood/'+parts[1],{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('DexScreener could not resolve this pool. Use the token contract address.');
      const result=await response.json();
      const pair=result.pairs?.find(p=>p.chainId==='robinhood'&&p.pairAddress?.toLowerCase()===parts[1].toLowerCase()&&address.test(p.baseToken?.address));
      if(!pair)throw Error('No Robinhood Chain base token was found for that pool.');
      return {address:getAddress(pair.baseToken.address),network:'mainnet'};
    }
  }
  throw Error('Use an RH explorer address link, a Robinhood DexScreener pair link, or the token contract address.');
}
