import { getAddress, id } from 'ethers';

const ZERO = '0x'+'0'.repeat(40);
const TRANSFER = id('Transfer(address,address,uint256)');
const SHAPES = new Map([
  [id('Swap(address,uint256,uint256,uint256,uint256,address)'),4],
  [id('Swap(address,address,int256,int256,uint160,uint128,int24)'),5],
  [id('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'),6],
]);
const RECEIPTS = 12, LOG_LIMIT = 3000, DISPLAY_LIMIT = 12;
const hash = value => typeof value==='string' && /^0x[\da-f]{64}$/i.test(value);
const integer = value => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value)>=0;
const lower = value => typeof value==='string' ? value.toLowerCase() : '';
const address = value => /^0x[\da-f]{40}$/i.test(value) ? getAddress(value.toLowerCase()) : null;
const topicAddress = value => /^0x0{24}[\da-f]{40}$/i.test(value) ? address('0x'+value.slice(-40)) : null;
const optional = promise => promise.catch(()=>null);
const hex = number => '0x'+number.toString(16);

function groupTransfers(logs, target, origin, end, creation) {
  const sorted = logs.slice(0,LOG_LIMIT).filter(log =>
    !log?.removed && lower(log?.address)===lower(target) && hash(log.transactionHash) &&
    hash(log.blockHash) && integer(log.blockNumber) && integer(log.transactionIndex) &&
    Number(log.blockNumber)>=origin && Number(log.blockNumber)<=end &&
    (Number(log.blockNumber)!==origin || (lower(log.blockHash)===lower(creation.blockHash) && Number(log.transactionIndex)>=Number(creation.transactionIndex))) &&
    log.topics?.length===3 && lower(log.topics[0])===TRANSFER &&
    /^0x[\da-f]{64}$/i.test(log.data) && BigInt(log.data)>0n
  ).sort((a,b)=>Number(a.blockNumber)-Number(b.blockNumber)||Number(a.transactionIndex)-Number(b.transactionIndex));
  const txs=new Map();
  for (const log of sorted) {
    const from=topicAddress(log.topics[1]), to=topicAddress(log.topics[2]);
    if (!from || !to) continue;
    const key=lower(log.transactionHash);
    let tx=txs.get(key);
    if (!tx) {
      tx={hash:key,height:Number(log.blockNumber),position:Number(log.transactionIndex),blockHash:lower(log.blockHash),
        endpoints:new Set(),recipients:new Set(),eligible:false,state:'distribution',sender:null};
      txs.set(key,tx);
    }
    if (tx.blockHash!==lower(log.blockHash) || tx.position!==Number(log.transactionIndex)) throw Error('Inconsistent chain snapshot');
    if (to!==ZERO) tx.recipients.add(to);
    if (from!==ZERO && to!==ZERO) {
      tx.endpoints.add(lower(from));tx.endpoints.add(lower(to));tx.eligible=true;tx.state='unsampled';
    }
  }
  return [...txs.values()];
}

function classifyReceipt(tx, r) {
  if (!r || lower(r.transactionHash)!==tx.hash || lower(r.blockHash)!==tx.blockHash ||
      !integer(r.blockNumber) || Number(r.blockNumber)!==tx.height || !integer(r.transactionIndex) ||
      Number(r.transactionIndex)!==tx.position || r.status!=='0x1' || !address(r.from) || !Array.isArray(r.logs)) {
    tx.state='unavailable';return;
  }
  tx.sender=address(r.from);
  const linked=r.logs.some(log=>{
    const words=SHAPES.get(lower(log?.topics?.[0]));
    return words!==undefined && !log.removed && log.topics.length===3 &&
      /^0x[\da-f]+$/i.test(log.data) && log.data.length===2+64*words && tx.endpoints.has(lower(log.address));
  });
  tx.state=linked?'swap':'checked';
}

async function fundingCandidates(net, wallet, through) {
  const query=new URLSearchParams({module:'account',action:'txlist',address:wallet,startblock:'0',endblock:String(through),page:'1',offset:'20',sort:'desc'});
  const response=await fetch(net.explorer+'/api?'+query,{signal:AbortSignal.timeout(5000),credentials:'omit'});
  if (!response.ok) throw Error('Explorer unavailable');
  const body=await response.json();
  if (!Array.isArray(body.result)) throw Error('No history');
  return body.result.filter(row=>lower(row.to)===lower(wallet) && address(row.from) && lower(row.from)!==lower(wallet) &&
    hash(row.hash) && integer(row.blockNumber) && Number(row.blockNumber)<=through &&
    row.isError==='0' && /^\d+$/.test(row.value) && BigInt(row.value)>0n);
}

async function sharedFunding(net, txs, rpc) {
  const senders=[...new Set(txs.map(tx=>tx.sender))].slice(0,3);
  if (senders.length<2) return null;
  // Exclude the launch-swap block to ensure every candidate predates the sampled swaps.
  const through=txs[0].height-1;
  const history=await Promise.all(senders.map(wallet=>optional(fundingCandidates(net,wallet,through))));
  const candidates=new Map();
  history.forEach((rows,i)=>{
    for (const row of rows||[]) {
      const funder=address(row.from);
      if (!candidates.has(funder)) candidates.set(funder,new Map());
      const recipients=candidates.get(funder);
      if (!recipients.has(senders[i])) recipients.set(senders[i],row);
    }
  });
  const summary={sampled:senders.length,available:history.filter(Array.isArray).length,match:null};
  const pair=[...candidates].find(([,rows])=>rows.size>=2);
  if (!pair) return summary;
  const [funder,recipients]=pair;
  const proofs=await Promise.all([...recipients].slice(0,2).map(async ([recipient,row])=>{
    const [tx,r]=await Promise.all([optional(rpc('eth_getTransactionByHash',[row.hash])),optional(rpc('eth_getTransactionReceipt',[row.hash]))]);
    if (!tx || !r || r.status!=='0x1' || !hash(r.blockHash) || lower(tx.blockHash)!==lower(r.blockHash) ||
        !integer(r.blockNumber) || Number(r.blockNumber)>through || lower(tx.hash)!==lower(row.hash) ||
        lower(r.transactionHash)!==lower(row.hash) || lower(tx.from)!==lower(funder) || lower(tx.to)!==lower(recipient) ||
        !/^0x[\da-f]+$/i.test(tx.value) || BigInt(tx.value)<=0n) return null;
    return {recipient,tx:row.hash};
  }));
  if (proofs.every(Boolean)) summary.match={funder,proofs};
  return summary;
}

// At most ten launch blocks, twelve transfer receipts, and (only for multiple
// same-block swap senders) three history pages and four funding-proof RPC calls.
export async function readLaunchWindow(net,target,origin,creation,rpc,scanBlock) {
  const end=Math.min(origin+9,scanBlock);
  const logs=await rpc('eth_getLogs',[{address:target,fromBlock:hex(origin),toBlock:hex(end),topics:[TRANSFER]}]);
  if (!Array.isArray(logs)) throw Error('Launch logs unavailable');
  const truncated=logs.length>LOG_LIMIT;
  const txs=groupTransfers(logs,target,origin,end,creation);
  const eligible=txs.filter(tx=>tx.eligible);
  const sampled=eligible.slice(0,RECEIPTS);
  for (let i=0;i<sampled.length;i+=3) {
    await Promise.all(sampled.slice(i,i+3).map(async tx=>
      classifyReceipt(tx,tx.hash===lower(creation.transactionHash)?creation:await optional(rpc('eth_getTransactionReceipt',[tx.hash])))));
  }
  const blocks=Array.from({length:end-origin+1},(_,offset)=>{
    const height=origin+offset,rows=txs.filter(tx=>tx.height===height),matched=rows.filter(tx=>tx.state==='swap');
    const grouped=new Map();
    for (const tx of rows) for (const recipient of tx.recipients) grouped.set(recipient,1+(grouped.get(recipient)||0));
    return {height,transactions:rows.length,eligible:rows.filter(tx=>tx.eligible).length,
      checked:rows.filter(tx=>tx.state==='swap'||tx.state==='checked').length,
      swaps:matched.length,senders:new Set(matched.map(tx=>tx.sender)).size,
      recipients:grouped.size,repeatRecipients:[...grouped.values()].filter(n=>n>1).length,
      rows:rows.slice(0,DISPLAY_LIMIT).map(tx=>({hash:tx.hash,position:tx.position,state:tx.state,sender:tx.sender,recipients:tx.recipients.size}))};
  });
  const launch=txs.filter(tx=>tx.height===origin && tx.recipients.size>0);
  const biggest=[...launch].sort((a,b)=>b.recipients.size-a.recipients.size)[0];
  const matches=sampled.filter(tx=>tx.state==='swap');
  const sharedBlock=blocks.find(b=>b.senders>=2);
  const funding=sharedBlock?await sharedFunding(net,matches.filter(tx=>tx.height===sharedBlock.height),rpc):null;
  return {privateStatus:'Unknown',transactions:launch.length,recipients:blocks[0].recipients,maxRecipients:biggest?.recipients.size||0,tx:biggest?.hash,
    early:{origin,end,eligible:eligible.length,checked:blocks.reduce((n,b)=>n+b.checked,0),matches:matches.length,
      wallets:new Set(matches.map(tx=>tx.sender)).size,max:Math.max(0,...blocks.map(b=>b.swaps)),example:matches[0]?.hash,blocks,truncated,logLimit:LOG_LIMIT,funding}};
}

function el(tag,name,text) {
  const node=document.createElement(tag);
  if (name) node.className=name;
  if (text!==undefined) node.textContent=text;
  return node;
}
function explorerLink(base,kind,value,label){
  const a=el('a','bundle-link',label);
  a.href=base+'/'+kind+'/'+value;a.target='_blank';a.rel='noreferrer';
  return a;
}
const short=address=>address.slice(0,7)+'…'+address.slice(-5);
const labels={swap:'Swap-linked',checked:'No matching swap',unsampled:'Outside receipt sample',unavailable:'Receipt unavailable',distribution:'Mint / burn activity'};

export function mountBundles(container,r,intel){
  const section=el('section','bundle-workbench');
  const title=el('h3','bundle-title','Launch activity');
  section.append(title);
  if (!r.erc20) {
    section.append(el('p','bundle-caption','Launch transfer analysis requires an identified ERC-20 interface.'));
    container.replaceChildren(section);return;
  }
  const early=intel?.origin?.bundle?.early;
  if (!early?.blocks?.length) {
    section.append(el('p','bundle-caption','Launch evidence unavailable. The creation receipt or launch-window logs could not be retrieved.'));
    container.replaceChildren(section);return;
  }
  const blocks=early.blocks;
  const inspected=early.checked+' of '+early.eligible+' eligible receipts checked';
  section.append(el('p','bundle-caption','First '+blocks.length+' launch block'+(blocks.length===1?'':'s')+' · '+inspected+'.'));
  if (early.truncated) section.append(el('p','bundle-caution','Log limit reached. Values below cover the first '+early.logLimit.toLocaleString()+' returned logs.'));
  const multi=blocks.filter(b=>b.senders>=2);
  const signal=multi.length
    ? multi.length+' sampled block'+(multi.length===1?'':'s')+' with swap-linked transactions from multiple senders.'
    : early.checked || early.eligible===0 ? 'No multiple-sender swap cluster observed in the examined evidence.' : 'Swap cluster status unavailable; no eligible receipt was verified.';
  section.append(el('p','bundle-signal',signal));
  const chart=el('div','bundle-chart');
  chart.setAttribute('role','group');chart.setAttribute('aria-label','Select a launch block to inspect');
  section.append(el('p','bundle-legend','Transactions with positive token transfers per block. Select a bar for its receipt evidence.'),chart);
  const detail=el('div','bundle-detail');detail.setAttribute('aria-live','polite');section.append(detail);
  function selectBlock(index){
    [...chart.children].forEach((button,i)=>button.setAttribute('aria-pressed',String(index===i)));
    const b=blocks[index];
    const header=el('div','bundle-detail-head');
    header.append(el('strong',null,'Block '+b.height.toLocaleString()),explorerLink(r.explorer,'block',b.height,'Explorer ↗'));
    const details=el('p','bundle-caption',b.transactions+' transfer transactions · '+b.recipients+' recipients · '+b.repeatRecipients+' recipients in multiple transactions.');
    const receiptText=b.eligible===0?'No ordinary transfer transactions to check for swaps.':
      b.checked===0?'No verified swap receipts in the sample for this block.':
      b.swaps+' swap-linked transactions from '+b.senders+' distinct senders; '+b.checked+' of '+b.eligible+' eligible receipts checked.';
    detail.replaceChildren(header,details,el('p','bundle-caption',receiptText));
    if (b.rows.length) {
      const list=el('ul','bundle-txs');
      for (const tx of b.rows){
        const item=el('li','bundle-tx');
        item.append(explorerLink(r.explorer,'tx',tx.hash,'#'+tx.position+' · '+short(tx.hash)),el('span','bundle-tx-type',labels[tx.state]));
        if(tx.sender)item.append(explorerLink(r.explorer,'address',tx.sender,'Sender '+short(tx.sender)));
        list.append(item);
      }
      detail.append(list);
      if (b.transactions>b.rows.length) detail.append(el('small','bundle-caption','Showing the first '+b.rows.length+' transfer transactions in the block.'));
    }
  }
  blocks.forEach((b,index)=>{
    const button=el('button','bundle-bar');
    button.type='button';
    button.setAttribute('aria-label','Launch +'+index+', block '+b.height+', '+b.transactions+' transfer transactions');
    button.append(el('span','bundle-count',String(b.transactions)),el('span','bundle-stick level-'+Math.min(b.transactions,4)),el('span','bundle-offset','+'+index));
    button.addEventListener('click',()=>selectBlock(index));chart.append(button);
  });
  selectBlock(Math.max(0,blocks.findIndex(b=>b.senders>=2)));
  if (early.funding){
    const f=early.funding;
    const caption=el('p','bundle-caption');
    if (f.match){
      caption.append(el('strong',null,'Shared ETH sender observed. '),explorerLink(r.explorer,'address',f.match.funder,short(f.match.funder)),document.createTextNode(' sent ETH directly to two swap senders before the sampled block. '));
      f.match.proofs.forEach((proof,i)=>{if(i)caption.append(document.createTextNode(' · '));caption.append(explorerLink(r.explorer,'tx',proof.tx,'Transfer to '+short(proof.recipient)));});
    } else if (!f.available) caption.textContent='Previous ETH transfers unavailable for the sampled swap senders.';
    else caption.textContent='No verified shared ETH sender found in the reviewed histories ('+f.available+' of '+f.sampled+' sampled wallets, up to 20 transactions each).';
    section.append(caption);
  }
  section.append(el('p','bundle-footnote','Swap linkage uses recognized V2, V3 and V4 event shapes from a token-transfer endpoint. A shared sender may be an exchange or router. Private bundle membership and common wallet ownership remain unknown.'));
  container.replaceChildren(section);
}
