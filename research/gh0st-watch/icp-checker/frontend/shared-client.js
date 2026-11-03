const apiPath='/.netlify/functions/watcher-scans';
function endpoint(params){
  const origin=location.hostname.endsWith('.icp0.io') || location.hostname.endsWith('.ic0.app') ? 'https://gh0st.fyi' : location.origin;
  const url=new URL(apiPath,origin);
  if(params)url.search=new URLSearchParams(params);
  return url;
}
function request(url,method='GET'){
  return fetch(url,{method,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(65000)});
}
export async function listSharedScans(){
  const res=await request(endpoint());
  if(!res.ok)throw Error('Shared recent scans are temporarily unavailable.');
  const {entries}=await res.json();
  if(!Array.isArray(entries))throw Error('The shared list could not be read.');
  return entries.filter(e=>e && ['mainnet','testnet'].includes(e.network) && /^0x[\da-f]{40}$/i.test(e.address) &&
    typeof e.name==='string' && Number.isSafeInteger(e.scannedAt));
}
export async function openSharedScan({address,network},refresh,onStatus){
  const url=endpoint({network,address});
  if(refresh)url.searchParams.set('refresh','1');
  let method=refresh?'POST':'GET';
  const deadline=Date.now()+100000;
  do{
    const response=await request(url,method);
    if(method==='GET' && response.status===404){
      method='POST';onStatus('Running the first shared scan for this coin…');continue;
    }
    if(response.status===202){
      onStatus('A shared scan is in progress. Waiting for its result…');
      await new Promise(resolve=>setTimeout(resolve,2500));continue;
    }
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      const reason=typeof data?.error==='string'?data.error:'The shared scanner is temporarily unavailable.';
      const seconds=Number(data?.retryAfter);
      throw Error(response.status===429 && seconds>0 ? reason+' Try again in '+Math.ceil(seconds)+' seconds.' : reason);
    }
    const entry=data?.entry;
    if(!entry||entry.network!==network||typeof entry.address!=='string'||entry.address.toLowerCase()!==address.toLowerCase())throw Error('The shared scan did not match this contract.');
    return {entry,reused:method==='GET'||data.reused===true};
  }while(Date.now()<deadline);
  throw Error('The shared scan is still pending. Reopen this coin in a moment.');
}
