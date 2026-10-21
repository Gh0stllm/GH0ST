"""Download and verify the pinned public model's inference configuration.

Place the original model.safetensors in --checkpoint first. No remote Python is
downloaded or executed. Observe the upstream Falcon-LLM license.
"""
import argparse, hashlib, urllib.request
from pathlib import Path

FILES = {
    'config.json': 'ad03d15093bb70a67db7d0179dea83172d6ec7fd29618e1d65edecd8eeea1563',
    'tokenizer.json': '7f4447f316d59461f0e642b4d01c2413bdfad5def8fe20178a937f35b2eb804a',
    'tokenizer_config.json': 'c06815decc110e609e2672785640dce8e73d84f364681afb1abde0284fe042b9',
    'special_tokens_map.json': '92dde6b9d3baedb2d62bbf84a0f2b2d80bca842349c5bda4e4b36d74e7313da3',
    'generation_config.json': '63cd0919110f23b9526ce3c724b325293dd7e8247e08f36b00dd65cb0b78788e',
    'chat_template.jinja': '48bcdc7b00244baa76ae8fbc6fb0f2e39253809fbeaa482579200f7588de53a0',
}
BASE = 'https://huggingface.co/tiiuae/Falcon-H1-Tiny-90M-Instruct/resolve/e6389502a0b12cd8da894b395ba5bf7436873b16/'


def main():
    p=argparse.ArgumentParser();p.add_argument('--checkpoint',type=Path,required=True);a=p.parse_args()
    assert hashlib.sha256((a.checkpoint/'model.safetensors').read_bytes()).hexdigest()=='199e9960cd9be797579bd7dfc2b19f72e098e9c4cd3720afd50c815b48080578'
    for name,digest in FILES.items():
        target=a.checkpoint/name
        if not target.exists():
            with urllib.request.urlopen(BASE+name,timeout=60) as response:data=response.read()
            assert hashlib.sha256(data).hexdigest()==digest,name
            target.write_bytes(data)
        assert hashlib.sha256(target.read_bytes()).hexdigest()==digest,name
    print('Pinned checkpoint and six configuration/tokenizer files verified.')


if __name__=='__main__':main()
