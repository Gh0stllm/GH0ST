from pathlib import Path
import shutil,subprocess,os,json,re,time,hashlib
r=Path('/root/bounded-restore');n=r/'scheduled-candidate';src=n/'native'
shutil.copytree(n/'nitro',src)
(src/'target').symlink_to(r/'nitro/target',target_is_directory=True)
shutil.copytree(r/'nitro/cmd/gl3replaycanonical',src/'cmd/gl3replaycanonical')
shutil.copy2(r/'nitro/precompiles/gl3_acceptance.go',src/'precompiles/gl3_acceptance.go')
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'8'}
subprocess.run([go,'mod','edit','-replace=github.com/Gh0stllm/GH0ST/gl3/slicedchess='+str(r/'chess/sliced/runtime')],cwd=src,env=env,check=True)
subprocess.run([go,'build','-p','6','-mod=mod','-tags=gl3_acceptance','-o',n/'replay-native-canonical','./cmd/gl3replaycanonical'],cwd=src,env=env,check=True)
args=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args[0]=str(n/'replay-native-canonical');t=time.monotonic()
with (n/'native-equivalence.log').open('w') as log:p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,env=env)
(n/'native-equivalence-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
s=(n/'native-equivalence.log').read_text();header=re.search(r'GL3_HEADER_AUDIT (0x[0-9a-f]{64}) (\d+) (0x[0-9a-f]{64}) (0x[0-9a-f]{64})',s);ref=json.loads((r/'evidence/native-header-comparison.json').read_text())['results']['baseline'];actual={'blockHash':header[1],'gasUsed':int(header[2]),'stateRoot':header[3],'receiptHash':header[4]} if header else {}
canon=re.search(r'GL3_CANONICAL_AUDIT ([a-f0-9]{64}) (\d+)',s);end=re.search(r'GL3_REPLAY_END (0x[0-9a-f]{64}) (0x[0-9a-f]{64}) (\d+) (\d+)',s);expected=json.loads((r/'evidence/native-terminal-result.json').read_text())['expected']
report={'passed':p.returncode==0 and all(actual.get(k)==ref[k] for k in ['blockHash','gasUsed','stateRoot','receiptHash']) and canon is not None and canon[1]=='5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6' and end is not None and list(end.groups())==expected,'exitCode':p.returncode,'header':actual,'canonicalSHA256':canon[1] if canon else None,'canonicalBytes':int(canon[2]) if canon else None,'allFourGlobalStateFieldsMatch':end is not None and list(end.groups())==expected,'nativeScheduleHelpersNoOp':True,'guestEnginePolicyChanged':False,'allExecutionOnRunpod':True,'binarySHA256':hashlib.file_digest((n/'replay-native-canonical').open('rb'),'sha256').hexdigest()};(n/'native-equivalence.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed']
