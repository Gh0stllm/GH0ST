from pathlib import Path
import subprocess,os,json,re,shutil,time
r=Path('/root/bounded-restore');src=r/'nitro';cmd=src/'cmd/gl3replaycanonical';shutil.copytree(src/'cmd/gl3replayaudit',cmd)
s=(cmd/'main.go').read_text();anchor='"github.com/offchainlabs/nitro/wavmio"';s=s.replace(anchor,anchor+'\n"github.com/offchainlabs/nitro/precompiles"')
anchor='newBlock, _, _, err = arbos.ProduceBlock(message.Message, message.DelayedMessagesRead, lastBlockHeader, statedb, chainContext, false, core.NewMessageReplayContext(), false)'
after=r"""
  if err == nil {
   for _, tx := range newBlock.Transactions() {
    if tx.To() == nil || *tx.To()!=common.HexToAddress("0xa14") || len(tx.Data())<36 {continue}
    owner,e:=types.Sender(types.LatestSignerForChainID(tx.ChainId()),tx);if e!=nil{panic(e)}
    var job [32]byte;copy(job[:],tx.Data()[4:36])
    digest,size,imageRoot,deltas,e:=precompiles.GhostChessCanonicalForAcceptance(statedb,chainConfig,newBlock.NumberU64(),owner,job);if e!=nil{panic(e)}
    fmt.Printf("GL3_CANONICAL_AUDIT %s %d %x %d %s %x\n",digest,size,imageRoot,deltas,owner.Hex(),job)
    if digest!="5f9762c73c1309824a365e47f936d27975c6233770672803bcc6ffbba30f28c6" || size!=163085439 {panic("canonical state changed")}
   }
  }
"""
assert s.count(anchor)==1;s=s.replace(anchor,anchor+after);(cmd/'main.go').write_text(s)
go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'8','MALLOC_ARENA_MAX':'2'}
subprocess.run([go,'build','-p','6','-mod=mod','-tags=gl3_acceptance','-o',r/'replay-canonical','./cmd/gl3replaycanonical'],cwd=src,env=env,check=True)
args=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args[0]=str(r/'replay-canonical');t=time.monotonic()
with (r/'evidence/native-canonical.log').open('w') as log:p=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT)
(r/'evidence/native-canonical-exit.json').write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-t})+'\n')
s=(r/'evidence/native-canonical.log').read_text();canon=re.search(r'GL3_CANONICAL_AUDIT ([a-f0-9]{64}) (\d+) ([a-f0-9]{64}) (\d+) (0x[a-fA-F0-9]{40}) ([a-f0-9]{64})',s)
report={'passed':p.returncode==0 and canon is not None,'exitCode':p.returncode,'canonicalSHA256':canon[1] if canon else None,'canonicalBytes':int(canon[2]) if canon else None,'portableImageRoot':canon[3] if canon else None,'deltaCount':int(canon[4]) if canon else None,'owner':canon[5] if canon else None,'job':canon[6] if canon else None,'allExecutionOnRunpod':True,'acceptanceHelperAbsentFromGuest':True,'enginePolicyChanged':False};(r/'evidence/native-canonical-result.json').write_text(json.dumps(report,indent=2)+'\n');assert report['passed']
