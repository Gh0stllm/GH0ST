# Prepared coordinator recovery delegation

Status: **implementation and offline tests only**. No production owner key has
been read or exported, no production delegation has been signed, no credentials
have been installed, and no network update has been submitted by these tests.

The helper addresses the two owner-only coordinator updates used when skipping
an already failed thought: `set_paused(bool)` and `defer_failed_swap(id, cycles,
reason)`. The existing failure-deferral worker must still durably record each
intent before invoking the helper, and reconcile ambiguous outcomes instead of
retrying them. This module does not write a journal or implement retries.

## Proposed credential scope

An authorized owner would sign one direct delegation to a new Ed25519 recovery
session key, with its **only target** set to coordinator
`6jacx-5yaaa-aaaaj-a65jq-cai`, expiring within 30 days. The resulting delegated
identity retains the owner's caller principal without putting the owner's
private key on the server. This is a proposed access grant that still needs
explicit approval before production creation or installation.

The IC's [authentication specification](https://docs.internetcomputer.org/references/ic-interface-spec/https-interface/#authentication)
defines target lists as canister restrictions. Its
[request validator](https://github.com/dfinity/ic/blob/master/rs/validator/src/ingress_validation.rs)
checks the actual signed request's `canister_id` in `validate_request_target`.
The HTTP effective canister ID is not substituted for that check. A delegation
targeted only to coordinator cannot directly call the Management Canister
`aaaaa-aa`, the model canister, or the ICP/cycles ledgers. It therefore does not
grant canister installation, ledger transfers, or direct model operations.

**This is not a cryptographic method restriction.** Possession of the session
key and signed delegation authorizes all owner methods exposed by the
coordinator until expiration. The local wrapper exposes just the two recovery
methods, but a compromised server can bypass a JavaScript wrapper. The owner
must approve that coordinator-wide authority, not a claim of two-method-only
authority. The delegation's `permissions` field can restrict query versus
update requests, not individual method names.

No delegation format issued-at field exists. The verifier enforces at most
30 days **remaining** validity, rather than claiming it can prove the original
issuance-to-expiry duration. Production issuance must itself choose a maximum
30-day expiry, and renewal requires the owner again. The helper rejects
unsupported key formats instead of weakening verification.

## Loading and operation

The systemd service would supply these private credentials:

```ini
LoadCredential=coordinator-recovery-session:/protected/operator/path/session.json
LoadCredential=coordinator-recovery-delegation:/protected/operator/path/delegation.json
```

The helper uses only the fixed filenames inside `$CREDENTIALS_DIRECTORY`.
It rejects symlinks, group/other-readable credential files, unsafe directories,
unapproved owners, mismatched session keys, invalid signatures, additional
targets, multi-hop chains, expired delegations, and delegations with more than
30 days remaining. Neither secret is accepted through an environment value.

```js
import {loadDelegatedRecovery} from "../server/delegated-recovery.mjs";
const recovery = await loadDelegatedRecovery();
// Only after the existing failure-deferral routine has persisted its intent:
const reply = await recovery.set_paused(true);
// Verify { Ok: null }, then use the existing exact-job deferral flow.
```

Before pausing, at least 15 minutes of credential validity must remain. Other
updates require at least one minute. Each operation rechecks all job phases,
busy flags, known cost accounting and absence of an in-flight memory update.
Deferral additionally requires the exact failed source, its measured Nat128
cost and the fixed reason `user authorized skip failed generation`.

The factory connects only to the fixed production coordinator through
`https://icp-api.io`, preserves query signature verification, and sets transport
retries to zero. It never fetches a replacement trust root. The existing
failure-deferral caller owns serialization, durable intents, response checking,
unpausing and reconciliation; this wrapper must not be used as an independent
background recovery process.

## Remaining production gates

1. User approves the actual coordinator-wide delegated authority and expiry.
2. A separately reviewed issuance flow signs the target-limited delegation
   locally; the owner key remains local and is not included in any bundle.
3. Install only the recovery session key and signed delegation through private
   credentials. Verify the resulting principal, target and expiry offline.
4. Test an isolated exact failed-job recovery before relying on it unattended.

Offline tests generate only unrelated synthetic identities and make no network
requests or changes to GH0ST's deployed canisters.
