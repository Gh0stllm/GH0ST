# GL3 · native GH0ST withdrawal acceptance

**The complete adapted-fork flow passed on Runpod.** Two complete executions succeeded; the final frozen fixture also binds assertion configuration to its actual event so concurrent batch posting cannot change its input. Five earlier failed attempts and their corrections are preserved. No build, fork simulation, chain or contract test ran on the Mac.

| Verified on the private cloud fixture | Result |
| --- | --- |
| Real fork GH0ST deposited / native child credited | Exactly 4 / 4 |
| Ordinary native child spend | Exactly 1 GH0ST |
| Native withdrawal burn and gas debit | Exactly 0.5 GH0ST plus its receipt gas fee |
| Fresh final genesis | Hash and state root match calculation; native validation log confirms success |
| Actual parent batch | Genuine accepted batch input identifies the exact final child block |
| Genuine rollup / outbox | Real privileged confirmation updates the actual outbox root |
| Exact parent recipient increase / bridge decrease | 0.5 / 0.5 GH0ST |
| Unconfirmed root / non-rollup root registration / changed amount / replay | All reject with actual contract errors |
| Bot policy or model changes | None |

[Acceptance summary](evidence/summary.json) · [Full final result and proof](evidence/native-gh0st-withdrawal.json) · [Earlier successful execution](evidence/earlier-passing-withdrawal.json) · [Failed attempts](evidence/failed-attempts.json) · [Artifact manifest](evidence/manifest.json)

This fixture joins the parts that the earlier bridge unit kept separate: real GH0ST token behavior, a native Nitro child with no prefunded genesis balance, an actual child withdrawal, a real rollup assertion and the actual parent outbox.

## Verified path

1. Read and pin a Robinhood mainnet block and the reviewed GH0ST runtime hash. The public-RPC gateway accepts only an explicit list of read methods.
2. Start a private Ganache fork with a different chain ID. Give a newly generated test actor fake parent ETH, then transfer GH0ST from an unlocked public holder **inside that fork only**.
3. Deploy SHA-verified Nitro-contracts templates, genuine RollupCreator and native-token bridge/inbox/outbox proxies. A fixed unit-rate fee pricer is a test fixture.
4. Generate the exact child genesis with the pinned native generator. The child has an empty native allocation, ArbOS 61 and debug precompiles disabled.
5. Deposit exactly 4 fork GH0ST through ERC20Inbox and observe exactly 4 child native units backed by the real parent bridge token balance.
6. Spend 1 child native unit in an ordinary transaction. Withdraw 0.5 through the actual ArbSys precompile, checking the exact native debit including fees and the emitted withdrawal leaf.
7. Wait for the child batch to reach the parent. Construct the actual NodeInterface outbox proof and confirm its root matches ArbSys. Reject withdrawal before confirmation and reject direct non-rollup root registration.
8. Use the genuine rollup's privileged fast-confirmer path to create and confirm the actual child withdrawal assertion. The genuine rollup updates the genuine outbox root; no mock contract supplies the root.
9. Execute the proof on ERC20Outbox. Require an exact 0.5 GH0ST recipient increase, exact bridge decrease and spent-leaf flag. Reject changed withdrawal data and a second execution.
10. Stop the owned child and private fork, save hashes and receipts, and preserve every failed result before retrying.

The sender, chain owner/fee recipient and batch-poster signer are separate ephemeral accounts. This avoids treating the owner's fee credit as a user refund and prevents background poster transactions from consuming the confirmation signer's nonce. Confirmed state uses the actual batch endpoint from the accepted parent transaction; the withdrawal need not remain the latest child block when posting reports advance the head.

## Findings preserved in order

1. The inherited ArbSys marker caused an invalid-opcode constructor gas failure on Ganache. The explicit parent adapter and genuine Reader4844 address resolve the simulated parent context; no large gas allowance hides it.
2. Signal-based native termination exposed runner cleanup that only checked `exitCode`. Cleanup now checks `signalCode` too, uses bounded waits and verifies the owned process is stopped.
3. Sharing the player and fee-owner role made a strict fee-debit test invalid. Separate unprivileged-player accounting retains the exact amount-plus-gas requirement.
4. A withdrawal block is not necessarily the latest child head. Accepted batch calldata and `newMessageCount` now bind the precise confirmed block endpoint.
5. Sharing deployment and batch-poster keys caused a nonce collision. Separate ephemeral poster authority removes that contention without nonce-reset retries.
6. Review found a potential race if next-assertion configuration came from a later inbox count. The final successful fixture uses its exact `AssertionCreated` event.

## Evidence boundaries

The parent is an **adapted Ganache EVM fork of Robinhood state**, not Robinhood mainnet and not an actual Nitro parent. Ganache inherits the parent's inert `0xfe` ArbSys marker but has no corresponding native precompile. The fixture explicitly removes that marker only on the private parent, recording its original/replacement code and hashes. It installs no synthetic replacement. The child retains its real native ArbSys implementation. The first failed constructor test is preserved rather than hidden by an enormous private gas limit.

The genuine pinned Reader4844 contract is deployed because the adapted parent uses Ethereum-style constructor semantics. This is a calldata-only test; blob methods are not exercised. This fixture complements the earlier actual three-layer GHMOCK rehearsal and cannot establish actual Robinhood/ArbOS-parent behavior.

The child is the digest-verified standard official native Nitro binary, paired with its official machine root. This baseline exercises the gas-token and withdrawal machinery; it does not certify the custom chess STF's production image/root pairing.

The fast confirmer is explicitly privileged. It skips the ordinary challenge deadline. An assertion generated from actual child block/send-root data and accepted by genuine contracts is stronger evidence than a mock-confirmed bridge unit, but it is not a permissionless finality or BoLD dispute test. The fixture does not independently validate an execution-history commitment; `endHistoryRoot` remains a test value for this privileged withdrawal baseline.

The proof in this case contains one withdrawal leaf. The result does not claim exhaustive coverage of every Merkle-tree shape, token branch, future administrative action or public-chain failure mode. Actual parent semantics, the custom chess machine's production pairing and permissionless disputed finality remain separate gates. [Actual Nitro-parent follow-up](PARENT-PARITY.md) outlines the additional evidence needed without disguising an authenticated state subset as a full chain clone.

Stockfish is neither executed nor modified here. Its network, 24-million-node search policy, retained state and strength settings remain untouched. An incorrect chess-result dispute is a separate acceptance lane.

## Cloud setup

`bootstrap-linux.py` verifies the pinned official image manifest and extracts only its native node and matching machine files. It does not run Docker. Node dependencies are installed on the disposable Linux worker with exact direct version pins. Root supplies the compiled contracts provenance bundle and the standard Linux genesis generator.

An optional `--native-genesis-bootstrap` path avoids waiting for a separate generator build. It deploys a zero-funded auxiliary rollup solely to calculate genesis using the official native node and the exact parent init message. Assertion checking is disabled only for that auxiliary calculation. It then stops the seed node and deploys a fresh final rollup using the calculated hash. The acceptance child must log successful genesis assertion validation with checking **on**, and its raw header hash **and state root** must exactly match the seed. A mismatch fails the fixture. Seed and final serialized config, parent context, token decimals and data fee are recorded. The auxiliary node is never counted as an accepted rollup.

The runner requires these **path-only** settings:

| Setting | Input |
| --- | --- |
| `GL3_NODE_PACKAGE` | Package file whose dependencies include ethers, Ganache and solc |
| `GL3_PRIVATE_OUTPUT` | Private output directory for this attempt |
| `GL3_NITRO_BINARY` | SHA-verified official Linux Nitro executable |
| `GL3_GENESIS_BINARY` | Standard Linux genesis-generator executable; optional with native-genesis bootstrap |
| `GL3_NITRO_SOURCE` | Pristine pinned source tree, including its chain-info data |
| `GL3_MACHINE_ROOT_DIR` | Official machine directory with the matching root |
| `GL3_ARTIFACTS` | Root of the source-compiled contracts artifact tree |
| `GL3_ARTIFACT_MANIFEST` | Exact-source contract compilation evidence |
| `GL3_UPGRADE_ARCHIVE` | Pinned upgrade-executor package archive |
| `GL3_READER_ARTIFACT` | Existing SHA-pinned genuine upstream Reader4844 artifact |

Run `node run.mjs` only on Runpod after those inputs are prepared. The script rejects execution on macOS. No wallet password, existing private key or writable public endpoint is accepted.

`launch-cloud.py` freezes the runner for each fresh attempt. `export-cloud.py` checks the completed result, verifies process cleanup and source hashes, preserves failure records, and rejects any export containing the persisted test signing keys. The exported manifest covers the raw reports, frozen sources and compressed logs; the recorded final runner SHA-256 is `4103d1b85bea9038f9686354fc72c33551c196bc95d05c6e838b778c06c417a1`.

Private node configuration contains only a newly generated test key and is written with mode 0600. Public reports omit that key and the source holder's balance. The report explicitly preserves fork scope, privileged confirmation, proof data, receipts and failure details.
