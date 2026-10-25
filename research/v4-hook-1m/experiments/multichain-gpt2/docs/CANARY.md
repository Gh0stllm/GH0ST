# RH → opBNB → RH transport canary

This is a small, model-free deployment to test the exact two-chain transport before paying to deploy model weights. RH sends one challenge; opBNB accepts it and sends an acknowledgement; RH accepts the acknowledgement. The route uses the official LayerZero EndpointV2 and ULN libraries, two required DVNs in each direction, and GH0ST's self-operated delivery runner. No model, inference, swap or token transfer occurs.

**Current evidence is local only.** Application tests exercise 43 guards. A separate test runs unmodified official EndpointV2, SendUln302 and ReceiveUln302 on two local chains and passes 37 checks, including 32 expected reverts. Its two DVNs are explicitly mocked; it establishes neither live DVN participation nor public delivery. See `evidence/canary-local.json` and the original reports named there.

The managed LayerZero executors rejected this exact endpoint pair in the inspected snapshot. Self-delivery removes the executor service charge but still pays source transaction fees, both DVNs, destination verification and delivery transactions. If either real DVN does not attest to this route, the runner waits. It cannot manufacture an attestation or bypass the quorum.

## Contracts and deployment

`RHOpBNBCanary` binds the session, both endpoint IDs, both peer addresses and challenge into a request hash. Its canonical payload is exactly 416 bytes. It permits one request and one acknowledgement, rejects replay and altered messages, has a deadline, and freezes peers when the route is sealed. The admin uses two-step ownership transfer. Each chain receives this router and a `GH0STSelfRelayExecutor`.

Preparation produces eight transactions per chain: deploy the router, deploy the executor, select the send library, select the receive library, set send ULN/executor configuration, set receive ULN configuration, set the peer, and seal the route. Optional DVNs are explicitly disabled using `NIL_DVN_COUNT=255`; zero would inherit the endpoint default. The broadcaster verifies both required DVNs and the explicit libraries before sealing.

The local canary deployment used 2,086,486 gas on the RH-identified node and 2,086,498 on the opBNB-identified node; executor deployment used approximately 324,000 gas each. These are generic EVM measurements, not public fee quotes. The 4,000,000 per-transaction ceiling leaves room for estimation and padding. Actual sends use bounded fresh estimates, not that whole ceiling automatically.

## Prepare and inspect

From the package directory, install the pinned dependencies. The OpenZeppelin 4 alias is only for compiling the official LayerZero protocol in the separate local transport test; the application uses OpenZeppelin 5.

```sh
npm install
npm test
npm run test:canary:transport
npm run canary:plan
npm run canary:prepare -- --help
```

Copy `config/canary.runtime.example.json` into an ignored working directory and supply a public admin/requester address, fresh random session and challenge, a short deadline and current pending nonces. Keep RPC URLs and signing credentials in the environment. Preparation emits unsigned transaction bytes and forces `enabled`, `messagingReviewed` and `budgetApproved` to false. No public transaction can be sent by the preparation command.

```sh
npm run canary:prepare -- --config=deployments/input.json --nonces=deployments/nonces.json --out=deployments/new-canary
npm run canary:deploy -- --config=deployments/new-canary/manifest.json
```

The second command is read-only unless `--execute` is supplied. A pending-nonce change invalidates predicted CREATE addresses and therefore the peer configuration: regenerate before sending rather than editing unsigned bytes. The deployer recompiles and checks the exact source commitment and all 16 prepared transaction bodies before broadcasting.

## Enable and run

Paid execution requires the configured admin's signer, native balances on both chains, accepted native-currency limits, and all three explicit flags. The example limits are proposals, not permission to spend. Set positive gas-price and message-fee caps; set `maxPostingFeeWei` to zero on RH and a positive reviewed bound on opBNB. Limits apply independently to each chain. Do not place private keys in JSON, source files or chat.

```sh
npm run canary:deploy -- --config=deployments/new-canary/manifest.json --execute --once
npm run canary:deploy -- --config=deployments/new-canary/manifest.json --execute
npm run canary:verify -- --config=deployments/new-canary/manifest.json
npm run canary:relay -- --config=deployments/new-canary/manifest.json
npm run canary:relay -- --config=deployments/new-canary/manifest.json --execute --watch
```

The first paid command submits at most one deployment transaction. After deployment, the verifier reconstructs deployment runtime code and checks addresses, source commitment, session, roles, peers, deadline, libraries and both DVNs. The relay then performs ping, verification commit, delivery, acknowledgement, return commit and return delivery as the required attestations become available. It checks original source events, confirmations, GUIDs and exact committed payloads before delivery. Completion is reported only when the RH contract confirms the acknowledgement.

## Spend accounting and recovery

Deployment and relay share `deployments/canary-spend/<session>/<chainId>.json`. Moving or copying a configuration does not reset this ledger. Each pending action reserves its full gas limit at its maximum gas price, full message value, and twice the opBNB oracle's L1 fee upper bound. Only the unsigned transaction's byte count is sent to that oracle. A reservation must fit the remaining approved budget and current native balance before broadcast.

Mined receipts charge actual execution gas and the full message value as a conservative amount; refunds can make net wallet cost lower. Reverted transactions still charge execution gas. opBNB's receipt L1 fee is added when available; otherwise the full posting reservation remains charged. These posting limits are operational safeguards, not consensus-enforced limits on a changing chain fee. A receipt exceeding its reservation is recorded and permanently stops further automated spending pending review, even if the total budget has room.

Transaction hashes are recorded immediately after broadcast. Restart reconciles known, confirmed receipts; pending transactions remain reserved. An ambiguous broadcast with no recorded hash fails closed and requires nonce/receipt investigation. There is no automatic retry with another transaction.

Only one process may spend a session's chain budget at a time. An unclean shutdown may leave a lock: stop **all** runners, inspect its PID, ledger and public receipt state, and only then remove the stale `.lock` file. Never delete the ledger, change the session to evade a limit, or release an unknown pending spend. Changing an approved cap also requires explicit review; an existing ledger rejects silent cap changes.

## Public success criteria

Record both deployments, the original ping and acknowledgement, both verification commits, both deliveries, all receipt gas and opBNB posting fees, and the RH contract's final accepted challenge. Report cost and latency from those public receipts. Until those exist, this package is tested local infrastructure with a prepared public canary, not a live cross-chain inference deployment.
