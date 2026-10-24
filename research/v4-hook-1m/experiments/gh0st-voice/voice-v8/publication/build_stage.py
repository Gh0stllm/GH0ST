#!/usr/bin/env python3
"""Stage V7/V8 research locally; never contacts GitHub or another service."""
from __future__ import annotations

import argparse
from datetime import datetime,timezone
import gzip
import hashlib
import json
from pathlib import Path,PurePosixPath
import re
import shutil

RESEARCH_PREFIX=PurePosixPath('research/v4-hook-1m/experiments/gh0st-voice')
MAX_BLOB=90_000_000
RUNNING={'RUNNING','TRAINING','IN_PROGRESS','STARTING','QUEUED'}
BAD_PARTS={'__pycache__','node_modules','.git','.venv','venv','cache','caches',
           'encoded-base-before-number-fix','raw','downloads','revisions'}
SECRET_PATTERNS={
    'github_token':rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
    'netlify_token':rb'nfp_[A-Za-z0-9]{20,}',
    'openai_key':rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}',
    'aws_key':rb'(?:AKIA|ASIA)[A-Z0-9]{16}',
    'pem_private_key':rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'assigned_hex_private_key':rb'(?i)(?:private[_-]?key|secret[_-]?key)\s*[=:]\s*[\x22\x27]?0x[0-9a-f]{64}',
    'alchemy_token':rb'alch_[A-Za-z0-9_-]{16,}',
}
PATTERNS={name:re.compile(pattern)for name,pattern in SECRET_PATTERNS.items()}


def sha(path):
    h=hashlib.sha256()
    with path.open('rb')as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def git_blob(path):
    h=hashlib.sha1(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb')as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def scan_stream(stream,label):
    carry=b'';offset=0;findings=[]
    while True:
        block=stream.read(1024*1024)
        if not block:break
        data=carry+block
        for name,pattern in PATTERNS.items():
            for match in pattern.finditer(data):
                findings.append({'path':label,'kind':name,'offset':max(0,offset-len(carry)+match.start())})
        offset+=len(block);carry=data[-512:]
    return findings


def scan_file(path,label,compressed=False):
    opener=gzip.open if compressed else open
    with opener(path,'rb')as f:return scan_stream(f,label)


def safe_relative(name):
    p=PurePosixPath(name)
    if p.is_absolute()or'..'in p.parts:raise ValueError('Unsafe relative repository path')
    if p.parts[:len(RESEARCH_PREFIX.parts)]!=RESEARCH_PREFIX.parts:
        raise ValueError(f'Outside allowed research prefix: {name}')
    if p.parts[len(RESEARCH_PREFIX.parts)]not in ('voice-v7','voice-v8'):
        raise ValueError(f'Outside V7/V8 prefix: {name}')
    return p


def status(path):
    try:
        value=json.loads(path.read_text())
        return str(value.get('status','')).upper()if isinstance(value,dict)else''
    except (ValueError,UnicodeDecodeError):return''


def inactive_paths(voice_root):
    prefixes=[]
    for version in ('voice-v7','voice-v8'):
        runs=voice_root/version/'training/runs'
        if runs.exists():
            for folder in runs.iterdir():
                if folder.is_dir()and any(status(p)in RUNNING for p in folder.glob('*.json')):
                    prefixes.append(folder.resolve())
    return prefixes


def stable_copy(source,destination,compress):
    before=source.stat();before_hash=sha(source)
    destination.parent.mkdir(parents=True,exist_ok=True)
    if compress:
        with source.open('rb')as src,destination.open('wb')as raw:
            with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0,compresslevel=9)as dst:
                shutil.copyfileobj(src,dst,length=1024*1024)
    else:shutil.copyfile(source,destination)
    after=source.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns)or sha(source)!=before_hash:
        raise RuntimeError(f'Source changed during snapshot: {source}')
    if destination.stat().st_size>MAX_BLOB:
        raise ValueError(f'Staged blob exceeds90MB: {destination}')
    if compress:
        h=hashlib.sha256();size=0
        with gzip.open(destination,'rb')as f:
            for block in iter(lambda:f.read(1024*1024),b''):h.update(block);size+=len(block)
        if h.hexdigest()!=before_hash or size!=before.st_size:raise AssertionError('Gzip restoration mismatch')
    elif sha(destination)!=before_hash:raise AssertionError('Copy mismatch')
    return before_hash,before.st_size


RESTORE_SCRIPT=r'''#!/usr/bin/env python3
"""Restore compressed research artifacts without overwriting different files."""
import argparse,gzip,hashlib,json,os
from pathlib import Path,PurePosixPath

def sha(path):
    h=hashlib.sha256()
    with path.open('rb')as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def inside(root,name):
    p=PurePosixPath(name)
    if p.is_absolute()or'..'in p.parts:raise ValueError('Unsafe restoration path')
    target=(root/str(p)).resolve()
    if not target.is_relative_to(root):raise ValueError('Restoration path escaped root')
    return target

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True,help='Repository root containing research/')
    p.add_argument('--map',type=Path,default=Path(__file__).with_name('restoration-map.json'))
    a=p.parse_args();root=a.root.resolve();manifest=json.loads(a.map.read_text());done=0
    for item in manifest['artifacts']:
        source,target=inside(root,item['stored_path']),inside(root,item['restored_path'])
        if sha(source)!=item['stored_sha256']:raise ValueError('Compressed hash mismatch: '+str(source))
        if target.exists():
            if target.stat().st_size!=item['restored_bytes']or sha(target)!=item['restored_sha256']:
                raise FileExistsError('Different destination already exists: '+str(target))
            done+=1;continue
        target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_name(target.name+'.restoring')
        if temp.exists():raise FileExistsError(temp)
        h=hashlib.sha256();size=0
        try:
            with gzip.open(source,'rb')as src,temp.open('xb')as dst:
                for block in iter(lambda:src.read(1024*1024),b''):
                    h.update(block);size+=len(block);dst.write(block)
            if h.hexdigest()!=item['restored_sha256']or size!=item['restored_bytes']:
                raise ValueError('Restoration mismatch: '+str(target))
            os.replace(temp,target);done+=1
        finally:
            if temp.exists():temp.unlink()
    print(json.dumps({'status':'PASS','restored_or_verified':done}))
if __name__=='__main__':main()
'''


def main():
    p=argparse.ArgumentParser(description=__doc__)
    workspace=Path(__file__).resolve().parents[2]
    default_voice=workspace/'recovered-model/research/v4-hook-1m/experiments/gh0st-voice'
    for ancestor in Path(__file__).resolve().parents:
        if (ancestor/'voice-v7').is_dir()and(ancestor/'voice-v8').is_dir():
            default_voice=ancestor;break
    p.add_argument('--voice-root',type=Path,default=default_voice)
    p.add_argument('--stage',type=Path,default=Path(__file__).resolve().parent/'stage')
    p.add_argument('--checkpoint',type=Path)
    p.add_argument('--export',type=Path,dest='export_dir')
    a=p.parse_args();voice_root=a.voice_root.resolve();stage=a.stage.resolve()
    if stage.exists():p.error('Stage already exists; use a new --stage path')
    if stage.is_relative_to(voice_root):p.error('Stage must be outside the source tree')
    if bool(a.checkpoint)!=bool(a.export_dir):p.error('--checkpoint and --export must be supplied together')
    running=inactive_paths(voice_root);entries={};excluded=[]

    def add(source,repo,selected=False):
        if source.is_symlink():raise ValueError('Symlink source is not accepted')
        source=source.resolve();repo=str(safe_relative(str(repo)))
        if not source.is_relative_to(voice_root):raise ValueError('Source escaped allowed research tree')
        compress=source.suffix=='.jsonl'or(selected and(source.name=='fused.bin'or source.stat().st_size>MAX_BLOB))
        stored=repo+'.gz'if compress else repo
        if stored in entries:
            if entries[stored]['source']==source and entries[stored]['compress']==compress:return
            raise ValueError('Duplicate staged path: '+stored)
        entries[stored]={'source':source,'original_repo':repo,'compress':compress}

    for version in ('voice-v7','voice-v8'):
        root=voice_root/version
        for source in sorted(root.rglob('*')):
            if not source.is_file():continue
            rel=source.relative_to(root);parts=rel.parts;reason=None
            if source.is_symlink():reason='symlink'
            elif any(part in BAD_PARTS or part.startswith('fixture')for part in parts):reason='cache/raw/fixture/old revision'
            elif any(source.resolve().is_relative_to(folder)for folder in running):reason='active training run'
            elif source.suffix in ('.pyc','.pyo','.safetensors','.pt','.pth','.ckpt','.npz'):reason='cache or unselected weights/reference arrays'
            elif parts[0]=='evm'and source.suffix=='.bin':reason='reproducible microbenchmark/random data; generators and reports retained'
            elif parts[0]=='exports'and source.suffix=='.bin':reason='unselected model export binary'
            elif source.suffix=='.json'and status(source)in RUNNING:reason='unfinished report'
            elif source.name.startswith('.')or source.suffix in ('.lock','.tmp','.log'):reason='transient file'
            if reason:
                excluded.append({'path':str(RESEARCH_PREFIX/version/rel.as_posix()),'reason':reason});continue
            add(source,RESEARCH_PREFIX/version/rel.as_posix())

    selection=None
    if a.checkpoint:
        checkpoint,export=a.checkpoint.resolve(),a.export_dir.resolve()
        if not checkpoint.is_relative_to(voice_root/'voice-v8'):raise ValueError('Selected checkpoint must be inside voice-v8')
        if not export.is_relative_to(voice_root/'voice-v8'):raise ValueError('Selected export must be inside voice-v8')
        if any(checkpoint.is_relative_to(folder)for folder in running):raise ValueError('Selected run is still active')
        weights=checkpoint/'model.safetensors';manifest=json.loads((export/'manifest.json').read_text())
        weight_sha=sha(weights)
        metadata_file=checkpoint/'metadata.json'
        if not metadata_file.is_file():raise ValueError('Selected trained checkpoint needs metadata.json')
        metadata=json.loads(metadata_file.read_text())
        if metadata.get('words',0)<=0 or metadata.get('steps',0)<=0:
            raise ValueError('Selected checkpoint is an initialization, not a trained result')
        if metadata.get('weights_sha256',weight_sha)!=weight_sha:
            raise ValueError('Checkpoint metadata weight hash mismatch')
        if any(status(f)in RUNNING for f in export.glob('*.json')):
            raise ValueError('Selected export contains an unfinished report')
        if manifest.get('checkpoint_sha256')!=weight_sha:raise ValueError('Selected export does not match selected checkpoint')
        for name,meta in manifest.get('artifacts',{}).items():
            artifact=export/name
            if sha(artifact)!=meta['sha256']or artifact.stat().st_size!=meta['bytes']:
                raise ValueError('Selected export artifact mismatch: '+name)
        for name,key in [('reference.npz','reference_sha256'),('GRU2SIMDModel.sol','source_sha256'),('GRU2SIMDHook.sol','hook_source_sha256')]:
            if key in manifest and sha(export/name)!=manifest[key]:raise ValueError('Selected reference/source mismatch: '+name)
        for source in sorted(checkpoint.iterdir()):
            if source.is_file()and(source.name=='model.safetensors'or(source.suffix=='.json'and not source.name.startswith('optimizer'))):
                add(source,RESEARCH_PREFIX/'voice-v8/training/selected'/source.name,selected=True)
        for source in sorted(export.rglob('*')):
            if source.is_file()and not any(part in BAD_PARTS for part in source.relative_to(export).parts):
                if source.suffix in ('.pyc','.pt','.pth')or source.name.startswith('optimizer'):continue
                add(source,RESEARCH_PREFIX/'voice-v8/exports/selected'/source.relative_to(export).as_posix(),selected=True)
        selection={'checkpoint':str(checkpoint),'checkpoint_sha256':weight_sha,'export':str(export),
                   'export_manifest_sha256':sha(export/'manifest.json'),'language_approval':'No approval inferred from selection'}

    stage.mkdir(parents=True);files_root=stage/'files';files_root.mkdir();manifest_entries=[];restorations=[];findings=[]
    for stored,item in sorted(entries.items()):
        source=item['source'];findings+=scan_file(source,str(item['original_repo']))
        target=files_root/stored
        source_hash,source_bytes=stable_copy(source,target,item['compress'])
        findings+=scan_file(target,stored)
        if item['compress']:findings+=scan_file(target,stored+' (decompressed)',True)
        info={'repository_path':stored,'local_path':str(target),'source_path':str(source),
              'sha256':sha(target),'bytes':target.stat().st_size,'git_blob_sha1':git_blob(target),
              'encoding':'gzip'if item['compress']else'raw','source_sha256':source_hash,'source_bytes':source_bytes}
        if item['compress']:
            info['restored_repository_path']=item['original_repo']
            restorations.append({'stored_path':stored,'stored_sha256':info['sha256'],
                                 'restored_path':item['original_repo'],'restored_sha256':source_hash,'restored_bytes':source_bytes})
        manifest_entries.append(info)

    publication=RESEARCH_PREFIX/'voice-v8/publication'
    generated={
        str(publication/'restore.py'):RESTORE_SCRIPT,
        str(publication/'restoration-map.json'):json.dumps({'schema_version':1,'encoding':'gzip; mtime0; empty filename','artifacts':restorations},indent=2)+'\n',
        str(publication/'README.md'):'''# V7/V8 local research publication snapshot

This snapshot contains source, curriculum, encoded training data, and completed
reports for the V7/V8 experiments. V7 failures are retained as evidence; none of
the data counts, conversions, training losses, or gas reports alone establishes
usable language quality. The offline compositional curriculum is synthetic
training material. The runtime remains neural word and punctuation generation.

Active training-run folders, unfinished reports, cached files, random fixtures,
optimizers, old number-parser revisions, and all unselected checkpoint weights
are excluded. No files are deleted from the repository by this snapshot.
Selected float/runtime weights are included only when explicitly passed as a
matching checkpoint/export pair. Selection does not imply language approval.

JSONL files and selected large fused binaries are stored as deterministic gzip.
From the repository root, restore them with:

```sh
python3 research/v4-hook-1m/experiments/gh0st-voice/voice-v8/publication/restore.py --root .
```

The restore tool verifies compressed and original hashes and never overwrites
a different existing file. Use the existing research Python environment for
PyTorch/safetensors and the repository's pinned Node/Hardhat/Uniswap dependencies
for local EVM harnesses. Shared harnesses in `tests/evm/` and
`experiments/gh0st-voice/recurrent-v1/evm/` remain repository prerequisites.
V7 data preparation also references previously published V6 source/license
records. This stage does not republish raw upstream books or models.

All work represented here is local research. There are no mainnet actions or
GitHub mutations in the staging script. Exact source selection, exclusions,
hashes, and compression information are recorded in the external stage manifest.
''',
        str(publication/'build_stage.py'):Path(__file__).read_text(),
    }
    for repo,content in generated.items():
        target=files_root/repo;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)
        if target.stat().st_size>MAX_BLOB:raise ValueError('Generated artifact too large')
        findings+=scan_file(target,repo)
        manifest_entries.append({'repository_path':repo,'local_path':str(target),'source_path':'generated',
            'sha256':sha(target),'bytes':target.stat().st_size,'git_blob_sha1':git_blob(target),'encoding':'raw'})
    result={'schema_version':1,'status':'PASS'if not findings else'SECRET_SCAN_FAILED',
        'created_at_utc':datetime.now(timezone.utc).isoformat(),'source_root':str(voice_root),
        'stage':str(stage),'repository_prefix':str(RESEARCH_PREFIX),'network_actions':0,
        'selection':selection,'file_count':len(manifest_entries),'staged_bytes':sum(e['bytes']for e in manifest_entries),
        'max_blob_bytes':max(e['bytes']for e in manifest_entries),'blob_limit_bytes':MAX_BLOB,
        'gzip_restorations_verified':len(restorations),'secret_scan':{'status':'PASS'if not findings else'FAIL','patterns':list(PATTERNS),'findings':findings},
        'active_run_folders_excluded':[str(p)for p in running],'excluded_files':excluded,'deletions':[],
        'files':sorted(manifest_entries,key=lambda e:e['repository_path'])}
    (stage/'manifest.json').write_text(json.dumps(result,indent=2)+'\n')
    (stage/'files.tsv').write_text('repository_path\tbytes\tgit_blob_sha1\tsha256\tencoding\n'+
        ''.join(f"{e['repository_path']}\t{e['bytes']}\t{e['git_blob_sha1']}\t{e['sha256']}\t{e['encoding']}\n"for e in result['files']))
    print(json.dumps({k:result[k]for k in ('status','file_count','staged_bytes','max_blob_bytes','gzip_restorations_verified','active_run_folders_excluded','selection')},indent=2))
    print('manifest_sha256='+sha(stage/'manifest.json'))
    if findings:raise SystemExit('Secret scan failed; see redacted finding locations in local manifest. Do not publish.')


if __name__=='__main__':main()
