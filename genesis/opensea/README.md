# GH0ST Genesis — OpenSea launch assets

Desktop: 3200 x 1200 PNG (8:3).
Mobile: 2160 x 1215 PNG (16:9).
Collection logo: 1280 x 1280 PNG (1:1).
Self-contained SVG equivalents are included. All text uses dot geometry; no font downloads.

Banners use the actual published Genesis designs and their exact vector primitives.
Center mark is Genesis #133 (Awake / Cyan / Mouth). Source editions are documented
in asset-provenance.json. The banners do not change any token artwork or metadata.

Suggested collection name: GH0ST Genesis
Website: https://gh0st.fyi
Chain: Robinhood Chain (4663)
Supply: 495 lifetime mints
Planned public burn-to-mint: 200,000 GH0ST per NFT
Protocol share of mint tokens: 0%
NFT deployment status: not deployed in this workflow

Use the custom ERC-721 burn-to-mint contract for issuance, then configure its OpenSea
collection profile. OpenSea support for the chain does not establish support for
this custom token-burning checkout inside Studio. Do not create a second unrelated
OpenSea collection contract for these same 495 shard identities.

No OpenSea collection page or mint contract was created by this asset-preparation
task. Copy is written as an upcoming-mint announcement. After deployment, verify
the actual burn mechanism and enforce zero diversion of the 200,000 GH0ST mint
tokens before announcing those terms as live. If tokens are transferred to a dead
address, totalSupply may remain unchanged; disclose the actual mechanism.
Gas and any marketplace trading fees remain separate from the protocol's mint-token cut.
No claim about zero secondary royalties or zero platform fees is made.

Artwork and metadata are on IPFS. The underlying model-weight shards are deployed
contracts. NFT ownership does not automatically grant model copyright, exclusive
access, inference control or income rights.

Official OpenSea references checked 21 October 2026:
- https://support.opensea.io/en/articles/8867028-creator-faq
- https://docs.opensea.io/reference/upload_collection_page_media
- https://opensea.io/blog/articles/robinhood-chain-is-live-on-opensea
