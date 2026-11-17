# GL3 base: withdrawal, crash recovery and light storage

**Fresh chain checks are prepared and pending execution.** This lane uses the official Nitro 3.12.2 native binary and matching standard `c10` machine. It excludes every custom chess precompile, model, search and proof module.

The pristine print-only genesis helper compiled with actual exit0 in6.625s; exact ELF SHA256 is `0c797bd8ecf079669ade4ddcd34d2000ec263c51e21831cea3fec71f0618e678`. The preceding attempt stopped at its6GB disk floor and remains preserved in the [failed-attempt capsule](evidence/genesis-build-attempt1-capsule.tar.gz) and [receipt](evidence/genesis-build-attempt1-receipt.json). Neither tool compilation nor source syntax checks constitute a chain-flow or recovery pass.

The runtime target is the dedicated32-vCPU/64GB worker, with all three private-chain databases under `/workspace/gl3/testnet/withdrawal-recovery/` on the configured1,000GB persistent volume. The controller checks the actual64,000,000,000-byte cgroup-v2 cap and mount identity. Shared filesystem free space is not interpreted as the volume allocation or as proven chain capacity.

The fresh private scenario will run native Geth 1337 → native Nitro 4663 → native Nitro 4663007. It reuses the upstream contracts pinned to `4341b132cfbdcc980ead03765ca5224ff6cb5d97` and the frozen GH0ST runtime. Because the previous disposable holder key was deliberately excluded from evidence, only its verified 32-token balance mapping is explicitly reassigned to a new ephemeral test signer in private genesis. This is a synthetic balance-owner remap of a sparse observed snapshot, **not the canonical token ledger**, a current Robinhood snapshot or a public token transfer.

The checks are:

- Strict parent/child genesis hash and state-root matching, native ArbSys active on the parent, debug precompiles disabled.
- Deposit 4 GH0ST, receive the native gas token, spend 1, then kill the ordinary official child CLI with SIGKILL after its acknowledged receipt. No pre-kill pause, flush or DB copy.
- Restart the same binary/config on the same execution/consensus/Wasm database directories with synchronous Pebble and archive save-every-block. Compare exact head/root, message index, nonce, balances and database directory identities; then perform 100 ordinary transfers to fresh accounts.
- After that recovery gate is recorded, restart gracefully with only the batch-poster enabled, burn 0.5 GH0ST, register an actual confirmed Rollup assertion, construct its outbox proof and verify exact parent recipient/bridge deltas. Reject an unconfirmed root, non-rollup root update, altered amount and repeated withdrawal.
- Report measured logical/allocated open-database growth over those 100 light transactions. This is not a long-run capacity guarantee or pruning result.

The batch poster is disabled during the exact-head crash experiment so no asynchronous batch-report message changes the captured head. The parent remains running. Enabling it later is a separate phase and is excluded from the exact-config recovery claim.

Confirmation in this fixture is **privileged fast confirmation**. Permissionless wrong-result BoLD/finality is a separate [base dispute gate](../dispute-readiness/). Test ETH, roles, balances and contracts exist only on disposable loopback chains; there is no public RPC or wallet access.

Earlier genuine GH0ST compatibility evidence remains frozen in [native-parent parity](../../mainnet/withdrawal/parent-parity/README.md). Its source-backed trace witness and its limits are preserved; this fresh remapped fixture must not be described as a new canonical-state observation.
