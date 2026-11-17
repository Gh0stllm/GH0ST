#!/usr/bin/env python3
"""Render a standalone explorer proxy package; no deploy/DNS/port operations."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit


def render(binding, output):
    if binding.get('scanHost') != 'scan.gh0st.fyi':
        raise ValueError('wrong explorer hostname')
    raw = binding.get('scanUpstreamHttpsUrl')
    if not isinstance(raw, str):
        raise ValueError('actual explorer upstream is not ready')
    if any(ord(ch) <= 32 or ch in '\\"<>' for ch in raw):
        raise ValueError('invalid explorer origin characters')
    u = urlsplit(raw)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
        raise ValueError('an actual HTTPS explorer origin without credentials is required')
    if not binding.get('evidence', {}).get('explorerHealth'):
        raise ValueError('actual explorer health evidence is required')
    if not binding.get('evidence', {}).get('upstreamPortReadback'):
        raise ValueError('actual upstream port readback is required')
    origin = raw.rstrip('/')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'public').mkdir()
    (output / 'public' / '_redirects').write_text(f'/* {origin}/:splat 200!\n')
    (output / 'netlify.toml').write_text('[build]\n  publish = "public"\n')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('bindings', type=Path)
    p.add_argument('output', type=Path)
    a = p.parse_args()
    render(json.loads(a.bindings.read_text()), a.output)
