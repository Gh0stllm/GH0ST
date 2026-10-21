# GH0ST Genesis

An immutable ERC-721 collection associating 495 artworks with the 495 deployed
Genesis model-weight shards. **Status: NOT_DEPLOYED — UNSIGNED_DEPLOYMENT_READY.**
The explicitly selected permanent royalty recipient is
`0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6`.
The six-argument unsigned deployment plan and wallet helper are prepared.
No public NFT deployment transaction has been sent or confirmed. See
[recipient preparation evidence](deployment/royalty-recipient-preparation.json).

## Mint rules

| Rule | Fixed behavior |
| --- | --- |
| Supply | 495 unique NFTs, token IDs 1–495 |
| Mint cost | 200,000 GH0ST, with 18 decimals, burned per successful mint |
| Protocol cut | 0% of mint tokens; no treasury or fee transfer |
| Secondary royalty | Immutable ERC-2981 declaration at 350 basis points (3.5%), to an explicit payout address |
| Wallet limit | Three successful lifetime self-mints per address |
| Full sellout burn | 99,000,000 GH0ST |
| Opening | Public mint opens immediately when the contract is deployed |
| Administration | No owner, upgrade path, pause, free mint, reserves, or price/metadata setters |

The caller approves the NFT contract to spend the required GH0ST, then calls
`mint(tokenId, shardProof)` using the selected ID's proof from
`config/shard-proofs.json`. The contract calls the token's native
`burnFrom(msg.sender, 200_000e18)` and requires both token supply and caller
balance to decrease by exactly that amount before minting to the caller.
A failed mint rolls back the burn, allowance consumption and mint counter.
Network gas and third-party marketplace charges are separate.

The secondary royalty is separate from the primary mint burn. `royaltyInfo`
quotes `floor(salePrice × 350 / 10,000)` to the immutable `royaltyRecipient`.
Payment depends on marketplace settlement support; the contract does not force
marketplaces to pay it. Ordinary ERC-721 transfers collect no royalty. Neither
the royalty rate nor its recipient has an administrator or setter.

Transfers **do not reset** `mintedBy(address)`. The limit counts primary lifetime
mints rather than holdings: an address can receive additional NFTs by transfer,
and one person can use multiple addresses. Contract wallets must accept ERC-721
safe transfers. Do not send GH0ST directly to the NFT contract; minting uses
approval and a direct burn from the caller.

## Immutable shard and artwork identity

The production chain is Robinhood mainnet, **4663**. The pinned GH0ST token is
`0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559`; the original weight index is
`0x4a5aaa46e02b8cbd3fa2c39802a3e8339c98ada0`. Token ID `n` represents shard
index `n - 1`. Each mint verifies a double-hashed Merkle leaf containing the
token ID, shard address, actual runtime-code hash, logical model offset and
payload length against this immutable root:

```text
0x3b327e697b57bae646264f3fe99fb4921c40f44d92ef0173c272f7e3edcb61d2
```

The constructor pins token/index code hashes and checks the packed index header.
Minting rechecks code identity and the nine-sibling shard proof. The source
manifest, all 495 proofs and full production pins are in `config/`. Logical
model ranges exclude each data contract's leading STOP byte.

| Content | Immutable IPFS identifier |
| --- | --- |
| Token metadata | `ipfs://bafybeiacuudlonut2coevovyc5t5u3hc6bjjf4ekfrzd4d5544mh4o7z2i/001.json` through `495.json` |
| Artwork directory | `ipfs://bafybeifbg7tarcknlsgz54bhxg7cbcufhstbty3kkqldr72pd55ynkx43y/` |
| Collection metadata | `ipfs://bafkreigrokhivgmp763x3xbwhug5jfvk7i5b2hwlavtzb6rpld3mkwzpsq` |

Artwork and metadata are on IPFS; model-weight shards are on-chain. CIDs fix
content identity; continued IPFS availability requires pinning. NFTs establish
collectible associations and do not change the original shard contracts.

## Build, verify and prepare deployment

Requires Node.js 20.11+; Solidity 0.8.30 and exact dependencies are locked.

```sh
npm ci
npm test
npm run preflight
npm run test:fork
npm run verify:shards
npm run prepare:deployment
```

The production payout wallet has been explicitly supplied and configured.
`npm run prepare:deployment` regenerates the six-argument unsigned transaction
using that recipient. Later preflight runs preserve the explicit address.
To intentionally prepare a different release before deployment, both tools
accept `--royalty-recipient=0x…`; neither infers an address from a deployer,
token holder, connected wallet or environment. The recipient cannot be changed
after deployment. Always review the address before signing.

`preflight` rebuilds proofs and performs read-only checks against the official
RPC. `test:fork` sends transactions only to an in-process Ganache fork; its
upstream RPC proxy permits read-only methods. Run `preflight` immediately before
the fork because the public node prunes older state. `verify:shards` checks all
495 live shard runtimes and rebuilds the complete model hash at a fresh pinned
block. After an explicit payout address and all checks succeed,
`prepare:deployment` compiles current source and creates an unsigned
`deployment/unsigned-deployment.json` and `deployment/deploy-with-wallet.html`.
It does not broadcast a transaction. Compilation also writes a self-contained
`build/standard-input.json` for explorer source verification. To open the wallet
helper locally:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Visit `http://127.0.0.1:8000/deployment/deploy-with-wallet.html`. Deployment
requires the connected wallet's explicit signature and network deployment gas;
no private key or seed phrase is requested. The constructor is parameterized
for faithful local tests and does not itself enforce production addresses or
chain ID. Its six constructor arguments are `(token, weightIndex,
tokenCodeHash, indexCodeHash, shardMerkleRoot, royaltyRecipient)`. Production
tooling strictly pins chain 4663, the five core identity arguments, the explicit
sixth recipient, economic settings and published metadata identifiers, and
checks live token/index bytecode. It rejects stale five-argument artifacts.
Use the pinned workflow rather than substituting arguments manually.

Previously copied five-argument bytecode, deployment plans and helper HTML are
superseded. Replacing the tracked files cannot revoke copies already downloaded;
discard those copies and regenerate from the current source. They do not deploy
the final 3.5% royalty contract.

After signing, check the successful receipt, deployed code and immutable
getters, and verify the source before announcing the NFT address. There is no
admin switch to delay minting or correct deployment mistakes.
The helper records a request before opening the wallet prompt. A reload or
ambiguous wallet response keeps another deployment request blocked; check
wallet activity and the explorer before attempting another deployment.

## Validation evidence

- [Contract evidence](test/royalty-battle-summary.json) and
  [contract TAP](test/royalty-battle.tap): **33/33 tests passed**. Tests include
  adversarial burn/receiver behavior, rollback, reentrancy,
  invalid proofs/code, lifetime quotas, a seeded 96-step sequence, and all 495
  NFTs minted across 165 addresses with exactly **99 million GH0ST burned**,
  plus ERC-2981 interfaces, rounding, maximum sale prices, immutable terms and
  uncharged ordinary transfers.
- [Deployment-helper evidence](test/royalty-deployment-helper.tap): **25/25 tests
  passed**, covering the explicit recipient, rejected blocked/stale plans,
  pending prompts, ambiguous responses, reloads and explicit rejection retries.
  The separate frontend suite outside this package passed **49/49 tests**.
- [Current royalty preflight](deployment/royalty-mainnet-preflight.json):
  read-only chain checks passed with the explicitly configured production
  recipient. An unsigned deployment transaction is ready; signing is pending.
- [Current royalty fork](deployment/royalty-mainnet-fork-validation.json):
  **PASS** against actual GH0ST and shard runtimes at block **94141363**, using
  the six-argument contract. Three local mints (IDs 1, 2, 495)
  each burned exactly 200,000 GH0ST; a fourth failed both before and after
  transferring an NFT away. ERC-2981, 350 bps, the explicit local receiver,
  zero/ordinary/maximum sale-price quotes and transfer behavior passed.
  This fork exercises the explicitly selected production royalty recipient
  only inside the local EVM; it does not deploy a public NFT contract.
  **Zero public transactions were sent.**
- [Full-shard evidence](config/full-shard-validation.json): **495/495 live shards passed** at block
  **94017755**, including every address, runtime hash, length and Merkle proof.
  The complete 48,626,528-byte logical export reconstructed to SHA-256
  `9cc5e90880d96ff15bf4110f7970a7ea473c9b86576298691ade1e745672e7a9`.
  This check used read-only RPC calls and sent zero public transactions.
- Current royalty fork gas used: deployment 1,764,941; mints 156,592 / 105,328 / 100,508.
  These are local fork measurements, not public-network fee estimates.

The earlier `config/mainnet-preflight.json`,
`config/mainnet-fork-validation.json`, `test/local-battle-*` and original
aggregate test records remain historical evidence for the earlier contract;
they are not a fresh pass for the royalty revision. See
[ROYALTY-SECURITY-REVIEW.md](ROYALTY-SECURITY-REVIEW.md) for the current scoped
review and [SECURITY-REVIEW.md](SECURITY-REVIEW.md) for the earlier review.
Automated tests and development reviews are not an external security audit.

## Model attribution and rights

The model is `tiiuae/Falcon-H1-Tiny-90M-Instruct`. **GH0ST is built using
artificial intelligence technology from the Technology Innovation Institute.**
Upstream model terms and attribution obligations apply separately from the
NFT and contract-code license. NFT ownership does not grant model copyright,
exclusive inference access, control of the weights, or automatic revenue rights.
