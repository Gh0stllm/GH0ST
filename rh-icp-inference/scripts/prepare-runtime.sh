#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime_dir=vendor/llama_cpp_canister
runtime_commit=4276f526970b7916cc7105c357ad2f2ed018ed37
if [[ ! -d "$runtime_dir/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/onicai/llama_cpp_canister.git "$runtime_dir"
elif [[ -n "$(git -C "$runtime_dir" status --porcelain)" ]]; then
  # A fresh --no-checkout clone has no populated index/worktree yet. Check for
  # user changes only when reusing a checkout that existed before this run.
  echo 'Runtime directory has local changes; leave them intact and inspect it.' >&2
  exit 1
fi
git -C "$runtime_dir" fetch origin "$runtime_commit"
git -C "$runtime_dir" checkout --detach "$runtime_commit"
test "$(git -C "$runtime_dir" rev-parse HEAD)" = "$runtime_commit"
echo "Pinned runtime ready in $runtime_dir. Build with its documented Docker workflow."
