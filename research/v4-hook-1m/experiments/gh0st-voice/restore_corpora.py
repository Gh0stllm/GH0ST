"""Verify or restore canonical JSONL corpus files from hash-bound gzip copies."""
from pathlib import Path
import argparse
import gzip
import hashlib
import io
import json
import tarfile


def sha(data):return hashlib.sha256(data).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--overwrite',action='store_true')
    parser.add_argument('--output-root',type=Path)
    args=parser.parse_args()
    source=Path(__file__).resolve().parent
    root=(args.output_root or source).resolve()
    manifest=json.loads((source/'compressed-corpora.json').read_text())
    count=0
    for row in manifest['files']:
        compressed=(source/row['compressed_path']).resolve()
        target=(root/row['original_path']).resolve()
        assert compressed.is_relative_to(source) and target.is_relative_to(root),'Unsafe manifest path'
        payload=compressed.read_bytes()
        assert len(payload)==row['compressed_bytes'] and sha(payload)==row['compressed_sha256'],row['compressed_path']
        data=gzip.decompress(payload)
        assert len(data)==row['bytes'] and sha(data)==row['sha256'],row['original_path']
        if not args.check:
            if target.exists() and target.read_bytes()!=data and not args.overwrite:
                raise RuntimeError('Different existing file; use --overwrite explicitly: '+row['original_path'])
            target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists() or target.read_bytes()!=data:target.write_bytes(data)
        count+=1
    reports=0
    if manifest.get('report_archive'):
        archive=manifest['report_archive'];payload=(source/archive['path']).read_bytes()
        assert len(payload)==archive['bytes']and sha(payload)==archive['sha256']
        expected={row['original_path']:row for row in archive['members']}
        with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz')as tar:
            assert {member.name for member in tar.getmembers()}==set(expected),'Unexpected archive members'
            for member in tar.getmembers():
                assert member.isfile(),'Only ordinary report files may be restored'
                row=expected[member.name];target=(root/member.name).resolve()
                assert target.is_relative_to(root),'Unsafe report path'
                data=tar.extractfile(member).read()
                assert len(data)==row['bytes']and sha(data)==row['sha256'],member.name
                if not args.check:
                    if target.exists()and target.read_bytes()!=data and not args.overwrite:
                        raise RuntimeError('Different existing report; use --overwrite explicitly: '+member.name)
                    target.parent.mkdir(parents=True,exist_ok=True)
                    if not target.exists()or target.read_bytes()!=data:target.write_bytes(data)
                reports+=1
    print(json.dumps({'status':'VERIFIED' if args.check else 'RESTORED','corpora':count,'reports':reports}))


if __name__=='__main__':main()
