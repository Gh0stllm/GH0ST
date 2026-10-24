#!/usr/bin/env python3
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
