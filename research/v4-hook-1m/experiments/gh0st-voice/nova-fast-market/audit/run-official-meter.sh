#!/usr/bin/env bash
set -euo pipefail
NOVA_AUDIT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NOVA_SOURCE_DIR="${NOVA_NITRO_SOURCE:-$NOVA_AUDIT_DIR/nitro-meter-source}"
NOVA_EXPECTED_COMMIT=70fa99a6e711f09eedd96a907290c3df0f3bcf7d
if [[ "$(git -C "$NOVA_SOURCE_DIR" rev-parse HEAD)" != "$NOVA_EXPECTED_COMMIT" ]]; then
  echo "Wrong Nitro source revision" >&2
  exit 1
fi
if git -C "$NOVA_SOURCE_DIR" apply --check "$NOVA_AUDIT_DIR/official-meter.patch" 2>/dev/null; then
  git -C "$NOVA_SOURCE_DIR" apply "$NOVA_AUDIT_DIR/official-meter.patch"
elif ! git -C "$NOVA_SOURCE_DIR" apply --reverse --check "$NOVA_AUDIT_DIR/official-meter.patch" 2>/dev/null; then
  echo "Nitro source differs from the documented test patch" >&2
  exit 1
fi
cp "$NOVA_AUDIT_DIR/official-meter-test.rs" "$NOVA_SOURCE_DIR/crates/stylus/src/test/nova_meter.rs"
export NOVA_STYLUS_ROOT="$NOVA_AUDIT_DIR/../stylus"
export NOVA_METER_REPORT="$NOVA_AUDIT_DIR/official-stylus-meter.json"
export NOVA_SEED_WASM="$NOVA_AUDIT_DIR/../kernels/wasm-unroll/32-seeds/target/wasm32-unknown-unknown/release/nova_wasm_unroll32_seeds.wasm"
export NOVA_SEED_REPORT="$NOVA_AUDIT_DIR/official-stylus-best-seeds.json"
# Cargo/Rust and their cache locations are supplied by the caller.
cd "$NOVA_SOURCE_DIR"
cargo test --offline --locked -p stylus --lib nova_meter_ --no-default-features --features cc_brotli -- --nocapture
