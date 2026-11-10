# Synapse mainnet preparation and manual signing

These tools compile the current production contracts with the existing pinned
`lib.mjs` toolchain and settings. They support the selected V2 model directory.
Artifacts and session files must be written outside the Synapse source directory.
Private RPC values are read locally and never serialized in outputs or pages.

## Prepare an unsigned plan

From the Synapse directory:

```sh
node deploy/prepare.mjs \
  --out /absolute/private/output \
  --env-file /absolute/private/.env.local \
  --fee-cap-gwei 0.1 \
  --model-dir candidates/domain \
  --simulate-smoke
```

Preparation makes read-only Robinhood Chain calls and executes transactions only
on an isolated local fork anchored to the observed mainnet block. It does not
read a keystore, sign mainnet transactions, or broadcast to mainnet.

The output contains reproducible compiler input/artifacts, model hashes, the
wallet/fee snapshot, fork evidence and `plan.json`. The nine actions are six
contract creations, an exact six-GH0ST approval, one base-graph inference and a
withdrawal of those same six GH0ST to the sponsor. All module beneficiaries are
the sponsor for this initial same-project demonstration. The approval is consumed
and final escrow, credits and allowance are verified as zero on the fork.

Every deployment includes its exact CREATE address, initcode/calldata hash,
constructor arguments, gas bounds and actual expected runtime after immutable
values are assigned. Weight shard addresses and code hashes are also checked.
Each fixture must match every intermediate activation and logit.

## Review and start a manual browser session

After reviewing the final source/model and unsigned plan:

```sh
node deploy/browser-session.mjs \
  --plan /absolute/private/output/plan.json \
  --keystore /absolute/private/existing-encrypted-keystore.json \
  --output /absolute/private/new-signing-session \
  --env-file /absolute/private/.env.local
```

Startup validates the complete plan against a fresh compile/model and checks the
current wallet nonce, fees, balances and first action. It starts a random local
URL bound to `127.0.0.1` with a four-hour expiry. It does not decrypt the key or
broadcast at startup.

The user enters the password manually in the local browser tab. The browser
verifies the URL-bound plan hash, decrypts the existing encrypted keystore and
signs only the nine exact unsigned transactions. It sends only those signed
transactions and the plan hash to the local server. No password or plaintext
private key is sent to the server. Scripts and encryption libraries are served
locally under a restrictive content security policy.

The complete signed batch is saved privately before execution begins. The
existing `executeActions` engine journals each transaction before broadcasting,
checks each stage again, then waits for twelve canonical descendant blocks.
Module runtime, shard code, space and weights hashes are checked before every
later action. The final verification checks all receipts, deployed contracts,
fixtures, decoded inference/activation events and exact payment withdrawal.
A verified public `deployment.json` is written only after all checks pass.

A pre-existing signed batch or journal prevents a new session. An unresolved
submission stops execution; preserve its signed evidence and reconcile the exact
hashes before starting anything else. This entry point has no automatic restart
or replacement flow.

## Verify saved execution read-only

```sh
node deploy/verify.mjs \
  --plan /absolute/private/output/plan.json \
  --journal /absolute/private/signing-session/signed-journal.json \
  --out /absolute/private/verification \
  --env-file /absolute/private/.env.local
```

The public configuration schema is `gh0st-synapse-deployment-v1`, with chain,
token, backbone, experts, graphs, proof receipts and `confirmations: 12`.
`rpcUrl` in that configuration is the public endpoint only. Signed batches and
journals remain private and must never be copied into a website.
