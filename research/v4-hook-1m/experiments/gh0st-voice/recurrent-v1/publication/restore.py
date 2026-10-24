#!/usr/bin/env python3
import argparse,gzip,hashlib,io,json,tarfile
from pathlib import Path
def main():
 p=argparse.ArgumentParser();p.add_argument('--repo-root',type=Path,default=Path.cwd());a=p.parse_args();root=a.repo_root.resolve()
 manifest=json.loads(Path(__file__).with_name('restore-manifest.json').read_text())
 def target(name):
  path=(root/name).resolve()
  if not path.is_relative_to(root):raise ValueError('Unsafe target')
  return path
 def put(row,data):
  if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Restore digest mismatch')
  path=target(row['restored_path'])
  if path.exists() and path.read_bytes()!=data:raise ValueError('Refusing to overwrite differing file: '+str(path))
  path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
 count=0
 for row in manifest['gzip_files']:put(row,gzip.decompress(target(row['stored_path']).read_bytes()));count+=1
 for pack in manifest['archives']:
  with tarfile.open(fileobj=io.BytesIO(target(pack['stored_path']).read_bytes()),mode='r:gz') as archive:
   expected={row['restored_path']:row for row in pack['members']}
   if set(archive.getnames())!=set(expected):raise ValueError('Unexpected archive members')
   for member in archive.getmembers():
    if not member.isfile():raise ValueError('Non-file archive member')
    put(expected[member.name],archive.extractfile(member).read());count+=1
 for extension in manifest.get('extensions',[]):
  lines=target(extension['additional_path']).read_bytes().splitlines(keepends=True)
  for row in extension['files']:
   name=Path(row['restored_path']).name;split=name.removesuffix('.jsonl')
   data=(target(extension['base_path'])/name).read_bytes()+b''.join(line for line in lines if json.loads(line)['split']==split)
   put(row,data);count+=1
 print('Restored and SHA256-verified '+str(count)+' files.')
if __name__=='__main__':main()
