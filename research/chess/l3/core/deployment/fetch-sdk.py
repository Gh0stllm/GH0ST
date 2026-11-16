"""Fetch only the pinned public SDK source into the ignored project cache."""
from pathlib import Path
import hashlib
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent
COMMIT = '9a34cbb6e0bb6bde760fab45fd51dfd589c877c4'
SHA256 = 'c12d3cfa0f67b521e34c19b1dce6c58fd53d124d9a73d8d24e40b2235cd6caf3'
cache = ROOT / '.cache'
cache.mkdir(exist_ok=True)
archive = cache / f'chain-sdk-{COMMIT}.tar.gz'
if not archive.exists():
    url = f'https://codeload.github.com/OffchainLabs/arbitrum-chain-sdk/tar.gz/{COMMIT}'
    with urllib.request.urlopen(url, timeout=30) as response:
        archive.write_bytes(response.read())
if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    raise SystemExit('Pinned SDK source archive hash mismatch')
with tarfile.open(archive) as source:
    for member in source.getmembers():
        if not (cache / member.name).resolve().is_relative_to(cache.resolve()) or member.issym() or member.islnk():
            raise SystemExit('Unsafe source archive member')
    source.extractall(cache)
print('Pinned SDK source verified; no account, signer or chain operation used.')
