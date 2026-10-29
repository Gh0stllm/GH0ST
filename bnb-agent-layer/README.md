# GH0ST BNB access layer

An additive access layer on BNB Smart Chain, built on the **existing GH0ST Robinhood/ICP system**. The optional [GH0ST bridge](BRIDGE.md) locks original tokens on Robinhood and issues a 1:1 backed BNB representation for payments. It does not replace the existing token, model or coordinator.

**Status:** implementation and local validation. The BNB contracts, service activation and ERC-8004 registration are not deployed. The checked-in page deliberately disables paid actions until deployment and service readiness are verified.

[Original access-layer validation](VALIDATION.md) · [Bridge and GH0ST payment implementation](BRIDGE.md) · [Bridge validation](BRIDGE-VALIDATION.md).

## Components

| Component             | Behavior                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GH0STPassport.sol`   | Free ERC-721/ERC-5192 soulbound passport. Minting checks ownership of a specific upstream Agent ID; each ID and wallet can mint once. Losing the upstream ID disables new requests. On-chain SVG and metadata.                                                   |
| `GH0STAccess.sol`     | Signed, expiring BNB or GH0ST fee quotes; exact-prompt commitments; prepaid escrow; permissionless delivery of the existing ICP signature; full expiry refunds; public request history and completion counts.                                                             |
| Participation rewards | Optional native-BNB pool, separately funded, capped globally and per passport. Only completed requests qualify. No escrow diversion or promised return.                                                                                                          |
| Relay                 | Confirms BNB events, submits a domain-bound prompt to the existing RH gateway, uses the existing coordinator, settles the result on RH, then transports its original signature to BNB. Durable signed transaction and ICP-update journals prevent blind retries. |
| `/agents/`            | Wallet connection, identity mint, signed price preview, requests, history, receipt links, refunds, withdrawals and AI-wallet instructions.                                                                                                                       |
| ERC-8004              | Registration metadata and unsigned registration-transaction preparation. This is GH0ST's service identity, separate from users' Binance Agent IDs.                                                                                                               |

The bridge adds `GH0STRobinhoodEscrow` (original-token custody), `GH0STBridgedToken` (backed BNB balances) and `/bridge/` (transfer and receipt interface). See [BRIDGE.md](BRIDGE.md) for deployment ordering, peer binding and payment-token configuration.

## Existing GH0ST is the execution layer

1. A user obtains a Passport and signs an exact BNB or GH0ST quote.
2. The Access contract escrows the quoted asset and commits to a transport prompt containing its own address and unique request ID.
3. The relay submits that exact prompt to **the existing RH gateway**. Its wallet must be explicitly authorized there.
4. **The existing ICP coordinator and model** verify and execute that RH request. Their current one-active-job admission remains authoritative.
5. The original ICP signature settles the answer on RH. The relay waits for confirmed RH state before transporting it to BNB.
6. BNB verifies the existing RH EIP-712 domain, pinned signer, model, manifest and unique transport-prompt hash. It releases the agreed fee only on successful delivery.

The BNB contract does not independently verify RH consensus. It trusts the same pinned ICP attestation as GH0ST. Its prompt commitment prevents a result for any other BNB request or Access deployment being substituted. BNB cannot independently prove that an RH callback was posted; waiting for that callback is the relay's documented delivery policy. The chain links let users verify it.

This implementation adds per-passport history, not a promise that previous answers are automatically placed in every model context. The existing RH swap persona and its memory policy are unchanged. Model output remains untrusted text and never chooses wallet calls.

## Local verification

Node 22 or newer:

```sh
cd bnb-agent-layer
npm install --ignore-scripts --no-audit --no-fund
npm run compile
npm test
node worker/server.mjs
```

The local service defaults to read-only at `http://127.0.0.1:8787/agents/`. Example fee parameters are illustrative; they are not a live price quote. The two-chain test uses local BNB/RH EVMs and a mock coordinator with real signature verification. It does not claim a new mainnet inference run.

## Deployment and activation

1. Copy `config.example.json` to a private `config.local.json`. Pin the actual Agent ID registry after checking live code, ERC-721 support, its name and upstream provenance. The observed BNB candidate is `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`; a registry's name alone is not an authenticity proof.
2. Run `node scripts/preflight.mjs config.local.json`. It checks BNB/RH chain IDs and the existing RH signer, model and artifact. Do not redeploy or reconfigure the existing model or coordinator.
3. Prepare and review a Passport deployment: `node scripts/prepare-deployment.mjs passport config.local.json OWNER REGISTRY`. Submit the returned transaction from the operator wallet. No script broadcasts or asks for a seed phrase.
4. Add the confirmed Passport address to the private configuration. Set `quoteSigner` and `treasury` explicitly. Set `rewardPerRequestWei`, `maxRewardsPerPassport`, and `maxRewardBudgetWei` only after choosing a funded campaign budget; all default to zero.
5. Prepare the Access deployment with `node scripts/prepare-deployment.mjs access config.local.json OWNER`. Verify the deployed code, immutables, creation receipt and BNB deployment block. Update the private configuration and public `website/agents/config.json` with confirmed addresses only.
6. Use `authorize-relay` to prepare any required RH `setRequester` transaction. This grants the named relay permission to create paid model requests; review that specific address. Preserve the existing swap worker's limited callback-only signing policy.
7. Run the service using the **existing authorized ICP worker identity**, a separately scoped relay key, a quote-signing key and a durable state path. Keep keys in the host's secret manager/environment and private identity files; never commit them.
8. Quote intake must remain off until an isolated end-to-end funded request has confirmed both RH and BNB receipts and total cost has been measured. Check interference with the production single-job coordinator and adjust quote/admission pricing. Reconcile outstanding journal entries before restarting or replacing a relay.
9. Reverse-proxy `/api/bnb/*` to this service on the existing GH0ST host; publish `/agents/` as part of the existing site. Set `GH0ST_PUBLIC_ORIGIN=https://gh0st.fyi`. The frontend requires the same-origin API and verified quote signer. Do not expose an unauthenticated administrative endpoint.
10. Publish the registration file with accurate availability. Prepare ERC-8004 `register(string)` using `registration`, sign it from the intended owner, and update `registrations` with the confirmed registry and returned agent ID. Optional rewards are activated only by explicitly funding the bounded pool.

Runtime variables:

| Variable              | Purpose                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `GH0ST_BNB_CONFIG`    | Absolute path to verified private deployment/pricing configuration.                       |
| `GH0ST_PUBLIC_ORIGIN` | Exact browser origin permitted to request quotes.                                         |
| `GH0ST_BNB_QUOTE_KEY` | Quote-only signer matching the Access immutable.                                          |
| `GH0ST_RELAY_KEY`     | Funded BNB/RH transport wallet; must be authorized on the RH gateway.                     |
| `ICP_IDENTITY_FILE`   | Existing limited worker identity, owned file mode 0600. Never the canister administrator. |
| `GH0ST_BNB_STATE`     | Absolute persistent journal path, on encrypted/restricted storage.                        |
| `HOST`, `PORT`        | Bind to loopback behind the existing site's proxy by default.                             |

## Recovery, accounting and limits

- Pending requests, withdrawal credits and unallocated rewards have separate accounting. Fees are released to the immutable treasury only after a valid answer. Refunds and withdrawals stay available while request intake is paused.
- Anyone may call `refund` after expiry; the credit always belongs to the original requester. Refunds do not reimburse the separate BNB transaction gas.
- A signed price covers service delivery, not guaranteed response quality. BNB and RH transaction gas, ICP cycles, exchange rates and operator margins must be measured and priced. A failed job can cost the operator compute even though the user receives a refund.
- The existing canister has a single active model stream. The new relay competes for that admission; a queue is not a throughput increase. The production buy worker and this service need coordinated scheduling before public activation.
- Ambiguous ICP updates are held for operator reconciliation after 120 seconds. They are not silently retried. Signed chain transactions are saved before broadcast and only the same raw transaction is rebroadcast. A replaced nonce is a reconciliation condition.
- Upstream identities are transferable and not Sybil-proof. This passport remains bound to its original wallet; transferring the ID does not let another wallet mint it again here.
- New BNB requests do not automatically post to X. Public posting credentials and automatic promotional activity are not part of this layer.
- The code is not independently audited. Publish the actual deployment and measured validation record before enabling paid traffic.

## Sources

- Existing GH0ST gateway and signature format: `../rh-icp-inference/contracts/GH0STInferenceGateway.sol`, `../rh-icp-inference/worker/protocol.mjs`.
- Existing live deployment record: `../rh-icp-inference/deployments/retention-20261028/verification.json`.
- [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004).
- [BNB Agent SDK networks and registry source](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/).
- [Binance Agentic Wallet contract-call tooling](https://www.binance.com/en/skills/detail/binance-web3/binance-agentic-wallet).

All compiler/test/deployment work stays local. No model training or new GitHub Actions workload is added.
