#!/usr/bin/env python3
"""Actual official backend/auth capability smoke, private loopback only."""
import hashlib,json,os,pathlib,signal,socket,subprocess,time
B=pathlib.Path('/workspace/gl3/same-day-mainnet/node');D=B/'backend-smoke';D.mkdir(exist_ok=False)
assert os.uname().nodename=='cc91695a75f7'
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
secret=D/'jwt.private';secret.write_text(os.urandom(32).hex());secret.chmod(0o600)
root='0xc10cd7ec6acaf1c441a3f6bd0900ad20f15855ba775a96f1939118cbc629dc97'
c={'log-level':'WARN','validation':{'use-jit':True,'api-auth':True,'api-public':False,'jit':{'workers':2,'jit-path':str(B/'bin/jit')},'arbitrator':{'workers':2},'wasm':{'root-path':'/workspace/gl3/durable/machines','allowed-wasm-module-roots':[root]}},'auth':{'addr':'127.0.0.1','port':port,'jwtsecret':str(secret)},'http':{'addr':''},'ws':{'addr':''},'ipc':{'path':''},'persistent':{'global-config':str(D/'config')}}
(D/'config.json').write_text(json.dumps(c,indent=2)+'\n')
js="""const fs=require('fs'),crypto=require('crypto'),WS=require('/root/dispute/node_modules/ws');const s=fs.readFileSync(process.argv[2],'utf8').trim(),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),a=enc({alg:'HS256',typ:'JWT'})+'.'+enc({iat:Math.floor(Date.now()/1000)}),jwt=a+'.'+crypto.createHmac('sha256',Buffer.from(s,'hex')).update(a).digest('base64url');const w=new WS(process.argv[3],{headers:{Authorization:'Bearer '+jwt}});let done=false;const t=setTimeout(()=>{console.error('bounded auth capability timeout');process.exit(1)},3000);w.on('open',()=>w.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'validation_wasmModuleRoots',params:[]})));w.on('message',x=>{const j=JSON.parse(x);if(j.error||!j.result?.includes(process.argv[4])){console.error(JSON.stringify(j));process.exit(1)}done=true;console.log(JSON.stringify({authenticated:true,roots:j.result,expectedRootSupported:true}));clearTimeout(t);w.close()});w.on('error',e=>{console.error(e.message);process.exit(1)});"""
(D/'auth-probe.cjs').write_text(js)
f=open(D/'backend.log','w');p=subprocess.Popen([str(B/'bin/nitro-val'),'--conf.file',str(D/'config.json')],stdout=f,stderr=f,start_new_session=True)
start=time.monotonic();result={'passed':False,'actualBackendPID':p.pid,'publicWrites':0,'modelOrEngineExecuted':False,'expectedRoot':root};attempts=[]
try:
 for _ in range(20):
  if p.poll() is not None:raise RuntimeError('backend startup exit '+str(p.returncode))
  r=subprocess.run(['node',str(D/'auth-probe.cjs'),str(secret),'ws://127.0.0.1:'+str(port),root],capture_output=True,text=True,timeout=5)
  attempts.append({'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
  if r.returncode==0:result['capability']=json.loads(r.stdout);result['passed']=True;break
  time.sleep(.2)
 if not result['passed']:raise RuntimeError('capability attempts exhausted')
except Exception as e:result['error']=str(e)
finally:
 if p.poll() is None:
  os.killpg(p.pid,signal.SIGINT)
  try:p.wait(15)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
 f.close();secret.unlink();result.update(seconds=time.monotonic()-start,actualBackendExitCode=p.returncode,ownedRemaining=0 if p.poll() is not None else 1,attempts=attempts)
 (D/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
raise SystemExit(0 if result['passed'] and p.returncode==0 else 1)
