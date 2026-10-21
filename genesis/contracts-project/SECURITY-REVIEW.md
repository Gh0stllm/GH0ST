# GH0ST Genesis — scoped security review

Review date: 21 October 2026.

This is an independent adversarial code review performed within the development
workflow. It is **not an external audit, certification, guarantee of safety, or
claim that every possible attack has been excluded**.

Reviewed contract: contracts/GH0STGenesis.sol

SHA-256 of the reviewed source:
cdc3252f980cb454296aec429216268aef491d9d7392b4da5c03665126e0a48f

Compiler/dependency configuration: Solidity 0.8.30, OpenZeppelin Contracts 5.4.0,
optimizer enabled with 200 runs, Shanghai EVM target. Constructor and mint
behavior was also exercised using the compiled artifact and actual GH0ST
token runtime in a local fork before preparing deployment calldata.

## Result and scope

No high- or medium-severity contract issue was identified in the reviewed
source under the assumptions below. A deployment-helper race identified
during review was fixed and retested; no high- or medium-severity finding
remains open within this scope. Review covered mint authorization and
accounting, lifetime wallet limits, the finite token-ID domain, external calls,
ERC-721 receiver behavior, Merkle binding, packed index decoding, immutable
metadata, deployment configuration, and unsupported asset deposits.

The review did not send a public transaction or deploy an NFT contract to a
public network. The final local suite passed **36/36 tests**: 27 contract
tests and nine deployment-helper wallet simulations.
An additional local fork of Robinhood mainnet at block **94008643** passed
against the actual deployed GH0ST token and weight-index runtimes. The fork's
upstream RPC access was restricted to read-only methods; its recorded public
transaction count is zero. These results support the reviewed invariants but
do not constitute exhaustive verification.

## Confirmed properties

| Area | Reviewed behavior |
| --- | --- |
| Lifetime supply | Only IDs 1–495 can be minted. Existing IDs cannot be minted again, and there is no public NFT-burn function. The finite unique-ID domain bounds successful lifetime mints at 495. |
| Wallet limit | The mintedBy counter limits each address to three successful lifetime mints. Transfers do not change that counter. A failed transaction reverts its counter increment. |
| Recipient | Minting is to msg.sender, the immediate caller, only. There is no separate gift-recipient parameter that could bypass the payer's mint counter or prefill someone else's recipient quota. |
| Native token burn | Each successful mint calls burnFrom(msg.sender, 200_000e18). Both total supply and caller balance must fall by that exact amount. |
| No protocol cut | The NFT contract has no mint-token treasury, fee transfer, owner withdrawal, paid admin mint, or alternative mint route. Network gas remains separate. |
| Atomic failure | Burn, allowance consumption, mint counters and NFT ownership are in one transaction. A failed burn check or rejecting/unsupported receiver reverts those changes together. This does not refund transaction gas. |
| Reentrancy | OpenZeppelin's guard is entered before token or receiver interactions. Counters are updated before the burn call and safe-mint callback. Reentrant mint calls cannot proceed. |
| Shard identity | Each proof commits the token ID, shard address, current runtime code hash, logical byte offset and payload length. The leaf is double hashed and pairs are sorted before hashing. |
| Index | The constructor checks the index code hash, length, format magic, payload size, model size and export SHA-256. Every later shard read checks the pinned index code hash again. |
| Mutable shard replacement | Minting checks shard length and uses its observed runtime hash in the proof. A replacement with different code cannot satisfy the original proof except by breaking the hash commitment. |
| Metadata | Token metadata uses fixed published IPFS CIDs and padded filenames 001.json–495.json. There is no metadata, price, supply or upgrade setter. |
| ERC-721 behavior | The collection uses the standard OpenZeppelin ownership, approval, transfer and safe-receiver implementation. Enumeration and royalty interfaces are not added by this contract. |

The shardInfo view reports the currently observed runtime hash. The immutable
Merkle root establishes the intended manifest binding, and every mint verifies
that binding. The proof check, rather than a view call by itself, rejects a
substituted shard.

## Deployment-critical requirements

The constructor is parameterized to support faithful local tests. It does not
hardcode the production token/index addresses or enforce the chain ID.
Consequently, correct production deployment must be enforced by the deployment
tool and independently checked against the actual created contract.

Deployment must fail closed unless the wallet and RPC are on chain **4663**
and these five constructor arguments match the frozen production configuration:

| Constructor argument | Required production value |
| --- | --- |
| GH0ST token | 0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559 |
| Weight index | 0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0 |
| Token runtime Keccak-256 | 0x7c38fa1b069b5e677034bab6219dd2f519f219f7637910131d9a0f58a05ae164 |
| Index runtime Keccak-256 | 0x837bbe58f9d52bb20e8198019a10b97e706aab9cb9e400ca229b6d1cb390c307 |
| Shard Merkle root | 0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2 |

The deployment tool should also validate the published metadata/collection
CIDs, all 495 proofs, burn amount, wallet limit, compilation settings, and
creation bytecode before preparing wallet calldata. A prepared transaction is
not a deployment receipt. After signing, verify the receipt, deployed bytecode
and immutable getters before publishing a mint address.

No private key, seed phrase, Pinata credential, or other secret belongs in
the deployment configuration, generated public bundle, or repository.

## Deployment-helper finding and resolution

The original wallet helper omitted chainId from eth_sendTransaction after
checking the current network. A local wallet simulation reproduced a switch
after the final chain response that could send the creation transaction on
the newly selected network. Its mutable account variable also permitted
stale-account requests when selection changed during runtime-code reads.
These were deployment-tool issues; they did not change the NFT contract's
mint rules.

The reviewed fix explicitly includes chain **4663** in the submitted
transaction, captures the intended payer before asynchronous calls, checks
the selected account again immediately before requesting a signature,
invalidates pending work on account/chain events, and disables reconnection
during deployment. A chain-bound request relies on the signing wallet to
enforce that chain. The user must still inspect the wallet confirmation.

Nine local VM tests in test/deployment-helper.test.mjs passed. They exercise
normal transaction fields, a silent final-moment chain switch, silent
account changes, account/chain events even when the original state is
restored, substituted token/index runtimes, duplicate deployment requests,
and reconnection while code reads are pending. The tests use a synthetic
wallet and perform no network access, real signing or public transaction.

The preparation script permits only read-only RPC methods against the pinned
official endpoint. It checks the production chain, all five constructor
arguments, token/index runtimes, immutable metadata CIDs, mint economics and
compiler optimizer/EVM settings.
The generated wallet HTML was compared with the reviewed template and plan.
Its calldata was independently rebuilt from the compiled artifact and the
five pinned arguments and matched Keccak-256
0x292ab4b3f1f4d7c397e835c9db31ad8efc4fc3b8ec5774c934da6dfdc299d0b9.
The preparation record checked runtime code at block 94016735; this remains
an unsigned, undeployed plan.

## Assumptions and limitations

- The 3-per-wallet rule is a **lifetime mint limit**, not a holding limit or
  proof of one person. A wallet can receive additional NFTs through transfers,
  and a person can use multiple addresses. An intermediary contract is its
  own counted address; it may subsequently distribute up to its three NFTs.
- The token must be the intended, honestly implemented GH0ST token. Runtime
  hash checks identify code; they do not prove arbitrary ERC-20 accounting
  statements. A malicious token can lie through view functions or burn another
  account while moving the caller's tokens. Positive tests against the actual
  deployed GH0ST runtime therefore matter.
- Token/index code hashes are deployment pins, not a universal assessment of
  proxy implementation storage or arbitrary external dependencies. The
  intended GH0ST token and data-only index must be reviewed as deployed.
- A receiver may transfer its freshly minted NFT during its ERC-721 callback.
  This does not reset the mint counter. Interfaces must query ownerOf after
  confirmation rather than infer current ownership from the later
  GenesisMinted event alone.
- The contract accepts no normal native-ETH payment and has no asset-rescue
  function. Forced native ETH or tokens transferred directly to it are outside
  the mint workflow and may remain inaccessible. The mint uses token approval
  followed by direct burning from the caller, not a deposit to the NFT address.
- Gas and third-party marketplace charges are outside the 0% protocol-cut
  claim. This contract does not establish marketplace fee or royalty policies.
- IPFS CIDs identify immutable content; continued availability still requires
  pinning. NFT ownership does not grant model copyright, exclusive inference
  access, control over the weight shards or automatic revenue rights.
- The no-owner/no-upgrade design means mistakes cannot be corrected through an
  administrator after deployment. Deployment validation and tested public
  artifacts are therefore necessary launch conditions.

## Completed dynamic checks

The combined npm test record at test/all-tests.log and its machine-readable
test/all-tests-summary.json report **36 passed, zero failed and zero skipped**.
The original contract-only TAP record is retained at test/local-battle.tap.
The 27 contract tests cover exact native burn accounting, balance and
allowance failures, malicious burn behaviors, complete rollback on recipient
failure, callback reentrancy, transfer-within-callback behavior, failed-mint
quota rollback, fourth lifetime mint rejection after transfers, proof
substitutions, shard/index code replacement and URI padding. A seeded
96-step adversarial sequence preserved wallet quotas, aggregate burn
accounting and NFT uniqueness. The complete sellout test minted all 495 IDs
across 165 addresses and burned exactly **99,000,000 GH0ST**.

The separate config/mainnet-fork-validation.json record reports PASS for IDs
1, 2 and 495, including the partial final shard. Each local mint against the
actual GH0ST runtime reduced payer balance, total supply and allowance by
exactly 200,000e18. Ownership, metadata, shard identity and wallet counters
matched after each mint. A fourth lifetime mint failed both before and after
transferring an earlier NFT away.

Public launch remains separate from local testing and prepared deployment
calldata. No NFT deployment address should be announced until the signed
deployment receipt, deployed bytecode, immutable configuration and verified
source have been checked.

The additional read-only record at config/full-shard-validation.json reports
PASS for all 495 live shard addresses, runtime hashes, lengths, leading STOP
bytes and Merkle proofs at block 94017755. The full logical export reconstructed
to 48,626,528 bytes and the pinned model SHA-256. The block hash was checked
again after retrieval. This complete identity check complements the three
actual-token fork mints and sent zero public transactions.
