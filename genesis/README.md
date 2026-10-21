# GH0ST Genesis recovery

This directory restores the saved NFT contracts, tests, compilation input, deployment receipts, collection generation scripts, published metadata and IPFS evidence. It does not deploy or modify any contract.

- `contracts-project/`: exact saved Solidity project, test/security evidence, ABI/build artifacts and recorded Robinhood Chain mainnet deployment.
- `collection/`: exact collection generator, manifests, metadata templates, published metadata and IPFS verification evidence.
- `opensea/`: saved marketplace artwork, descriptions and provenance.
- `../artifacts/genesis/GH0ST-Genesis-495.zip`: exact original complete art package with all 495 PNG originals and 495 SVG files. The archive also retains the original gallery and all original paths.
- `../website/mint/assets/art/`: all 495 SVG artworks, byte-for-byte identical to the original art archive. The recovered main website and mint UI are under `../website/`.

To avoid duplicating the 495 PNG payloads, their only stored copy in this recovery tree is inside the art ZIP. Extract that ZIP into a separate directory to use the original standalone gallery and its `images/` paths. SVG copies are browsable in the recovered website.

The saved deployment receipt records NFT contract `0xc2933932231870a9300b55D19F04C0873D3Ed2F3`, chain ID 4663 and transaction `0xe1ec9fba3b3540ee47df20d871d73bd3a5b741ed50984b615317e9b68cccb8c7`. This is restored historical evidence, not a new network verification or deployment.

The website's Qwen directory contains deployment assets, tokenizers and an on-chain archive index. The original Qwen research/backend source branch is not contained in those frontend files.

Recovery provenance and per-file hashes: `../docs/recovery/frontend-genesis-provenance.json`.
