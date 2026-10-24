#!/bin/bash
# Offline numerical reproduction only. No blockchain RPC, deployment or signing.
set -euo pipefail
STYLUS_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RESEARCH_ROOT="$(CDPATH= cd -- "$STYLUS_ROOT/../../../.." && pwd)"
export CARGO_HOME="$STYLUS_ROOT/toolchain/cargo"
export RUSTUP_HOME="$STYLUS_ROOT/toolchain/rustup"
TASK_CARGO="$CARGO_HOME/bin/cargo"
TASK_NODE="${NODE_BINARY:-/Users/abhijith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
TASK_PYTHON="${PYTHON_BINARY:-$RESEARCH_ROOT/experiments/gpt2/.venv/bin/python}"
for TASK_BINARY in "$TASK_CARGO" "$TASK_NODE" "$TASK_PYTHON"; do
  if [[ ! -x "$TASK_BINARY" ]]; then
    echo "Required local tool missing: $TASK_BINARY" >&2
    exit 1
  fi
done
if [[ ! -f "$STYLUS_ROOT/../layout/sentence-reference.json" ]]; then
  echo "Generate the independent reference first: ../layout/sentence-reference.py" >&2
  exit 1
fi
"$TASK_PYTHON" "$STYLUS_ROOT/export-raw.py"
"$TASK_PYTHON" "$STYLUS_ROOT/export-packed3.py"
"$TASK_PYTHON" "$STYLUS_ROOT/make-probes.py"
for TASK_CRATE in wasm-kernel wasm-packed3; do
  "$TASK_CARGO" build --manifest-path "$STYLUS_ROOT/$TASK_CRATE/Cargo.toml" --release --target wasm32-unknown-unknown --offline
  "$TASK_CARGO" build --manifest-path "$STYLUS_ROOT/$TASK_CRATE/Cargo.toml" --target-dir "$STYLUS_ROOT/$TASK_CRATE/target-meter" --release --target wasm32-unknown-unknown --features meter-entrypoint --offline
done
for TASK_TEST in benchmark-wasm.mjs test-probes.mjs test-meter-entry.mjs benchmark-packed3.mjs test-packed3-probes.mjs test-packed3-meter-entry.mjs; do
  "$TASK_NODE" "$STYLUS_ROOT/$TASK_TEST"
done
"$TASK_CARGO" build --manifest-path "$STYLUS_ROOT/wasm-packed3/Cargo.toml" --target-dir "$STYLUS_ROOT/wasm-packed3/target-meter-seeds" --release --target wasm32-unknown-unknown --features meter-seed-entrypoint --offline
"$TASK_NODE" "$STYLUS_ROOT/test-packed3-seed-entry.mjs"
"$TASK_PYTHON" "$STYLUS_ROOT/finalize.py"
