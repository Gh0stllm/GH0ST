"""Read-only private Geth IPC evidence capture, executed only on Runpod Linux."""
import json,os,pathlib,platform,socket,time,traceback
assert platform.system()=='Linux'
ROOT=pathlib.Path('/root/full-lifecycle-audit');ROOT.mkdir(exist_ok=True)
OUT=ROOT/'evidence';OUT.mkdir(exist_ok=True)
IPC='/tmp/nitro-l1-3654344101.ipc'
METHODS={'eth_chainId','eth_blockNumber','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_call','eth_getCode','eth_getBalance'}
def rpc(method,params):
 assert method in METHODS
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
  s.settimeout(30);s.connect(IPC);s.sendall((json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params})+'\n').encode());raw=b''
  while True:
   raw+=s.recv(1<<20)
   try:obj=json.loads(raw)
   except json.JSONDecodeError:continue
   if 'error' in obj:raise RuntimeError(str(obj['error']))
   return obj['result']
def save(name,obj):
 p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(obj,indent=2)+'\n');tmp.replace(p)
cursor=0;seen=set();started=time.time()
save('collector-start.json',{'startedAtUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'privateIPC':IPC,'allowedRPC':sorted(METHODS),'publicWrites':0})
while True:
 try:
  head=int(rpc('eth_blockNumber',[]),16)
  while cursor<=head:
   end=min(head,cursor+511);logs=rpc('eth_getLogs',[{'fromBlock':hex(cursor),'toBlock':hex(end)}]);save(f'logs/{cursor:09d}-{end:09d}.json',logs)
   for entry in logs:
    tx=entry['transactionHash']
    if tx not in seen:
     save('receipts/'+tx+'.json',rpc('eth_getTransactionReceipt',[tx]));save('transactions/'+tx+'.json',rpc('eth_getTransactionByHash',[tx]));seen.add(tx)
   cursor=end+1
  save('collector-progress.json',{'head':head,'nextBlock':cursor,'transactionsCaptured':len(seen),'elapsedSeconds':time.time()-started,'ipcAlive':True})
  for name in ['terminal-input-manifest.json','full-lifecycle-progress.json','full-lifecycle-result.json','full-lifecycle-one-step.json','source-manifest.json']:
   p=pathlib.Path('/root/full-lifecycle/evidence')/name
   if p.exists():save('fixture/'+name,json.loads(p.read_text()))
  time.sleep(1)
 except Exception as e:
  save('collector-error.json',{'error':str(e),'traceback':traceback.format_exc(),'nextBlock':cursor,'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
  if not pathlib.Path(IPC).exists():break
  time.sleep(1)
