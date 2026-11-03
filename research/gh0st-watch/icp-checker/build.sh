#!/bin/sh
set -eu
cd "$(dirname "$0")"
(cd frontend && npm ci --no-audit --no-fund && npm run build)
cargo build --locked --release --target wasm32-unknown-unknown
