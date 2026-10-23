import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,readdir,lstat,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';

export const APPROVED_OVERLAYS=Object.freeze(['s0ul/index.html','s0ul-analysis-client.mjs','s0ul-analysis.mjs','s0ul-analysis.css','s0ul-analysis-deployment.json']);
const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MAX_ARCHIVE=64*1024*1024,MAX_EXPANDED=256*1024*1024,MAX_FILE=64*1024*1024;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const PUBLIC_RPCS=new Set(['https://rpc.mainnet.chain.robinhood.com','https://api.blockvectra.com/v1/robinhood_mainnet/public']);

function safePath(name){
  if(typeof name!=='string'||!name||name.length>1024||/[\\\u0000-\u001f\u007f]/.test(name)||name.startsWith('/')||/^[A-Za-z]:/.test(name))throw Error('Unsafe archive path');
  const directory=name.endsWith('/'),parts=(directory?name.slice(0,-1):name).split('/');
  if(parts.some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe archive path');
  return{name:parts.join('/'),directory};
}

// Inspect central-directory paths/types and expansion bounds before inflating.
// ZIP64, split archives, encrypted entries and filesystem links are unnecessary
// for the reviewed production archive and are deliberately not supported.
function inspectArchive(bytes){
  const b=Buffer.from(bytes);if(b.length<22||b.length>MAX_ARCHIVE)throw Error('Site archive size is outside its bounds');
  let end=-1;
  for(let at=b.length-22;at>=Math.max(0,b.length-65557);--at)if(b.readUInt32LE(at)===0x06054b50&&at+22+b.readUInt16LE(at+20)===b.length){end=at;break;}
  if(end<0)throw Error('Missing ZIP directory');
  const count=b.readUInt16LE(end+10),centralSize=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
  if(b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0||b.readUInt16LE(end+8)!==count||count===0||count===65535||count>10000||start+centralSize!==end)throw Error('Unsupported ZIP directory');
  const entries=[],seen=new Set();let at=start,total=0;
  for(let index=0;index<count;index++){
    if(at+46>end||b.readUInt32LE(at)!==0x02014b50)throw Error('Invalid ZIP directory entry');
    const flags=b.readUInt16LE(at+8),method=b.readUInt16LE(at+10),compressed=b.readUInt32LE(at+20),expanded=b.readUInt32LE(at+24),nameLength=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),comment=b.readUInt16LE(at+32),attributes=b.readUInt32LE(at+38),local=b.readUInt32LE(at+42);
    if(flags&1||![0,8].includes(method)||b.readUInt16LE(at+34)!==0||at+46+nameLength+extra+comment>end||compressed===0xffffffff||expanded>MAX_FILE)throw Error('Unsupported ZIP entry');
    const raw=b.subarray(at+46,at+46+nameLength);
    const name=new TextDecoder('utf-8',{fatal:true}).decode(raw),item=safePath(name),type=(attributes>>>16)&0xf000;
    if(type!==0&&type!==0x8000&&type!==0x4000||type===0x4000&&!item.directory||type===0x8000&&item.directory)throw Error('Archive links and special files are forbidden');
    if(seen.has(item.name))throw Error('Duplicate archive path');seen.add(item.name);
    if(local+30>start||b.readUInt32LE(local)!==0x04034b50||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method)throw Error('Invalid ZIP local entry');
    const localNameLength=b.readUInt16LE(local+26),localExtra=b.readUInt16LE(local+28),payload=local+30+localNameLength+localExtra;
    if(payload+compressed>start||!b.subarray(local+30,local+30+localNameLength).equals(raw))throw Error('ZIP local path differs from its directory');
    total+=expanded;if(total>MAX_EXPANDED)throw Error('Site archive expands beyond its bound');
    entries.push({...item,expanded,originalName:name});at+=46+nameLength+extra+comment;
  }
  if(at!==end)throw Error('Unexpected ZIP directory data');
  const files=new Set(entries.filter(item=>!item.directory).map(item=>item.name));
  for(const name of files){let parent=path.posix.dirname(name);while(parent!=='.'){if(files.has(parent))throw Error('An archive file shadows a directory');parent=path.posix.dirname(parent);}}
  return {entries,end};
}

export function inspectSiteArchive(bytes){return inspectArchive(bytes).entries;}

export function extractSiteArchive(bytes){
  const {entries,end}=inspectArchive(bytes);
  // A ZIP comment can contain a second EOCD signature. Give the inflater only
  // the inspected directory, so its independent EOCD search cannot select
  // uninspected metadata or bypass the expansion bounds above.
  const normalized=Buffer.from(new Uint8Array(bytes).subarray(0,end+22));normalized.writeUInt16LE(0,end+20);
  const unzipped=unzipSync(normalized),files=new Map();
  for(const item of entries){if(item.directory)continue;const contents=unzipped[item.originalName];if(!(contents instanceof Uint8Array)||contents.length!==item.expanded)throw Error('Inflated site entry does not match its directory');files.set(item.name,contents);}
  if(Object.keys(unzipped).length!==entries.length)throw Error('Unexpected inflated site entries');
  return files;
}

function manifestIdentity(value){
  if(value?.format!=='gh0st-production-site-base-v1'||!/^[0-9a-f]{64}$/.test(value.sha256??'')||!Number.isSafeInteger(value.sizeBytes)||value.sizeBytes<22||value.sizeBytes>MAX_ARCHIVE||!Number.isSafeInteger(value.fileCount)||value.fileCount<1||value.fileCount>10000)throw Error('Invalid frozen site manifest');
  return value;
}
function publicDeployment(bytes){
  const value=JSON.parse(Buffer.from(bytes).toString('utf8'));
  const forbidden=/private.?key|(?:worker|wallet|signer|signing).?key|mnemonic|seed.?phrase|secret|password|credential|authorization|access.?token|api.?key/i;
  const visit=(item)=>{if(Array.isArray(item)){item.forEach(visit);return;}if(item&&typeof item==='object')for(const[key,nested]of Object.entries(item)){if(forbidden.test(key))throw Error('Private credentials are forbidden in the public deployment');visit(nested);}};
  visit(value);
  if(value.chainId!==4663||value.confirmedComplete!==true)throw Error('The public analysis deployment must be confirmed on chain 4663');
  for(const key of ['executor','engine','model','reader','adapter','codec']){const item=value.contracts?.[key];if(!/^0x[0-9a-fA-F]{40}$/.test(item?.address??'')||/^0x0{40}$/i.test(item.address)||!/^0x[0-9a-fA-F]{64}$/.test(item?.codeHash??'')||/^0x0{64}$/i.test(item.codeHash))throw Error('Incomplete public analysis contract pin: '+key);}
  for(const key of ['modelId','domainSha256','schemaHash','configurationHash'])if(!/^0x[0-9a-fA-F]{64}$/.test(value[key]??'')||/^0x0{64}$/i.test(value[key]))throw Error('Incomplete public analysis identity: '+key);
  if(!PUBLIC_RPCS.has(String(value.publicRpc??'').replace(/\/$/,'')))throw Error('Public analysis RPC must be an approved keyless endpoint');
  return value;
}
async function loadArchive(manifest,archivePath,fetchImpl){
  let bytes;
  if(archivePath)bytes=await readFile(archivePath);
  else{
    if(typeof manifest.url!=='string'||!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(manifest.url))throw Error('The verified GitHub release asset URL has not been configured; use --archive for an explicit local frozen archive');
    const response=await fetchImpl(manifest.url,{signal:AbortSignal.timeout(60_000)});if(!response.ok)throw Error('The frozen production archive could not be fetched (HTTP '+response.status+')');
    if(!response.body)throw Error('The archive response has no body');
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>manifest.sizeBytes){await reader.cancel();throw Error('Frozen archive download exceeded its exact size');}chunks.push(value);}
    bytes=Buffer.concat(chunks,size);
  }
  if(bytes.length!==manifest.sizeBytes||sha256(bytes)!==manifest.sha256)throw Error('Frozen production archive size or SHA-256 mismatch');
  return bytes;
}
async function pathsUnder(directory,prefix=''){
  const result=[];for(const item of await readdir(path.join(directory,prefix),{withFileTypes:true})){const name=prefix?prefix+'/'+item.name:item.name;if(item.isDirectory())result.push(...await pathsUnder(directory,name));else if(item.isFile())result.push(name);else throw Error('Unexpected link or special file in output');}return result.sort();
}

export async function buildAnalysisSite({projectDir=PROJECT,archivePath,fetchImpl=globalThis.fetch}={}){
  const project=path.resolve(projectDir),manifest=manifestIdentity(JSON.parse(await readFile(path.join(project,'netlify/site-base.json'),'utf8')));
  const bytes=await loadArchive(manifest,archivePath,fetchImpl),base=extractSiteArchive(bytes);
  if(base.size!==manifest.fileCount)throw Error('The frozen production archive has an unexpected file count');
  const overlays=new Map();
  for(const name of APPROVED_OVERLAYS){const file=path.join(project,'website',name),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('An approved overlay must be a regular file: '+name);overlays.set(name,await readFile(file));}
  publicDeployment(overlays.get('s0ul-analysis-deployment.json'));
  const all=new Map(base);for(const[name,contents]of overlays)all.set(name,contents);
  const temporary=await mkdtemp(path.join(project,'.dist-build-')),output=path.join(project,'dist'),backup=temporary+'-previous';let backedUp=false;
  try{
    for(const[name,contents]of all){const destination=path.join(temporary,name);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,contents,{flag:'wx',mode:0o644});}
    const actual=await pathsUnder(temporary),expected=[...all.keys()].sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Output contains an unapproved file set');
    for(const[name,contents]of all)if(sha256(await readFile(path.join(temporary,name)))!==sha256(contents))throw Error('Output bytes differ: '+name);
    try{await rename(output,backup);backedUp=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await rename(temporary,output);}catch(error){if(backedUp)await rename(backup,output);throw error;}
    if(backedUp)await rm(backup,{recursive:true,force:true});
    const preserved=[...base.keys()].filter(name=>!overlays.has(name));
    return{format:'gh0st-site-build-preservation-v1',archiveSha256:manifest.sha256,baseFiles:base.size,outputFiles:all.size,preservedFiles:preserved.length,replacedFiles:[...overlays.keys()].filter(name=>base.has(name)),addedFiles:[...overlays.keys()].filter(name=>!base.has(name)),preservedSetSha256:sha256(Buffer.from(JSON.stringify(preserved.sort().map(name=>[name,sha256(base.get(name))])))),pdfs:Object.fromEntries([...base].filter(([name])=>name.toLowerCase().endsWith('.pdf')).map(([name,data])=>[name,sha256(data)])),overlaySha256:Object.fromEntries([...overlays].map(([name,data])=>[name,sha256(data)]))};
  }finally{await rm(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2);if(args.length!==0&&(args.length!==2||args[0]!=='--archive'))throw Error('Usage: npm run build -- [--archive /absolute/path/to/frozen-site.zip]');const report=await buildAnalysisSite({archivePath:args[1]});process.stdout.write(JSON.stringify(report,null,2)+'\n');}
  catch(error){process.stderr.write('Site build failed: '+String(error.message)+'\n');process.exitCode=1;}
}
