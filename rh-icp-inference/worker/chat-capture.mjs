import {createHash} from 'node:crypto';

const COORD='6jacx-5yaaa-aaaaj-a65jq-cai';
const SOURCE=/^0x[0-9a-f]{64}$/;
const framed=prompt=>`<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
const generation=job=>String(job.voice?.[0]?.generation?.[0]??job.voice?.[0]?.attempt??1);
const sha=text=>createHash('sha256').update(text).digest('hex');

/** Parse only actual saved model text. Neither timestamps nor filenames alone
 * establish which source produced it. Full status requires an exact prompt
 * match and independent evidence that this candidate finished. */
export function parseChatArchive({raw,jobs=[],coordinatorId=COORD,filename=null,observedAt=Date.now(),terminalRecords=[]}={}){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536||coordinatorId!==COORD||!Number.isSafeInteger(observedAt))throw Error('Invalid saved-chat input');
 const base={rawSha256:sha(raw),filename,observedAt,complete:false,status:'unmatched',rawPreserved:true};
 const header=coordinatorId+'\n';if(!raw.startsWith(header))return{...base,reason:'Saved chat principal does not match coordinator'};
 const body=raw.slice(header.length),candidates=new Map();
 for(const wrapper of jobs){
  const job=wrapper?.job??wrapper,id=job?.request?.id?.toLowerCase(),prompt=job?.request?.prompt;
  if(!SOURCE.test(id??'')||typeof prompt!=='string'||!prompt.length)continue;
  const frame=framed(prompt);
  // llama.cpp may suppress control-token spellings when --special is off.
  // These are exact renderings of the same known frame, never substring guesses.
  const renderings=[frame,frame.replace(/<\|(?:im_start|im_end)\|>/g,''),frame.replace(/<\|(?:im_start|im_end)\|>|<\/?think>/g,'')];
  let offset=null;
  for(const prefix of renderings){if(body.startsWith(prefix)){offset=prefix.length;break;}if(body.startsWith('<|endoftext|>'+prefix)){offset='<|endoftext|>'.length+prefix.length;break;}}
  if(offset===null)continue;
  const gen=generation(job);if(!/^[1-9][0-9]*$/.test(gen))continue;
  const key=id+'::'+gen;const prior=candidates.get(key);
  if(!prior||(['Complete','ReadyToSign'].includes(Object.keys(job.phase??{})[0])&&!job.busy))candidates.set(key,{job,sourceId:id,generation:gen,offset,promptSha256:sha(prompt)});
 }
 if(candidates.size!==1)return{...base,status:candidates.size?'ambiguous':'unmatched',reason:candidates.size?'Identical prompt matches multiple sources or generations':'No exact framed prompt match',matches:[...candidates.values()].map(({sourceId,generation})=>({sourceId,generation}))};
 const match=[...candidates.values()][0],candidateRaw=body.slice(match.offset);
 const marker=/(<\|im_end\|>|<\|endoftext\|>)\s*$/.exec(candidateRaw);
 const text=marker?candidateRaw.slice(0,marker.index):candidateRaw;
 let complete=Boolean(marker),completionEvidence=marker?'model_end_token':null;
 const phase=Object.keys(match.job.phase??{})[0];
 if(!complete&&['ReadyToSign','Complete'].includes(phase)&&!match.job.busy&&typeof match.job.answer==='string'&&match.job.answer.length&&text.trim()===match.job.answer){complete=true;completionEvidence='complete_coordinator_answer';}
 let rejectionObserved=false;
 if(!complete){
  const terminal=terminalRecords.find(r=>r?.sourceId===match.sourceId&&String(r.generation)===match.generation&&r.skipped===true&&typeof r.skipReason==='string'&&r.skipReason.length&&Number.isSafeInteger(r.supersededAt)&&r.supersededAt<=observedAt);
  // A local fetch time cannot prove that a query returned the final remote
  // write. Preserve the evidence without promoting a possibly stale prefix.
  if(terminal)rejectionObserved=true;
 }
 return{...base,sourceId:match.sourceId,generation:match.generation,promptSha256:match.promptSha256,candidateRaw,text,complete,status:complete?'complete':'partial',completionEvidence,...(rejectionObserved?{rejectionObserved:true}: {})};
}
