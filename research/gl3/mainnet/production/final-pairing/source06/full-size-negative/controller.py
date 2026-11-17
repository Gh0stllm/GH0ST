"""Review-gated ordinary06 negative full-size transport probe; Runpod only.

No valid execution creation is sent. The invalid final argument must be rejected
before the execution callback. Default invocation never launches a service.
"""
from pathlib import Path
import argparse,base64,datetime,hashlib,hmac,http.client,json,os,shutil,signal,socket,struct,subprocess,sys,time

GiB=1024**3
CHUNK=128*1024
WS_GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
XOR_TABLES=[bytes(i^n for i in range(256)) for n in range(256)]

def sha_file(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for data in iter(lambda:stream.read(CHUNK),b''):h.update(data)
 return h.hexdigest()

def save(path,value):
 Path(path).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')

def cgroup_working_set():
 v1=Path('/sys/fs/cgroup/memory')
 if (v1/'memory.usage_in_bytes').is_file():
  usage=int((v1/'memory.usage_in_bytes').read_text());limit=int((v1/'memory.limit_in_bytes').read_text());stat=dict(line.split() for line in (v1/'memory.stat').read_text().splitlines());inactive=int(stat.get('total_inactive_file',stat.get('inactive_file','0')));version=1
 elif Path('/sys/fs/cgroup/memory.current').is_file():
  root=Path('/sys/fs/cgroup');usage=int((root/'memory.current').read_text());raw=(root/'memory.max').read_text().strip()
  if raw=='max':raise RuntimeError('finite cgroup memory limit required')
  limit=int(raw);stat=dict(line.split() for line in (root/'memory.stat').read_text().splitlines());inactive=int(stat.get('inactive_file','0'));version=2
 else:raise RuntimeError('supported memory cgroup unavailable')
 if limit<=0 or limit>2**60:raise RuntimeError('finite cgroup memory limit required')
 working=max(0,usage-inactive)
 return {'version':version,'usageBytes':usage,'inactiveFileBytes':inactive,'workingSetBytes':working,'limitBytes':limit,'headroomBytes':limit-working,'formula':'max(0,usage-inactive_file); cgroup v1 uses total_inactive_file'}

def processes():
 rows={}
 for q in Path('/proc').glob('[0-9]*'):
  try:
   raw=(q/'stat').read_text();fields=raw[raw.rfind(')')+2:].split();rss=0
   for line in (q/'status').read_text().splitlines():
    if line.startswith('VmRSS:'):rss=int(line.split()[1])*1024;break
   rows[int(q.name)]={'ppid':int(fields[1]),'startTicks':int(fields[19]),'rssBytes':rss,'state':fields[0]}
  except (OSError,ValueError,IndexError):pass
 return rows

def owned_stats(worker_pid):
 rows=processes();owned={worker_pid};changed=True
 while changed:
  changed=False
  for pid,row in rows.items():
   if row['ppid'] in owned and pid not in owned:owned.add(pid);changed=True
 owned.add(os.getpid())
 return {'pids':sorted(p for p in owned if p in rows),'aggregateRSSBytes':sum(rows[p]['rssBytes'] for p in owned if p in rows)}

def stop_owned_group(child):
 if child.poll() is not None:return
 if os.getpgid(child.pid)!=child.pid:raise RuntimeError('refusing to signal an unexpected process group')
 os.killpg(child.pid,signal.SIGTERM)
 try:child.wait(10)
 except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()

def token(secret):
 enc=lambda b:base64.urlsafe_b64encode(b).rstrip(b'=')
 body=enc(b'{"alg":"HS256","typ":"JWT"}')+b'.'+enc(json.dumps({'iat':int(time.time())},separators=(',',':')).encode())
 return (body+b'.'+enc(hmac.new(secret,body,hashlib.sha256).digest())).decode()

def frame(payload,opcode,fin=True):
 mask=os.urandom(4);length=len(payload);header=bytes([(0x80 if fin else 0)|opcode])
 if length<126:header+=bytes([0x80|length])
 elif length<65536:header+=bytes([0x80|126])+struct.pack('!H',length)
 else:header+=bytes([0x80|127])+struct.pack('!Q',length)
 encoded=bytearray(payload)
 for i in range(4):encoded[i::4]=payload[i::4].translate(XOR_TABLES[mask[i]])
 return header+mask+encoded

def recv_exact(sock,n):
 result=bytearray()
 while len(result)<n:
  chunk=sock.recv(n-len(result))
  if not chunk:raise RuntimeError('unexpected socket EOF')
  result.extend(chunk)
 return bytes(result)

def ws_response(sock,send):
 data=bytearray();started=False
 while True:
  first,second=recv_exact(sock,2);fin=bool(first&0x80);opcode=first&15;length=second&127
  if second&0x80:raise RuntimeError('unexpected masked server frame')
  if length==126:length=struct.unpack('!H',recv_exact(sock,2))[0]
  elif length==127:length=struct.unpack('!Q',recv_exact(sock,8))[0]
  if length>4096:raise RuntimeError('response frame exceeds small-response bound')
  payload=recv_exact(sock,length)
  if opcode==9:send(frame(payload,10));continue
  if opcode==10:continue
  if opcode==8:raise RuntimeError('unexpected WS close: '+str(struct.unpack('!H',payload[:2])[0] if len(payload)>1 else None))
  if opcode not in (0,1,2) or (opcode==0 and not started):raise RuntimeError('unexpected WS opcode')
  started=True;data.extend(payload)
  if len(data)>4096:raise RuntimeError('response exceeds small-response bound')
  if fin:return bytes(data)

def connect(port):
 sock=socket.create_connection(('127.0.0.1',port),timeout=180);sock.settimeout(180);return sock

def http_request(port,secret,body=None,declared=None,authenticate=True,stream=None):
 sock=connect(port);body=b'' if body is None else body;length=len(body) if declared is None else declared
 headers=['POST / HTTP/1.1',f'Host: 127.0.0.1:{port}','Content-Type: application/json',f'Content-Length: {length}','Connection: close']
 if authenticate:headers.append('Authorization: Bearer '+token(secret))
 header=('\r\n'.join(headers)+'\r\n\r\n').encode();wire=hashlib.sha256();wire_count=0
 def send(data):
  nonlocal wire_count
  sock.sendall(data);wire.update(data);wire_count+=len(data)
 try:
  send(header)
  if stream is not None:payload=stream(send)
  elif body:send(body);payload=None
  else:payload=None
  response=http.client.HTTPResponse(sock);response.begin();raw=response.read(4097)
  if len(raw)>4096:raise RuntimeError('HTTP response exceeds4096bytes')
  return {'httpStatus':response.status,'response':raw.decode(),'wireBytesSentIncludingHTTPHeaders':wire_count,'wireSHA256IncludingHTTPHeaders':wire.hexdigest(),'requestHeaderBytes':len(header),'payload':payload}
 finally:sock.close()

def small_rpc(port,secret,method):
 body=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':[]},separators=(',',':')).encode();result=http_request(port,secret,body=body)
 if result['httpStatus']!=200:raise RuntimeError('small authenticated RPC status mismatch')
 parsed=json.loads(result['response'])
 if 'error' in parsed:raise RuntimeError('small RPC returned error')
 return parsed['result']

def own_port(pid):
 inodes=set()
 try:
  for fd in (Path('/proc')/str(pid)/'fd').iterdir():
   try:
    target=os.readlink(fd)
    if target.startswith('socket:['):inodes.add(target[8:-1])
   except OSError:pass
 except OSError:return None
 ports=[]
 for line in Path('/proc/net/tcp').read_text().splitlines()[1:]:
  parts=line.split()
  if parts[3]=='0A' and parts[9] in inodes:
   addr,port=parts[1].split(':')
   if addr!='0100007F':raise RuntimeError('probe has unexpected non-loopback TCP listener')
   ports.append(int(port,16))
 if len(ports)>1:raise RuntimeError('probe has unexpected multiple TCP listeners')
 return ports[0] if ports else None

def payload_parts(profile,request_id):
 prefix=('{'+'"jsonrpc":"2.0","id":'+str(request_id)+',"method":"validation_createExecutionRun","params":["'+profile['moduleRoot']+'",').encode()
 suffix=b',"gl3-negative-not-a-bool"]}'
 return prefix,suffix

def stream_input(profile,prefix,suffix,send):
 p=Path(profile['input']['path']);before=p.stat();payload=hashlib.sha256();input_hash=hashlib.sha256();count=0;input_count=0
 def put(chunk):
  nonlocal count
  send(chunk);payload.update(chunk);count+=len(chunk)
 put(prefix)
 with p.open('rb') as stream:
  for chunk in iter(lambda:stream.read(CHUNK),b''):put(chunk);input_hash.update(chunk);input_count+=len(chunk)
 put(suffix);after=p.stat()
 if input_count!=profile['input']['bytes'] or input_hash.hexdigest()!=profile['input']['SHA256']:raise RuntimeError('streamed original input byte identity mismatch')
 if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):raise RuntimeError('original input file changed during transfer')
 return {'rpcMessageBytes':count,'rpcMessageSHA256':payload.hexdigest(),'originalInputBytes':input_count,'originalInputSHA256':input_hash.hexdigest(),'originalInputUnchanged':True,'prefixBytes':len(prefix),'suffixBytes':len(suffix)}

def check_negative(result):
 parsed=json.loads(result);error=parsed.get('error',{})
 if error.get('code')!=-32602 or 'invalid argument 2' not in error.get('message','') or 'bool' not in error.get('message','') or 'result' in parsed:raise RuntimeError('mandatory invalid-argument2 Boolean error absent')
 return parsed

def websocket_full(port,secret,profile):
 sock=connect(port);key=base64.b64encode(os.urandom(16)).decode();headers=('GET / HTTP/1.1\r\nHost: 127.0.0.1:'+str(port)+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\nOrigin: http://localhost\r\nAuthorization: Bearer '+token(secret)+'\r\n\r\n').encode();wire=hashlib.sha256();wire_count=0
 def send(data):
  nonlocal wire_count
  sock.sendall(data);wire.update(data);wire_count+=len(data)
 try:
  send(headers);response=bytearray()
  while not response.endswith(b'\r\n\r\n'):
   response.extend(recv_exact(sock,1))
   if len(response)>16384:raise RuntimeError('WS handshake headers oversized')
  lines=response.decode().split('\r\n');values={x.split(':',1)[0].lower():x.split(':',1)[1].strip() for x in lines[1:] if ':' in x}
  accepted=base64.b64encode(hashlib.sha1((key+WS_GUID).encode()).digest()).decode()
  if not lines[0].startswith('HTTP/1.1 101 ') or values.get('sec-websocket-accept')!=accepted:raise RuntimeError('authenticated WS handshake failed')
  prefix,suffix=payload_parts(profile,102);send(frame(prefix,1,False));payload=hashlib.sha256();payload.update(prefix);ih=hashlib.sha256();count=len(prefix);original=0;p=Path(profile['input']['path']);before=p.stat()
  with p.open('rb') as stream:
   for data in iter(lambda:stream.read(CHUNK),b''):send(frame(data,0,False));payload.update(data);ih.update(data);count+=len(data);original+=len(data)
  send(frame(suffix,0,True));payload.update(suffix);count+=len(suffix);after=p.stat()
  if original!=profile['input']['bytes'] or ih.hexdigest()!=profile['input']['SHA256'] or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):raise RuntimeError('WS original input identity changed')
  result=ws_response(sock,send);parsed=check_negative(result.decode())
  return {'rpcMessageBytes':count,'rpcMessageSHA256':payload.hexdigest(),'originalInputBytes':original,'originalInputSHA256':ih.hexdigest(),'originalInputUnchanged':True,'wireBytesSentIncludingHandshakeMasksAndFrames':wire_count,'wireSHA256IncludingHandshakeMasksAndFrames':wire.hexdigest(),'fragmentPayloadMaximumBytes':CHUNK,'response':parsed}
 finally:sock.close()

def worker(profile,out):
 server=None;secret=None
 try:
  for label,row in profile['immutableFiles'].items():
   p=Path(row['path'])
   if p.stat().st_size!=row['bytes'] or sha_file(p)!=row['SHA256']:raise RuntimeError('immutable artifact mismatch: '+label)
  inp=Path(profile['input']['path'])
  if inp.stat().st_size!=profile['input']['bytes'] or sha_file(inp)!=profile['input']['SHA256']:raise RuntimeError('original input artifact mismatch')
  collection=out/'machines';collection.mkdir();machine=Path(profile['machineDirectory']);(collection/profile['moduleRoot'][2:]).symlink_to(machine,target_is_directory=True);(collection/'latest').symlink_to(machine,target_is_directory=True)
  actual=(machine/'module-root.txt').read_text().strip().removeprefix('0x')
  if actual!=profile['moduleRoot'][2:]:raise RuntimeError('machine collection module root mismatch')
  secret=os.urandom(32);jwt_path=out/'test-only.jwt';jwt_path.write_text(secret.hex());jwt_path.chmod(0o600)
  config={'conf':{'dump':False},'log-level':'WARN','log-type':'plaintext','workdir':str(out),'persistent':{'chain':str(out/'persistent')},'http':{'addr':''},'ws':{'addr':''},'ipc':{'path':''},'auth':{'addr':'127.0.0.1','port':0,'api':['validation'],'origins':['http://localhost'],'jwtsecret':str(jwt_path)},'metrics':False,'pprof':False,'validation':{'use-jit':False,'api-auth':True,'api-public':False,'rpc-request-max-bytes':profile['requestCapBytes'],'wasm':{'root-path':str(collection),'allowed-wasm-module-roots':[profile['moduleRoot']],'enable-wasmroots-check':True},'arbitrator':{'execution-run-timeout':'5m','experimental-bound-execution-creations':True,'output-path':str(out/'native-output'),'execution':{'cached-challenge-machines':2,'experimental-recorded-hash-stride':4294967296,'experimental-max-recorded-hashes':4096,'experimental-serialize-queries':True,'experimental-refine-ranges':True}}}}
  save(out/'server-config.json',config)
  with (out/'server.stdout').open('w') as stdout,(out/'server.stderr').open('w') as stderr:
   server=subprocess.Popen([profile['immutableFiles']['validator']['path'],'--conf.file='+str(out/'server-config.json')],stdout=stdout,stderr=stderr,env={**os.environ,'GOMAXPROCS':'2'})
   save(out/'server-process.json',{'pid':server.pid,'inheritedOwnedProcessGroup':os.getpgrp(),'binarySHA256':profile['immutableFiles']['validator']['SHA256']})
   deadline=time.monotonic()+60;port=None
   while time.monotonic()<deadline:
    if server.poll() is not None:raise RuntimeError('ordinary validator exited before listening')
    port=own_port(server.pid)
    if port:break
    time.sleep(.1)
   if port is None:raise RuntimeError('owned ephemeral auth listener absent')
   save(out/'endpoint.json',{'address':'127.0.0.1','port':port,'ownedServerPID':server.pid,'portSource':'owned socket inode in proc/net/tcp; no guessed/foreign endpoint'})
   unauth=http_request(port,secret,body=b'{}',authenticate=False)
   if unauth['httpStatus']!=401:raise RuntimeError('unauthenticated request not rejected401')
   name=small_rpc(port,secret,'validation_name');roots=small_rpc(port,secret,'validation_wasmModuleRoots')
   if name!='arbitrator' or roots!=[profile['moduleRoot']]:raise RuntimeError('actual ordinary validator identity/root mismatch')
   over=http_request(port,secret,declared=profile['requestCapBytes']+1)
   if over['httpStatus']!=413:raise RuntimeError('over-cap HTTP request not rejected413')
   save(out/'controls.json',{'unauthenticatedHTTPStatus':401,'actualServerName':name,'actualModuleRoots':roots,'declaredOverCapBytes':profile['requestCapBytes']+1,'declaredOverCapHTTPStatus':413,'overCapBodySentBytes':0,'publicServicesOrWalletsUsed':False})
   prefix,suffix=payload_parts(profile,101);size=len(prefix)+profile['input']['bytes']+len(suffix)
   begin=time.monotonic();result=http_request(port,secret,declared=size,stream=lambda send:stream_input(profile,prefix,suffix,send))
   if result['httpStatus']!=200:raise RuntimeError('full-size authenticated HTTP status mismatch')
   result['response']=check_negative(result['response']);result['seconds']=time.monotonic()-begin;save(out/'http-fullsize.json',result)
   begin=time.monotonic();result=websocket_full(port,secret,profile);result['seconds']=time.monotonic()-begin;save(out/'ws-fullsize.json',result)
   final_roots=small_rpc(port,secret,'validation_wasmModuleRoots')
   if final_roots!=roots:raise RuntimeError('advertised root changed')
  save(out/'worker-result.json',{'passed':True,'HTTPAndWSFullSizeNegativePassed':True,'validExecutionCreationRequested':False,'canonicalServerDigestEqualityClaimed':False,'zeroPositiveStepsInferredFromPinnedInvalidParamsBeforeCallback':True,'positiveStepCounterMeasured':False,'callbackRejectedBeforeInvocation':True,'inferenceScope':'Only this isolated private process and its recorded calls; spawner startup is lazy, not an execution counter','selectedArtifactsOrOriginalInputChanged':False})
 except BaseException as error:
  save(out/'worker-result.json',{'passed':False,'errorType':type(error).__name__,'boundedError':str(error)[:1024]});raise
 finally:
  if server is not None:
   if server.poll() is None:
    server.terminate()
    try:server.wait(10)
    except subprocess.TimeoutExpired:server.kill();server.wait()
   save(out/'server-exit.json',{'actualExitCode':server.returncode,'ownedServerPID':server.pid})
  if secret is not None and (out/'test-only.jwt').exists():(out/'test-only.jwt').unlink()

def controller(profile,out):
 if out.exists():raise RuntimeError('refusing to overwrite an earlier probe attempt')
 out.mkdir(parents=True,mode=0o700);out.chmod(0o700);start=time.monotonic();initial=cgroup_working_set();guards=profile['guards'];required=guards['ownedAggregateRSSCapBytes']+guards['mainWorkingSetReserveBytes'];samples=[]
 # Waiting is bounded by the same whole-controller deadline and never starts a service.
 while initial['headroomBytes']<required:
  if time.monotonic()-start>=guards['wallSeconds']:
   save(out/'controller-result.json',{'passed':False,'status':'WAITED_NO_LAUNCH','reason':'insufficient cgroup working-set headroom','requiredStartupHeadroomBytes':required,'cgroup':initial});return
  save(out/'waiting-for-headroom.json',{'requiredStartupHeadroomBytes':required,'cgroup':initial});time.sleep(2);initial=cgroup_working_set()
 if shutil.disk_usage(out).free<guards['minimumDiskFreeBytes']:raise RuntimeError('disk floor before process launch')
 profile_path=out/'profile.json';save(profile_path,profile);env={**os.environ,'GOMAXPROCS':'2'};cpus=sorted(os.sched_getaffinity(0))[-2:]
 with (out/'worker.stdout').open('w') as stdout,(out/'worker.stderr').open('w') as stderr:
  child=subprocess.Popen([sys.executable,__file__,'--worker','--profile',str(profile_path),'--output',str(out)],stdout=stdout,stderr=stderr,env=env,start_new_session=True,preexec_fn=lambda:os.sched_setaffinity(0,cpus))
  reason=None;peak=0;minimum_headroom=initial['headroomBytes'];minimum_disk=shutil.disk_usage(out).free;last=0
  save(out/'owned-worker-process.json',{'pid':child.pid,'processGroup':child.pid,'CPUs':cpus,'wallStartUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()})
  while child.poll() is None:
   current=cgroup_working_set();owned=owned_stats(child.pid);free=shutil.disk_usage(out).free;peak=max(peak,owned['aggregateRSSBytes']);minimum_headroom=min(minimum_headroom,current['headroomBytes']);minimum_disk=min(minimum_disk,free)
   logs=sum(q.stat().st_size for q in out.glob('*.stdout'))+sum(q.stat().st_size for q in out.glob('*.stderr'))
   if owned['aggregateRSSBytes']>guards['ownedAggregateRSSCapBytes']:reason='owned aggregate RSS cap'
   elif current['headroomBytes']<guards['mainWorkingSetReserveBytes']:reason='main cgroup working-set reserve'
   elif free<guards['minimumDiskFreeBytes']:reason='disk floor'
   elif logs>guards['maximumLogBytes']:reason='owned log-size cap'
   elif time.monotonic()-start>guards['wallSeconds']:reason='whole-controller wall deadline'
   if time.monotonic()-last>=2:
    samples.append({'elapsedSeconds':time.monotonic()-start,'owned':owned,'cgroup':current,'diskFreeBytes':free,'ownedLogBytes':logs});last=time.monotonic();save(out/'resource-samples.json',samples)
   if reason:stop_owned_group(child);break
   time.sleep(.25)
  code=child.wait()
 # Persist the actual worker exit before optional result inspection.
 save(out/'worker-actual-exit.json',{'actualExitCode':code,'guardReason':reason,'seconds':time.monotonic()-start})
 result=json.loads((out/'worker-result.json').read_text()) if (out/'worker-result.json').exists() else None
 final={'passed':code==0 and reason is None and bool(result and result.get('passed')),'actualExitCode':code,'guardReason':reason,'seconds':time.monotonic()-start,'peakSampledOwnedAggregateRSSBytes':peak,'minimumSampledCgroupWorkingSetHeadroomBytes':minimum_headroom,'minimumSampledDiskFreeBytes':minimum_disk,'initialCgroup':initial,'resourceFormula':'cgroup limit - max(0, usage - inactive_file), never host MemAvailable','rawInputSecondFileCreated':False,'validExecutionCreationRequested':False,'canonicalServerDigestEqualityClaimed':False,'productionActivation':False,'allExecutionOnRunpod':True}
 save(out/'controller-result.json',final)
 if not final['passed']:raise RuntimeError('negative probe failed; evidence retained')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--profile',required=True);parser.add_argument('--output');parser.add_argument('--run-authorized',action='store_true');parser.add_argument('--worker',action='store_true');args=parser.parse_args();profile=json.loads(Path(args.profile).read_text())
 if not(args.run_authorized or args.worker):print(json.dumps({'status':'PREPARED_NOT_LAUNCHED','profile':profile},indent=2));return
 if not args.output:raise RuntimeError('new isolated output path required')
 if args.worker:worker(profile,Path(args.output))
 else:controller(profile,Path(args.output))

if __name__=='__main__':main()
