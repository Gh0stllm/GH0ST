from pathlib import Path
import subprocess,os,json,re,hashlib,time
r=Path('/root/bounded-restore');go=r/'toolchain/go/bin/go';env={**os.environ,'PATH':str(go.parent)+':'+os.environ['PATH'],'GOTOOLCHAIN':'local','GOMAXPROCS':'12','MALLOC_ARENA_MAX':'2'}
# Separate commands add native reporting only. They are excluded from guest builds.
original=(r/'nitro/cmd/replay/main.go').read_text()
anchor='wavmio.SetLastBlockHash(newBlockHash)'
assert original.count(anchor)==1
code='//go:build !wasm\n\n'+original.replace(anchor,'fmt.Printf("GL3_HEADER_AUDIT %s %d %s %s\\n", newBlockHash.Hex(), newBlock.GasUsed(), newBlock.Root().Hex(), newBlock.ReceiptHash().Hex())\n\t'+anchor)
audit=r/'nitro/cmd/gl3replayaudit';audit.mkdir(exist_ok=True);(audit/'main.go').write_text(code)
# Restore the baseline byte-for-byte from authenticated original archives.
import tarfile
for f,digest in json.loads((r/'kit/source-before.json').read_text()).items():
 archive=r/'geth.tar.gz' if f.startswith('go-ethereum/') else Path('/root/native-go.tar')
 member=('go-ethereum-30456d24d3cff444d3b0f246e9c7609477c7d4a1/'+f.removeprefix('go-ethereum/')) if f.startswith('go-ethereum/') else 'nitro/'+f
 with tarfile.open(archive) as t:raw=t.extractfile(member).read()
 assert hashlib.sha256(raw).hexdigest()==digest,f
 (r/'nitro-baseline'/f).write_bytes(raw)

# Test-only extension fixtures cannot compile against the unpatched baseline.
for p in [r/'nitro-baseline/go-ethereum/core/state/gl3_uncached_code_test.go',r/'nitro-baseline/go-ethereum/arbitrum/gl3_uncached_recorder_test.go',r/'nitro-baseline/precompiles/gl3_sealed_delta_test.go']:p.unlink()
results={}
for label,source in [('baseline',r/'nitro-baseline'),('candidate',r/'nitro')]:
 binary=r/('replay-header-'+label)
 subprocess.run([go,'build','-p','8','-mod=mod','-o',binary,'./cmd/gl3replayaudit'],cwd=source,env=env,check=True)
 prior=json.loads((r/'evidence/native-terminal-process.json').read_text())['args'];args=[str(binary),*prior[1:]]
 started=time.monotonic()
 with (r/'evidence'/('header-'+label+'.log')).open('w') as log:p=subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT)
 (r/'evidence'/('header-'+label+'-exit.json')).write_text(json.dumps({'exitCode':p.returncode,'seconds':time.monotonic()-started})+'\n')
 output=(r/'evidence'/('header-'+label+'.log')).read_text();m=re.search(r'GL3_HEADER_AUDIT (0x[0-9a-f]{64}) (\d+) (0x[0-9a-f]{64}) (0x[0-9a-f]{64})',output)
 assert p.returncode==0 and m,output[-5000:]
 results[label]={'blockHash':m[1],'gasUsed':int(m[2]),'stateRoot':m[3],'receiptHash':m[4],'binarySHA256':hashlib.file_digest(binary.open('rb'),'sha256').hexdigest()}
compare={k:results['baseline'][k]==results['candidate'][k] for k in ['blockHash','gasUsed','stateRoot','receiptHash']}
(r/'evidence/native-header-comparison.json').write_text(json.dumps({'passed':all(compare.values()),'same':compare,'results':results,'nativeReportingOnly':True,'allExecutionOnRunpod':True},indent=2)+'\n')
assert all(compare.values())
