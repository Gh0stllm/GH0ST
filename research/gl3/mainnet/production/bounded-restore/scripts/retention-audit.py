from pathlib import Path
import subprocess,os,json,re,shutil,time
r=Path('/root/bounded-restore');go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'6','MALLOC_ARENA_MAX':'2'};results={}
for label,src in [('baseline',r/'nitro-baseline'),('candidate',r/'nitro')]:
 cmd=src/'cmd/gl3replayretention';shutil.copytree(src/'cmd/gl3replayaudit',cmd)
 s=(cmd/'main.go').read_text().replace('"fmt"','"fmt"\n"reflect"')
 anchor='wavmio.OnFinal()'
 inspect=r"""objects:=reflect.ValueOf(statedb).Elem().FieldByName("stateObjects");totalCodeBytes,codeAccounts,dirtyCodeBytes:=0,0,0;iterator:=objects.MapRange();for iterator.Next(){object:=iterator.Value().Elem();n:=object.FieldByName("code").Len();if n>0{codeAccounts++;totalCodeBytes+=n;if object.FieldByName("dirtyCode").Bool(){dirtyCodeBytes+=n}}};fmt.Printf("GL3_ACCOUNT_RETENTION %d %d %d %d\n",objects.Len(),codeAccounts,totalCodeBytes,dirtyCodeBytes)
"""
 assert s.count(anchor)==1;(cmd/'main.go').write_text(s.replace(anchor,inspect+anchor))
 binary=r/('replay-retention-'+label);subprocess.run([go,'build','-p','6','-mod=mod','-o',binary,'./cmd/gl3replayretention'],cwd=src,env=env,check=True)
 args=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args[0]=str(binary);t=time.monotonic()
 with (r/'evidence'/('retention-'+label+'.log')).open('w') as log:p=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT)
 (r/'evidence'/('retention-'+label+'-exit.json')).write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
 s=(r/'evidence'/('retention-'+label+'.log')).read_text();m=re.search(r'GL3_ACCOUNT_RETENTION (\d+) (\d+) (\d+) (\d+)',s);assert p.returncode==0 and m
 results[label]={'accounts':int(m[1]),'codeAccounts':int(m[2]),'retainedCodeBytes':int(m[3]),'dirtyCodeBytes':int(m[4]),'blockHashMatches':'0x8d33a6345311761aef5c7ee9e5528350f17beda843d0563cfdd103aeec70d738' in s,'gas12306935':' 12306935 ' in s}
(r/'evidence/actual-terminal-account-retention.json').write_text(json.dumps({'passed':all(x['blockHashMatches'] and x['gas12306935'] for x in results.values()),'results':results,'nativeReadOnlyReflectionOnly':True,'instrumentationAbsentFromGuest':True,'allExecutionOnRunpod':True},indent=2)+'\n')
