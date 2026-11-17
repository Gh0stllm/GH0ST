#!/bin/sh
# Explicit execution wrapper; nothing runs until an operator invokes it.
set -eu
B=/workspace/gl3/durable/reset-runtime-v1
N=/workspace/gl3/durable/node-standalone/node-v24.22.3
export PATH="$N:$B/bin:/usr/bin:/bin" PYTHONDONTWRITEBYTECODE=1
export LD_LIBRARY_PATH="$B/lib" PYTHONHOME="$B" PYTHONNOUSERSITE=1
export SSL_CERT_FILE="$B/certs/ca-certificates.crt" NODE_EXTRA_CA_CERTS="$B/certs/ca-certificates.crt"
NAME=${1:-};shift
case "$NAME" in
 node) EXE="$N/node";;
 python) EXE="$B/bin/python3.12";;
 nitro) EXE=/workspace/gl3/durable/bin/nitro;;
 nitro-val|jit|prover) EXE="/workspace/gl3/same-day-mainnet/node/bin/$NAME";;
 *) echo 'Select node, python, nitro, nitro-val, jit or prover' >&2;exit 2;;
esac
exec "$B/lib/ld-linux-x86-64.so.2" --library-path "$B/lib" "$EXE" "$@"
