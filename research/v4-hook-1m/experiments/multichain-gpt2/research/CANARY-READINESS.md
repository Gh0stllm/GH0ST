# RH ↔ opBNB transport canary readiness

Checked 25 October 2026 at **15:39:03 UTC**. Read-only: no signatures, transactions, deployments, approvals, funding or private-key reads. Scope is a small **model-free request/acknowledgement round trip**, not model installation or a trading pool.

## Decision

Local preparation can proceed. The user subsequently confirmed **`0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`** as the deployer. **Live execution is not ready from the original inspected configuration:** that wallet had no BNB on opBNB at the snapshot below; no signing capability or accepted native-currency budget was established by this read-only inspection. These gaps do not prevent finishing contracts, local tests and reviewable unsigned preparation.

The user has asked to proceed with the canary. The earlier proposal wording in [PILOT-PLAN.md](PILOT-PLAN.md) is historical context, not a reason to stop authorized local work. A concrete live plan still needs a chosen public deployer/requester and explicit spending caps before it can be signed.

## Inspected configuration and signer availability

Inspected only this project's related files:

- `bridge/deployments/prepared-plan.json`
- `bridge/deployments/cli-journal.json`
- `bridge/deployments/cli-transfer-intent.json`
- `bridge/.env.example`
- `recovered-model/research/v4-hook-1m/.env.local`
- `recovered-model/research/v4-hook-1m/experiments/multichain-gpt2/.env.example`
- Existing multichain runtime examples and the canary/pilot documents in this directory.

The prior bridge plan/journal identify public address **`0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`**. Those artifacts concern RH ↔ Arc; the later explicit user confirmation, rather than the earlier bridge artifacts, establishes the canary deployer selection. It does not reveal or establish possession of a signing key.

Only variable names were inspected:

| Location | Relevant names |
| --- | --- |
| Research `.env.local` | `ROBINHOOD_MAINNET_RPC_URL` |
| Multichain `.env.example` | `RH_RPC_URL`, `BNB_RPC_URL`, `OPBNB_RPC_URL`, `MONAD_RPC_URL`, `ARC_RPC_URL`, `GH0ST_WORKER_KEY`, `GH0ST_RELAYER_KEY`, `GH0ST_MODEL_CACHE` |
| Bridge `.env.example` | `ROBINHOOD_MAINNET_RPC_URL`, `ARC_MAINNET_RPC_URL`, `GH0ST_BRIDGE_OWNER` |
| Current tool process | No names matching RPC, key, wallet, owner, deploy or relayer were present. |

No secret values are included here. Environment examples are not evidence of populated keys. No broader filesystem, wallet store, browser account or unrelated directory was searched. Wallet-side signing may be available independently; this read-only inspection did not establish it.

## Public wallet snapshot

Read each RPC's `eth_chainId` before querying balances or nonces. Both addresses below have no deployed code at the sampled block.

| Network | Native balance | Confirmed nonce | Pending nonce | Block |
| --- | ---: | ---: | ---: | ---: |
| Robinhood, 4663 | 0.276032464018150365 ETH | 6231 | 6231 | 97,696,028 |
| opBNB, 204 | 0 BNB | 0 | 0 | 199,303,237 |

- RH block hash: `0xfa749604f33114609a36cb540c928b7336202bf0f37da4c6175b5cd7d3fedbdf`.
- opBNB block hash: `0x26feefab874d388d54739f25a6e048503b789d67f263649851943d7591e9392c`.

The RH balance could cover a small pilot at the proposed cap. **Zero opBNB BNB cannot cover even the first deployment.** Funding is a separate paid action; none was attempted or assumed. Nonces and balances must be refreshed immediately before final preparation and signing because any intervening transaction changes deterministic CREATE addresses.

## Infrastructure present

All listed endpoint, send-library, receive-library and DVN addresses returned nonempty bytecode in the fresh snapshots. This establishes presence, not liveness of a particular two-DVN path or reviewed application configuration.

| Component | RH / EID 30416 | opBNB / EID 30202 |
| --- | --- | --- |
| EndpointV2 | `0x6f475642a6e85809b1c36fa62763669b1b48dd5b` | `0x1a44076050125825900e736c501f859c50fe728c` |
| Send ULN302 | `0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7` | `0x44289609cc6781fa2c665796b6c5aabf9ffcedc5` |
| Receive ULN302 | `0xe1844c5d63a9543023008d332bd3d2e6f1fe1043` | `0x9c9e25f9fc4e8134313c2a9f5c719f5c9f4fbd95` |
| Horizen DVN | `0x1258a278519c7f4bd997a9c3bfd4aa802a028d89` | `0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b` |
| LayerZero Labs DVN | `0xd01ae6905d48315f7be10c7330aecf8360ef5b12` | `0x3ebb618b5c9d09de770979d552b27d6357aff73b` |

Observed endpoint code hashes: RH `0xcfbbc5787620fd3bc7117ecad89067b17fa445b3e6b7afd724e3a347a9d67763`; opBNB `0x05a206902b4e1773eea2c5a2e32c559181321e445da3d99637d8d96a7ef0c228`.

The earlier [managed-executor check](LAYERZERO-SUPPORT-CHECK.json) found both direct directions unsupported by the default managed executors. The canary therefore needs the explicitly selected self-operated executor and real DVN quorum. A source event or quote is not destination delivery. Do not weaken the two-DVN requirement to obtain a successful demonstration.

## Proposed bounded budget — not an accepted spending instruction

Fresh public price snapshot: ETH **$2,343.51**, BNB **$741.63**, provider update time `1792942731`. Source: [CoinGecko simple price](https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin&vs_currencies=usd&include_last_updated_at=true).

A possible ceiling below roughly $5 at this snapshot is:

| Network | Proposed total native spending cap | Snapshot USD equivalent |
| --- | ---: | ---: |
| RH | 0.0015 ETH | $3.515265 |
| opBNB | 0.0015 BNB | $1.112445 |
| Combined | Separate caps, not interchangeable | **$4.627710** |

These caps are a proposal, not a quote or guarantee. They must cover every deployment/configuration, source messaging fee, verification commit, destination delivery and posting fee included in the pilot. Dollar conversion can move. If fresh estimates exceed a cap, stop or reduce scope before signing; do not silently expand the budget. Separate sponsor/relayer accounts would each need their own funded balance and nonce plan, with the same aggregate budget.

Observed fee inputs: RH recommended gas price `20,098,000` wei while the sampled block base fee was `20,106,000` wei; use a fresh fee calculation that covers the actual base fee rather than blindly using the lower recommendation. opBNB recommended price was `1,000,000` wei and base fee zero. The canary should use the current recommended opBNB bid within its cap; testing a low-price inclusion policy is a different experiment.

Exact transaction estimates are pending the completed canary artifacts and concrete addresses. An inference-cost table cannot substitute for a canary deployment/configuration quote. No model weights, ERC20/NFT deployment, pool initialization or liquidity funding belongs in this $5 pilot.

## Remaining operational inputs and independent review

Before live signing, the finished unsigned plan should specify:

1. Chosen deployer/requester and relay signer public addresses, fresh pending nonces, and how signatures will be produced. No private key needs to be printed or copied into a report.
2. Accepted separate ETH and BNB total caps, plus each transaction's fee/gas/value limits and a capped retry policy.
3. Funded opBNB native balance for the chosen signer; no implicit bridge/funding transaction.
4. Exact canary and self-executor creation/runtime hashes, constructor arguments, peer addresses, session/challenge, expiry and packet size.
5. Explicit send/receive libraries and both required DVNs on each direction; actual `verifiable` quorum before commit; stored matching payload before delivery.
6. A receipt ledger covering every attempted and successful paid action. Success requires real request and acknowledgement destination receipts with matching identities, not only successful sends.

Independent review of the canary application, transport, persistent-budget and deployment-broadcaster tooling found **no remaining blocking code issue in the reviewed revision**. The findings below were corrected before the final test run. This is code review and local-test evidence, not confirmation that the wallet is funded, a budget is approved or a public round trip has succeeded.

## Independent application and transport review

Read-only review covered `contracts/RHOpBNBCanary.sol`, `contracts/GH0STSelfRelayExecutor.sol`, `scripts/canary-plan.mjs`, `scripts/prepare-canary.mjs`, `scripts/canary-runtime.mjs`, `scripts/verify-canary.mjs`, `scripts/canary-relay.mjs`, `scripts/deploy-canary.mjs`, `scripts/canary-budget.mjs`, and the shared `verifyCreation` routine in `scripts/verify-deployment.mjs`.

- **Application authentication:** only the immutable requester can send the initial ping. The inherited OApp receiver checks the endpoint and configured peer. The application additionally binds session, challenge, direction, both chain endpoint IDs and both canary addresses. Peers cannot change after sealing. Acknowledgement submission is deliberately permissionless, but its payload is fixed by the accepted ping.
- **Replay and byte validation:** one ping and one acknowledgement are permitted. Receipts reject an accepted GUID, the wrong direction, an altered request commitment, nonzero reserved words, trailing bytes, and a noncanonical 416-byte encoding. The expiry check applies to sending and application receipt.
- **Transport quorum:** current preparation explicitly writes `optionalDVNCount = 255`, the LayerZero NIL sentinel, to disable optional-DVN inheritance. Verification requires that declared value and also requires the effective configuration to resolve to exactly two specified required DVNs and zero optional DVNs. Source and destination libraries, the self-operated executor, the explicit receive library and absence of a receive-library grace override are checked.
- **Relay sequence:** the relay authenticates the source endpoint event, route, canonical GUID, current source request commitment, source receipt and confirmation count. It commits only when the actual receive library reports the exact header/payload verifiable under the checked two-DVN configuration. It delivers only when the endpoint stores that exact payload hash. It neither impersonates a DVN nor submits an attestation.
- **Deployment provenance:** verification checks successful confirmed creation receipts, EOA/nonce-derived addresses, exact compiled creation bytes, canonical constructor arguments and matching current runtime bytes. Constructor replay uses a read-only `eth_call` state overlay; the OApp constructor's `setDelegate` call does not persist. Chain ID, owner, pending owner, requester, peers, session, deadline, executor bindings and delegate are checked against the configuration.
- **Key and fee handling:** read-only mode does not load the signing key. The relay loads it only after full provenance verification; the deployer first regenerates and compares the complete unsigned plan. Both require the signer to match the budgeted admin. Paid mode requires explicit execution, enabled, messaging-reviewed and budget-approved flags. The relay uses a fixed action allowlist, requotes source messaging, bounds transaction gas and gas price, performs an exact preflight, and checks a fresh block deadline. Errors omit RPC URLs and keys.
- **Deployment and resumption:** every unsigned transaction is regenerated from the compiled artifacts and checked, including constructor values, exact targets, nonces and input hashes. Existing deployment receipts are checked against the same planned transaction and current canonical block. The final restart recovery also restores missing manifest entries from settled `deployment:0` through `deployment:7` budget records only after those exact transaction, success, confirmation and CREATE-address checks. Configuration is checked before the seal transaction. A mismatched or uncertain nonce/receipt stops progress rather than broadcasting a replacement automatically.
- **Total spending:** deployment and relay share a durable ledger per session, admin and chain. A copied configuration cannot reset its spending record. Reservations include declared gas times the selected gas-price ceiling, message value, and twice opBNB's size-only posting upper bound. Public posting queries expose the transaction's byte count, not its contents. Confirmed receipts charge execution and available actual posting fees; when posting detail is absent the full conservative posting reservation remains charged. Reverted receipts still charge execution/posting. Unknown broadcasts retain their reservation, and a reservation breach now persists a review-required flag across restarts. This is an operational budget guard; opBNB's fee oracle cannot impose an on-chain maximum on a later L1 posting-price change.

Three review findings were fixed: automatic stale-lock deletion could race between two recovering processes; non-CREATE deployment reservations needed the actual destination address; and a posting reservation breach below the total cap needed a persistent stop flag. Stale locks now require deliberate operator recovery, exact transaction targets are reserved, and either reservation or total-budget overruns remain blocked after restart. Unknown-outcome recovery must preserve the ledger and inspect real nonces/receipts; deleting the ledger is not a safe retry procedure.

Fresh independent offline test run: **35/35 configuration and budget tests passed**, including concurrent reservations, immutable budget identity, reverted costs, unknown broadcasts, exact unsigned regeneration, matching transaction targets/nonces, verified restart recovery and persistent reservation-breach handling. Inspected local evidence also includes `reports/canary-contract/results.json` with **43 passing application checks** using a mock endpoint, and `reports/canary-transport/results.json` with **37 passing checks, including 32 expected reverts**, using official local EndpointV2/ULN302 contracts and explicitly mocked administrator DVN attestations. The current canary and executor source hashes match both local reports. The transport report records zero public transactions and zero public RPC calls. These are local tests, not live DVN availability or delivery evidence.

Public RPC sources used: [Robinhood](https://rpc.mainnet.chain.robinhood.com), [opBNB](https://opbnb-mainnet-rpc.bnbchain.org). Only read-only requests were made.
