# Port-reset preparation

**Private checkpoint complete; public RPC remains disabled.** The preparation lane changed no port or service. Root subsequently applied the reviewed 22/tcp + 18547/http configuration, which recreated the container. The persistent volume and receipt packet survived. Reviewed aliases were explicitly restored; this is dependency recovery, not a completed production-chain failover test.

## Private checkpoint

The entire ephemeral `/root` was streamed to the existing persistent volume without following symlinks. This includes practical research/tool caches. The archive is private, mode `0600` inside a `0700` directory; its location and detailed inventory stay in the operator handoff, not this repository.

- Archive: 13,621,342,284 bytes; SHA256 `18cf17b58da87c3242a8a53760c5eadf23b0b750fb0331c132a81cdb41298c57`.
- 122,219 source paths; source metadata unchanged before/after.
- Zero writable `/root` descriptors detected before/after.
- Actual 142.087 s; tar, compression and compressed checksum test all exited 0.
- 2 CPUs/nice10, 6GB root-free floor and 56GB shared working-memory ceiling.

The source inventory counts hard-linked paths separately. This is a private recovery checkpoint, not a blockchain state proof. No actual operator wallet file on `/workspace` was opened; symlink targets there were not archived. Do not blindly extract the archive over a live `/root` or existing credentials.

## Durable runtime and aliases

`/workspace/gl3/durable/reset-runtime-v1` now holds 153,093,273 bytes of public runtime files: Node 18.19.1, Python 3.12/stdlib, CA certificates and the exact shared-library closure used by official Nitro/nitro-val/JIT/prover. The complete hash manifest stays beside that bundle. Actual bundled-loader checks passed for Node, Python JSON/socket/SSL/hash/tar/zlib imports and official Nitro 3.12.2.

The initial `restore-aliases.sh --check` passed with no missing aliases and matching runtime hashes, without installing anything. After root's port reset, a fresh check found the five expected aliases missing; the explicit `--install-aliases` action then passed and restored them. It refuses conflicting existing paths and starts no service. Production binaries, machines and data continue to use direct persistent paths.

After an approved container reset, the operator can run:

```sh
sh /workspace/gl3/same-day-mainnet/ops/infra-prepare/restore-aliases.sh --check
# Explicit recovery action only if aliases are missing:
sh /workspace/gl3/same-day-mainnet/ops/infra-prepare/restore-aliases.sh --install-aliases
```

The original Node 18 bundle passes `--version` but fails actual JavaScript initialization in the fresh container: Debian's externalized `cjs-module-lexer/lexer.js` was absent. This failure is preserved in `evidence/post-reset-node-smoke-failure.json`; the earlier version checks must not be presented as a hermetic JavaScript-start test.

Root fetched official standalone Node **24.22.3**, verified its archive against Node's published checksums and retained it on the persistent volume. Actual JavaScript, crypto and ethers signing/verification with a generated TEST identity now pass without external Debian JavaScript files. Archive SHA256 is `4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb`; binary SHA256 is `a7ec1b37e6ff9d187e4198c5b6df9a4eb1c74dd31804fb3bac55cc4ceca1ac01`. See `evidence/standalone-node-manifest.json` and `evidence/standalone-node-smoke.json`.

`runtime-exec.sh` invokes the preserved loader/libraries and standalone Node, and prepends that Node's durable directory for child processes. It does not replace global system libraries. The changed container hostname received explicit host-guard review; nine focused supervisor checks pass. Actual node/backend startup remains a separate gate.

## Guarded HTTP 18547 source

`guarded-rpc.mjs` is a native HTTP adapter for the existing method/request policy. The policy is copied verbatim from the network RPC handler, with source hashes in `request-policy-provenance.json`; its HTTPS/Netlify transport and wildcard CORS are not copied into the active adapter.

The default binding file is disabled. Activation requires a hash-bound approved deployment receipt, chain 4663001, nonzero exact genesis/rollup/deployment transaction and literal loopback upstream. Startup checks live chain/genesis before listening, and every forwarded request checks them again. An actual receipt must be supplied by the root deployment workflow; a synthetic unit fixture is not an activation receipt.

The source binds only the reviewed public adapter port 18547; the Nitro upstream stays loopback-only. No admin, debug, personal, unlocked-wallet or unsigned-transaction method is allowed. CORS uses explicit project origins and explicit hosts, with no wildcard. The operator must add the actual verified Runpod proxy hostname to that host list after the port readback. Other browser origins require an explicit reviewed addition.

Limits are 256KiB requests, 20-item batches, 8 concurrent upstream requests, 8MiB responses, 10s upstream timeout and a 1200-RPC-call/minute token bucket with 40-call burst. The HTTP server caps connections at 128. It never logs request payloads or private upstream errors.

Twenty-four pure function/fake-fetch checks passed in 0.149 s, covering binding/method/origin/host/size/batch/concurrency failures and unchanged raw signed transaction forwarding. No network connection, HTTP server or actual transaction was started by those checks. The default disabled CLI check correctly returned refusal, exit 2.

Once the actual receipt bindings and public port are reviewed, the root operator can check and then explicitly start it through the preserved Node runtime. **No `--serve` invocation occurred in this task.** Public TLS/proxy reachability, live RPC smoke checks and supervision remain deployment actions, not completed evidence here.
