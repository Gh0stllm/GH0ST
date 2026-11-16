#!/bin/bash
set -euo pipefail
cd /root/gl3-test
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential pkg-config libssl-dev cmake clang git curl ca-certificates time
if [ ! -x /root/.cargo/bin/rustup ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o rustup.sh
  sh rustup.sh -y --profile minimal --default-toolchain 1.93.0
fi
export PATH="/root/.cargo/bin:$PATH"
cd source
if [ ! -f brotli/c/enc/encode.c ]; then
  curl --proto '=https' --tlsv1.2 -sSfL https://codeload.github.com/google/brotli/tar.gz/f4153a09f87cbb9c826d8fc12c74642bb2d879ea -o brotli.tar.gz
  python3 - <<'PY'
from pathlib import Path
import hashlib,shutil,tarfile
archive=Path('brotli.tar.gz')
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='6d6cacce05086b7debe75127415ff9c3661849f564fe2f5f3b0383d48aa4ed77'
with tarfile.open(archive) as t:t.extractall('.brotli-unpack',filter='data')
out=Path('brotli')
if out.exists():
 assert not any(out.iterdir()),'refuse to replace existing Brotli source'
 out.rmdir()
shutil.move('.brotli-unpack/brotli-f4153a09f87cbb9c826d8fc12c74642bb2d879ea',out)
PY
fi
cargo +1.93.0 build --release --locked -p prover --bin prover --features cc_brotli -j "${GL3_BUILD_JOBS:-16}"
cd ..
python3 run_cases.py
