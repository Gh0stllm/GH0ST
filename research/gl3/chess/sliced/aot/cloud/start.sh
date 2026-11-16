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
cargo +1.93.0 build --release --locked -p prover --bin prover -j 4
cd ..
python3 run_cases.py
